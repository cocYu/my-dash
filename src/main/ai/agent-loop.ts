// Agent 循环：模型 → 工具 → 模型，直到模型不再调用工具或到达轮数上限。
// 只支持 chat 协议的供应商；其余协议由调用方降级为纯对话。
import type { AiAgent, AiReasoningEffort, AiToolStep } from '../../types/agent'
import type { AiChatMessage, AiProvider } from '../../types/ai'
import { clipText, type ToolContext, type ToolDef, type ToolPreview } from './tools'
import { appendAudit } from './audit'
import { streamChatWithTools, type StreamUsage, type WireMessage, type WireToolSchema } from './stream'

/** 最多几轮工具往返，防止模型无限调用 */
const MAX_ROUNDS = 8
/** 同一工具连续失败几次后中止（模型常见的死循环） */
const MAX_CONSECUTIVE_FAILURES = 2
/** 步骤摘要保留长度（给界面看，不是给模型） */
const STEP_SUMMARY_LIMIT = 320

export interface AgentRunCallbacks {
  onText: (delta: string) => void
  onToolStep: (step: AiToolStep) => void
}

export interface AgentRunResult {
  /** 完整回答（含工具调用之间的叙述文本） */
  text: string
  steps: AiToolStep[]
  usage?: StreamUsage
}

export interface AgentRunParams {
  provider: AiProvider
  agent: AiAgent
  /** 会话级覆盖：模型 */
  model?: string
  /** 会话级覆盖：思考强度 */
  reasoningEffort?: AiReasoningEffort
  /** 早期上下文摘要（会拼进 system 提示） */
  contextSummary?: string
  /** 历史消息（不含 systemPrompt，已含本轮用户输入） */
  messages: AiChatMessage[]
  tools: ToolDef[]
  ctx: ToolContext
  signal: AbortSignal
  callbacks: AgentRunCallbacks
}

export async function runAgentLoop(params: AgentRunParams): Promise<AgentRunResult> {
  const { provider, agent, tools, ctx, signal, callbacks } = params

  const model = params.model?.trim() || agent.model
  const effort = params.reasoningEffort ?? agent.reasoningEffort ?? 'off'
  const systemParts = [
    agent.systemPrompt.trim(),
    params.contextSummary
      ? `以下是本会话早前内容的摘要（已压缩，用于延续上下文）：\n${params.contextSummary}`
      : ''
  ].filter(Boolean)

  const wire: WireMessage[] = [
    ...(systemParts.length ? [{ role: 'system' as const, content: systemParts.join('\n\n') }] : []),
    ...params.messages.map(toWireMessage)
  ]

  const chunks: string[] = []
  const steps: AiToolStep[] = []
  let pendingSeparator = false
  let usage: StreamUsage | undefined

  const emitText = (delta: string): void => {
    if (!delta) return
    // 工具轮次之间的文本用空行分隔，保证界面与落盘内容一致
    if (pendingSeparator) {
      pendingSeparator = false
      chunks.push('\n\n')
      callbacks.onText('\n\n')
    }
    chunks.push(delta)
    callbacks.onText(delta)
  }

  const schemas: WireToolSchema[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }))

  let lastFailedTool = ''
  let failureStreak = 0

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (round > 1 && chunks.length > 0) pendingSeparator = true

    const res = await streamChatWithTools(
      provider,
      {
        model,
        messages: wire,
        ...(schemas.length ? { tools: schemas } : {}),
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        ...(effort !== 'off' ? { reasoningEffort: effort } : {})
      },
      { onText: emitText, signal }
    )
    if (res.usage) usage = mergeUsage(usage, res.usage)

    if (!res.toolCalls.length) {
      return { text: chunks.join(''), steps, ...(usage ? { usage } : {}) }
    }

    wire.push({
      role: 'assistant',
      content: res.text,
      toolCalls: res.toolCalls,
      // responses：把本轮 output items 原样回传（含推理模型的 reasoning 项）
      ...(res.outputItems?.length ? { raw: res.outputItems } : {})
    })

    let aborted = false
    for (const call of res.toolCalls) {
      const started = Date.now()
      const tool = tools.find((t) => t.name === call.name)
      let args: Record<string, unknown> = {}
      let output = ''
      let ok = true
      let skipped = false
      let approved: boolean | null = null

      if (!tool) {
        ok = false
        output = `未知工具「${call.name}」。可用工具：${tools.map((t) => t.name).join(', ') || '（无）'}`
      } else {
        const parsed = parseArgs(call.arguments)
        if (!parsed.ok) {
          ok = false
          output = `工具参数不是合法 JSON，请重新按 schema 生成：${parsed.error}`
        } else {
          args = parsed.value

          // 写操作必须先经用户确认；没有确认通道时一律拒绝（安全默认）
          if (tool.level !== 'read') {
            let preview: ToolPreview = { summary: `执行「${tool.label}」` }
            try {
              if (tool.preview) preview = await tool.preview(args, ctx)
            } catch (err) {
              preview = {
                summary: `执行「${tool.label}」（预览生成失败：${err instanceof Error ? err.message : '未知错误'}）`
              }
            }
            approved = ctx.confirm
              ? await ctx.confirm({
                  tool: tool.name,
                  label: tool.label,
                  summary: preview.summary,
                  ...(preview.detail ? { detail: preview.detail } : {}),
                  level: tool.level
                })
              : false

            if (!approved) {
              ok = false
              skipped = true
              output = '用户拒绝了这次操作，未执行。不要重复尝试同一操作；如需继续，请先向用户说明情况并询问。'
            }
          }

          if (!skipped) {
            try {
              output = await tool.run(args, ctx)
            } catch (err) {
              ok = false
              output = `执行失败：${err instanceof Error ? err.message : String(err)}`
            }
          }

          // 写操作落审计：允许/拒绝、成功/失败都记
          if (tool.level !== 'read') {
            appendAudit({
              at: new Date().toISOString(),
              agentId: agent.id,
              agentName: agent.name,
              tool: tool.name,
              label: tool.label,
              level: tool.level,
              args,
              ok,
              approved,
              result: clipText(output, 500)
            })
          }
        }
      }

      const step: AiToolStep = {
        name: call.name,
        label: tool?.label ?? call.name,
        args,
        summary: clipText(output, STEP_SUMMARY_LIMIT),
        ok,
        ...(skipped ? { skipped: true } : {}),
        durationMs: Date.now() - started
      }
      steps.push(step)
      callbacks.onToolStep(step)

      wire.push({
        role: 'tool',
        toolCallId: call.id,
        content: clipText(output, undefined)
      })

      // 用户拒绝不算工具故障，不应触发「连续失败」熔断
      if (ok || skipped) {
        lastFailedTool = ''
        failureStreak = 0
      } else if (call.name === lastFailedTool) {
        failureStreak++
        if (failureStreak >= MAX_CONSECUTIVE_FAILURES) {
          aborted = true
          const note = `\n\n（工具「${tool?.label ?? call.name}」连续失败，已中止，请检查工具参数或稍后重试。）`
          chunks.push(note)
          callbacks.onText(note)
          break
        }
      } else {
        lastFailedTool = call.name
        failureStreak = 1
      }
    }

    if (aborted) return { text: chunks.join(''), steps, ...(usage ? { usage } : {}) }

    if (round === MAX_ROUNDS) {
      const note = `\n\n（已达到 ${MAX_ROUNDS} 轮工具调用上限，停止继续调用工具。）`
      chunks.push(note)
      callbacks.onText(note)
    }
  }

  return { text: chunks.join(''), steps, ...(usage ? { usage } : {}) }
}

function toWireMessage(m: AiChatMessage): WireMessage {
  // Agent 工具循环只发纯文本；多模态部件（若有）降级取文本
  const content = typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
  if (m.role === 'system') return { role: 'system', content }
  if (m.role === 'assistant') return { role: 'assistant', content }
  return { role: 'user', content }
}

function parseArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const text = (raw ?? '').trim()
  if (!text) return { ok: true, value: {} }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '需要 JSON 对象' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'JSON 解析失败' }
  }
}

function mergeUsage(prev: StreamUsage | undefined, next: StreamUsage): StreamUsage {
  if (!prev) return next
  return {
    promptTokens: prev.promptTokens + next.promptTokens,
    completionTokens: prev.completionTokens + next.completionTokens,
    totalTokens: prev.totalTokens + next.totalTokens
  }
}

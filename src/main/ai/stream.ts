// 三协议流式对话 + 工具调用：SSE 解析 → 统一文本增量与工具调用。
//   chat      → POST /v1/chat/completions   delta.content / delta.tool_calls[]
//   responses → POST /v1/responses          output_text.delta / output_item.* / function_call_arguments.*
//   messages  → POST /v1/messages           text_delta / tool_use + input_json_delta
// 三者的工具声明、增量事件、结果回填格式完全不同，在此统一成 WireMessage / WireToolCall。
import type { AiProtocol, AiProvider } from '../../types/ai'
import type { AiReasoningEffort } from '../../types/agent'

const STREAM_TIMEOUT = 300_000

function apiBase(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (!b) throw new Error('接口地址未配置')
  if (/\/v\d+$/.test(b)) return b
  return `${b}/v1`
}

function authHeaders(provider: AiProvider): Record<string, string> {
  const key = provider.apiKey
  if (!key) throw new Error(`供应商「${provider.name}」尚未配置 API Key`)
  if (provider.protocol === 'messages') {
    return {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'text/event-stream'
    }
  }
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'text/event-stream' }
}

function endpointFor(protocol: AiProtocol): string {
  if (protocol === 'responses') return '/responses'
  if (protocol === 'messages') return '/messages'
  return '/chat/completions'
}

/**
 * SSE 行解析：兼容 \r\n、注释行（:）、event 名与多行 data。
 * 事件以空行分隔；data 多行时按规范用 \n 拼接。
 */
async function consumeSse(res: Response, onEvent: (event: string, data: string) => void): Promise<void> {
  if (!res.body) throw new Error('供应商未返回可读的流式响应')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const flush = (): void => {
    if (dataLines.length > 0) onEvent(eventName || 'message', dataLines.join('\n'))
    eventName = ''
    dataLines = []
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl < 0) break
      let line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line === '') {
        flush()
        continue
      }
      if (line.startsWith(':')) continue // 心跳/注释
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let val = colon < 0 ? '' : line.slice(colon + 1)
      if (val.startsWith(' ')) val = val.slice(1)
      if (field === 'event') eventName = val
      else if (field === 'data') dataLines.push(val)
    }
  }
  buffer += decoder.decode()
  // 流末尾可能没有空行收尾，补一次 flush
  const tail = buffer.replace(/\r$/, '')
  if (tail.startsWith('data:')) dataLines.push(tail.slice(5).trimStart())
  flush()
}

function tryParse(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export interface StreamOptions {
  onText: (delta: string) => void
  signal?: AbortSignal
}

/** 统一发起流式请求：超时与用户取消合并，错误信息归一化 */
async function postStream(
  provider: AiProvider,
  body: Record<string, unknown>,
  opts: StreamOptions,
  onEvent: (event: string, data: string) => void
): Promise<void> {
  const url = `${apiBase(provider.baseUrl)}${endpointFor(provider.protocol)}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT)
  const onAbort = (): void => controller.abort()
  if (opts.signal?.aborted) controller.abort()
  opts.signal?.addEventListener('abort', onAbort)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(provider),
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!res.ok) {
      const text = await res.text()
      let detail = text
      const parsed = tryParse(text)
      if (parsed) {
        const err = parsed.error as Record<string, unknown> | string | undefined
        if (typeof err === 'string') detail = err
        else if (err && typeof err === 'object' && typeof err.message === 'string') detail = err.message
        else if (typeof parsed.message === 'string') detail = parsed.message
      }
      throw new Error(`HTTP ${res.status}：${String(detail).slice(0, 400)}`)
    }
    await consumeSse(res, onEvent)
  } catch (err) {
    if (opts.signal?.aborted) throw new Error('已停止生成')
    if (controller.signal.aborted) throw new Error('请求超时或连接中断')
    throw err
  } finally {
    clearTimeout(timeout)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

// ---- 协议无关的消息模型 ----

/** 工具的协议无关声明：由各协议自行映射成官方格式 */
export interface WireToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** 一次工具调用。id 即回填结果时的关联键（chat: tool_call_id / responses: call_id / messages: tool_use.id） */
export interface WireToolCall {
  id: string
  name: string
  /** 模型返回的原始 JSON 字符串（可能由分片拼成） */
  arguments: string
}

/** 发给模型的完整消息（含工具轮次）。system / user 分开声明，便于类型收窄 */
export type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: WireToolCall[]; raw?: unknown[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface StreamUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ToolStreamResult {
  text: string
  toolCalls: WireToolCall[]
  finishReason: string
  usage?: StreamUsage
  /**
   * responses 专用：上一轮返回的完整 output items。
   * 推理模型的 reasoning 项必须原样回传，否则下一轮请求会报错，
   * 因此不能只重建 function_call，要把整组 item 带上。
   */
  outputItems?: unknown[]
}

export interface ToolStreamRequest {
  model: string
  messages: WireMessage[]
  tools?: WireToolSchema[]
  temperature?: number
  maxTokens?: number
  /** 思考强度；off / 缺省表示不显式传该参数 */
  reasoningEffort?: AiReasoningEffort
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function pickOpenAIUsage(raw: unknown): StreamUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>
  const prompt = num(u.prompt_tokens ?? u.input_tokens)
  const completion = num(u.completion_tokens ?? u.output_tokens)
  const total = num(u.total_tokens) || prompt + completion
  if (!prompt && !completion && !total) return undefined
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
}

function pickAnthropicUsage(raw: unknown): { input: number; output: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>
  const input = num(u.input_tokens)
  const output = num(u.output_tokens)
  if (!input && !output) return undefined
  return { input, output }
}

function sortCalls(slots: Map<number, { id: string; name: string; args: string }>): WireToolCall[] {
  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, s]) => ({
      id: s.id || `call_${idx}_${Date.now().toString(36)}`,
      name: s.name,
      arguments: s.args || '{}'
    }))
    .filter((c) => c.name)
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---- chat（OpenAI Chat Completions） ----

function chatBody(req: ToolStreamRequest, includeUsage: boolean): Record<string, unknown> {
  const messages = req.messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    if (m.role === 'assistant') {
      const out: Record<string, unknown> = { role: 'assistant', content: m.content || null }
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' }
        }))
      }
      return out
    }
    return { role: m.role, content: m.content }
  })

  return {
    model: req.model,
    messages,
    stream: true,
    // 流式默认不回 usage，显式要求；极少数供应商会报 400，由调用方降级重试
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    // chat 协议用 reasoning_effort（OpenAI o 系 / GPT-5 及多数兼容实现）
    ...(req.reasoningEffort && req.reasoningEffort !== 'off' ? { reasoning_effort: req.reasoningEffort } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters }
          })),
          tool_choice: 'auto'
        }
      : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})
  }
}

async function runChatStream(
  provider: AiProvider,
  req: ToolStreamRequest,
  opts: StreamOptions
): Promise<ToolStreamResult> {
  let text = ''
  let finishReason = ''
  let usage: StreamUsage | undefined
  const slots = new Map<number, { id: string; name: string; args: string }>()

  const handle = (_event: string, data: string): void => {
    if (data === '[DONE]') return
    const json = tryParse(data)
    if (!json) return

    // usage 可能单独成一块（choices 为空）
    const u = pickOpenAIUsage(json.usage)
    if (u) usage = u

    const choices = json.choices as Record<string, unknown>[] | undefined
    const choice = choices?.[0]
    if (!choice) return
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      finishReason = choice.finish_reason
    }

    const delta = choice.delta as Record<string, unknown> | undefined
    if (!delta) return

    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content
      opts.onText(delta.content)
    }

    const rawCalls = delta.tool_calls as Record<string, unknown>[] | undefined
    if (!Array.isArray(rawCalls)) return
    for (let i = 0; i < rawCalls.length; i++) {
      const raw = rawCalls[i]
      const idx = typeof raw.index === 'number' ? raw.index : i
      let slot = slots.get(idx)
      if (!slot) {
        slot = { id: '', name: '', args: '' }
        slots.set(idx, slot)
      }
      if (typeof raw.id === 'string' && raw.id) slot.id = raw.id
      const fn = raw.function as Record<string, unknown> | undefined
      if (fn) {
        if (typeof fn.name === 'string' && fn.name) slot.name = fn.name
        // 参数是逐字符下发的 JSON 片段，必须拼接完整后才能解析
        if (typeof fn.arguments === 'string') slot.args += fn.arguments
      }
    }
  }

  // 部分供应商不认识 stream_options，会直接 400：去掉该字段重试一次
  let includeUsage = true
  for (let attempt = 0; ; attempt++) {
    text = ''
    finishReason = ''
    usage = undefined
    slots.clear()
    try {
      await postStream(provider, chatBody(req, includeUsage), opts, handle)
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      const retryable = attempt === 0 && includeUsage && /HTTP 4\d\d/.test(msg) && /stream_options/i.test(msg)
      if (!retryable) throw err
      includeUsage = false
    }
  }

  return { text, toolCalls: sortCalls(slots), finishReason, ...(usage ? { usage } : {}) }
}

// ---- responses（OpenAI Responses API） ----

function responsesBody(req: ToolStreamRequest): Record<string, unknown> {
  const instructions = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')

  const input: unknown[] = []
  for (const m of req.messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      input.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      // 有原始 output items 时整组回传：推理模型要求 reasoning 项一并带上
      if (m.raw?.length) {
        input.push(...m.raw)
        continue
      }
      if (m.content.trim()) input.push({ role: 'assistant', content: m.content })
      for (const tc of m.toolCalls ?? []) {
        input.push({ type: 'function_call', call_id: tc.id, name: tc.name, arguments: tc.arguments || '{}' })
      }
      continue
    }
    input.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content })
  }

  return {
    model: req.model,
    input,
    stream: true,
    ...(instructions ? { instructions } : {}),
    // responses 协议用 reasoning.effort
    ...(req.reasoningEffort && req.reasoningEffort !== 'off'
      ? { reasoning: { effort: req.reasoningEffort } }
      : {}),
    // Responses 的函数工具是扁平结构，不带 function 包裹
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters: t.parameters
          })),
          tool_choice: 'auto'
        }
      : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_output_tokens: req.maxTokens } : {})
  }
}

async function runResponsesStream(
  provider: AiProvider,
  req: ToolStreamRequest,
  opts: StreamOptions
): Promise<ToolStreamResult> {
  let text = ''
  let finishReason = ''
  let usage: StreamUsage | undefined
  const items: unknown[] = []
  const slots = new Map<number, { id: string; name: string; args: string; itemId?: string }>()

  const handle = (_event: string, data: string): void => {
    if (data === '[DONE]') return
    const json = tryParse(data)
    if (!json) return
    const type = typeof json.type === 'string' ? json.type : ''

    if (type === 'error' || type === 'response.failed') {
      const holder = (json.error ?? (json.response as Record<string, unknown> | undefined)?.error) as
        | Record<string, unknown>
        | string
        | undefined
      const message =
        typeof holder === 'string'
          ? holder
          : typeof holder?.message === 'string'
            ? holder.message
            : '供应商返回错误事件'
      throw new Error(message)
    }

    if (type === 'response.output_text.delta') {
      if (typeof json.delta === 'string' && json.delta) {
        text += json.delta
        opts.onText(json.delta)
      }
      return
    }

    if (type === 'response.output_item.added') {
      const idx = typeof json.output_index === 'number' ? json.output_index : slots.size
      const item = json.item as Record<string, unknown> | undefined
      if (item && item.type === 'function_call') {
        slots.set(idx, {
          id: typeof item.call_id === 'string' ? item.call_id : String(item.id ?? ''),
          name: typeof item.name === 'string' ? item.name : '',
          args: typeof item.arguments === 'string' ? item.arguments : '',
          ...(typeof item.id === 'string' ? { itemId: item.id } : {})
        })
      }
      return
    }

    if (type === 'response.function_call_arguments.delta') {
      const delta = typeof json.delta === 'string' ? json.delta : ''
      if (!delta) return
      const idx = typeof json.output_index === 'number' ? json.output_index : -1
      let slot = idx >= 0 ? slots.get(idx) : undefined
      if (!slot && typeof json.item_id === 'string') {
        for (const s of slots.values()) {
          if (s.itemId === json.item_id) {
            slot = s
            break
          }
        }
      }
      if (slot) slot.args += delta
      return
    }

    if (type === 'response.output_item.done') {
      const item = json.item as Record<string, unknown> | undefined
      if (!item) return
      items.push(item)
      if (item.type === 'function_call') {
        // done 里的 arguments 是完整值，覆盖 delta 累积结果（更权威）
        const idx = typeof json.output_index === 'number' ? json.output_index : -1
        if (idx >= 0) {
          slots.set(idx, {
            id: typeof item.call_id === 'string' ? item.call_id : String(item.id ?? ''),
            name: typeof item.name === 'string' ? item.name : '',
            args: typeof item.arguments === 'string' ? item.arguments : '',
            ...(typeof item.id === 'string' ? { itemId: item.id } : {})
          })
        }
      }
      return
    }

    if (type === 'response.completed') {
      const resp = json.response as Record<string, unknown> | undefined
      const u = pickOpenAIUsage(resp?.usage)
      if (u) usage = u
      if (typeof resp?.stop_reason === 'string' && resp.stop_reason) finishReason = resp.stop_reason
    }
  }

  await postStream(provider, responsesBody(req), opts, handle)

  // 优先用完整 item 提取工具调用；个别中转不发 done 事件时回退到 delta 累积
  let toolCalls: WireToolCall[] = items
    .filter((it): it is Record<string, unknown> => Boolean(it) && (it as Record<string, unknown>).type === 'function_call')
    .map((it) => ({
      id: String(it.call_id ?? it.id ?? ''),
      name: String(it.name ?? ''),
      arguments: typeof it.arguments === 'string' ? it.arguments : '{}'
    }))
    .filter((c) => c.name && c.id)

  if (!toolCalls.length && slots.size) toolCalls = sortCalls(slots)

  return {
    text,
    toolCalls,
    finishReason,
    ...(usage ? { usage } : {}),
    ...(items.length ? { outputItems: items } : {})
  }
}

// ---- messages（Anthropic Messages API） ----

/** Anthropic 思考预算（token）：low 也需 ≥1024 */
const THINKING_BUDGET: Record<'low' | 'medium' | 'high', number> = {
  low: 1024,
  medium: 4096,
  high: 8192
}

function messagesBody(req: ToolStreamRequest): Record<string, unknown> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')

  const turns: Record<string, unknown>[] = []
  let i = 0
  while (i < req.messages.length) {
    const m = req.messages[i]
    if (m.role === 'system') {
      i++
      continue
    }
    if (m.role === 'user') {
      turns.push({ role: 'user', content: m.content })
      i++
      continue
    }
    if (m.role === 'assistant') {
      const blocks: unknown[] = []
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: safeParseObject(tc.arguments) })
      }
      if (blocks.length) turns.push({ role: 'assistant', content: blocks })
      i++
      continue
    }
    // tool 结果必须放进紧随其后的 user 消息的 tool_result 块，多个结果合并成一条
    const blocks: unknown[] = []
    while (i < req.messages.length && req.messages[i].role === 'tool') {
      const t = req.messages[i] as Extract<WireMessage, { role: 'tool' }>
      blocks.push({ type: 'tool_result', tool_use_id: t.toolCallId, content: t.content })
      i++
    }
    turns.push({ role: 'user', content: blocks })
  }

  const effort = req.reasoningEffort && req.reasoningEffort !== 'off' ? req.reasoningEffort : ''
  const thinkingBudget = effort ? THINKING_BUDGET[effort] : 0

  return {
    model: req.model,
    // Anthropic 要求 max_tokens 必填，且必须大于 thinking 预算
    max_tokens: Math.max(req.maxTokens ?? 4096, thinkingBudget + 1024),
    messages: turns,
    stream: true,
    ...(system ? { system } : {}),
    ...(thinkingBudget ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters
          }))
        }
      : {}),
    // 开启 thinking 时 Anthropic 要求 temperature 保持默认值，直接省略
    ...(!thinkingBudget && req.temperature !== undefined ? { temperature: req.temperature } : {})
  }
}

async function runMessagesStream(
  provider: AiProvider,
  req: ToolStreamRequest,
  opts: StreamOptions
): Promise<ToolStreamResult> {
  let text = ''
  let finishReason = ''
  let inputTokens = 0
  let outputTokens = 0
  let hasUsage = false
  const slots = new Map<number, { id: string; name: string; args: string }>()

  const handle = (_event: string, data: string): void => {
    if (data === '[DONE]') return
    const json = tryParse(data)
    if (!json) return
    const type = typeof json.type === 'string' ? json.type : ''

    if (type === 'error') {
      const err = json.error as Record<string, unknown> | undefined
      throw new Error(typeof err?.message === 'string' ? err.message : '供应商返回错误事件')
    }

    if (type === 'message_start') {
      const msg = json.message as Record<string, unknown> | undefined
      const u = pickAnthropicUsage(msg?.usage)
      if (u) {
        inputTokens = u.input
        outputTokens = Math.max(outputTokens, u.output)
        hasUsage = true
      }
      return
    }

    if (type === 'content_block_start') {
      const idx = typeof json.index === 'number' ? json.index : slots.size
      const block = json.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use') {
        slots.set(idx, { id: String(block.id ?? ''), name: String(block.name ?? ''), args: '' })
      }
      return
    }

    if (type === 'content_block_delta') {
      const idx = typeof json.index === 'number' ? json.index : -1
      const delta = json.delta as Record<string, unknown> | undefined
      if (!delta) return
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        text += delta.text
        opts.onText(delta.text)
        return
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const slot = slots.get(idx)
        if (slot) slot.args += delta.partial_json
      }
      return
    }

    if (type === 'message_delta') {
      const delta = json.delta as Record<string, unknown> | undefined
      if (typeof delta?.stop_reason === 'string' && delta.stop_reason) finishReason = delta.stop_reason
      const u = pickAnthropicUsage(json.usage)
      if (u) {
        outputTokens = u.output
        hasUsage = true
      }
    }
  }

  await postStream(provider, messagesBody(req), opts, handle)

  const usage: StreamUsage | undefined = hasUsage
    ? { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens }
    : undefined

  return { text, toolCalls: sortCalls(slots), finishReason, ...(usage ? { usage } : {}) }
}

// ---- 统一入口 ----

/**
 * 带工具的流式对话。文本增量实时回调；工具调用在流结束后一次性返回。
 * 三种协议各自适配，调用方无需关心差异。
 */
export async function streamChatWithTools(
  provider: AiProvider,
  req: ToolStreamRequest,
  opts: StreamOptions
): Promise<ToolStreamResult> {
  if (provider.protocol === 'responses') return runResponsesStream(provider, req, opts)
  if (provider.protocol === 'messages') return runMessagesStream(provider, req, opts)
  return runChatStream(provider, req, opts)
}

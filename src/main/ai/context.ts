// 上下文准备：按模型窗口判断是否需要压缩，超出时把较早消息并入「滚动摘要」。
// 纯计算在 context-budget.ts；这里负责调用模型生成摘要并给出界面提示。
import type { AiChatMessage, AiProvider } from '../../types/ai'
import type { AiAgent, AiSessionMessage, AiSessionMeta } from '../../types/agent'
import { chatOnce } from './gateway'
import {
  TOOL_OVERHEAD,
  contextBudget,
  estimateTokens,
  planCompression
} from './context-budget'

/** 摘要自身的估算上限（提示模型控制长度） */
const SUMMARY_TOKEN_LIMIT = 1200

const SUMMARY_SYSTEM_PROMPT = `你在为一段长期对话做上下文压缩。请把「已有摘要」与「新增对话」合并成一份新的摘要。

要求：
- 保留：用户的目标与偏好、已确认的事实与结论、重要数据（数字/日期/名称/链接）、未解决的问题
- 丢弃：寒暄、重复表述、工具调用的中间过程、模型的自述
- 不要编造，不要添加评价或推测
- 用简洁的中文条目式表述，控制在 ${SUMMARY_TOKEN_LIMIT} 字以内

只输出摘要正文。`

export interface PreparedContext {
  /** 已裁剪/压缩后的历史消息（不含 system 与摘要） */
  messages: AiChatMessage[]
  /** 需要拼进 system 的滚动摘要 */
  summary: string
  /** 已纳入摘要的消息条数（前缀长度） */
  summarizedCount: number
  /** 本次是否执行了压缩 */
  compressed: boolean
  /** 压缩过程中的提示（摘要失败等），交给界面展示 */
  notice?: string
}

export interface PrepareContextParams {
  provider: AiProvider
  agent: AiAgent
  /** 只需要摘要相关的两个字段，允许传入缺省对象 */
  session: Pick<AiSessionMeta, 'summary' | 'summarizedCount'>
  /** 会话完整消息（按时间正序） */
  history: AiSessionMessage[]
  /** 实际使用的模型（会话可能覆盖 Agent 配置） */
  model: string
}

/**
 * 准备一轮对话的上下文：
 * 1) 按预算判断是否超阈值；2) 超了就取近期消息保留、其余并入滚动摘要；
 * 3) 摘要生成失败时退化为直接丢弃，并把情况通过 notice 告知用户。
 */
export async function prepareContext(params: PrepareContextParams): Promise<PreparedContext> {
  const { provider, agent, session, history, model } = params

  let summary = session.summary ?? ''
  let summarizedCount = Math.min(session.summarizedCount ?? 0, history.length)

  const toChat = (m: AiSessionMessage): AiChatMessage => ({ role: m.role, content: m.content })
  let messages = history.slice(summarizedCount).map(toChat)

  const plan = planCompression({
    messages,
    systemTokens: estimateTokens(agent.systemPrompt) + TOOL_OVERHEAD,
    summaryTokens: estimateTokens(summary),
    budget: contextBudget(agent)
  })
  if (!plan.compress) {
    return { messages, summary, summarizedCount, compressed: false }
  }

  const toSummarize = messages.slice(0, plan.cut)
  let notice: string | undefined
  let nextSummary = ''
  try {
    nextSummary = await summarize(provider, model, summary, toSummarize)
  } catch (err) {
    console.error('[ai] 上下文摘要生成失败，退化为直接丢弃早期消息:', err)
    notice = '上下文摘要生成失败，已直接丢弃较早的对话内容。'
  }

  if (nextSummary) {
    summary = nextSummary
    notice = notice ?? `已将前 ${toSummarize.length} 条早期对话压缩为摘要。`
  } else if (!notice) {
    notice = `已将前 ${toSummarize.length} 条早期对话从上下文中移除。`
  }

  summarizedCount += plan.cut
  messages = messages.slice(plan.cut)

  return { messages, summary, summarizedCount, compressed: true, ...(notice ? { notice } : {}) }
}

/** 调用同一模型把「旧摘要 + 新增对话」合并成新摘要 */
async function summarize(
  provider: AiProvider,
  model: string,
  previous: string,
  messages: AiChatMessage[]
): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    .join('\n\n')

  const input = previous ? `已有摘要：\n${previous}\n\n新增对话：\n${transcript}` : `新增对话：\n${transcript}`

  const resp = await chatOnce(provider, {
    providerId: provider.id,
    model,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      // 极端情况下的超长输入再兜一层，避免摘要请求本身超窗
      { role: 'user', content: input.slice(0, 60_000) }
    ],
    temperature: 0.2,
    maxTokens: SUMMARY_TOKEN_LIMIT
  })
  return (resp.text ?? '').trim()
}

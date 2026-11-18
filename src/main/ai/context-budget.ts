// 上下文预算的纯函数：token 估算、窗口预算、压缩裁剪点计算。
// 不依赖 Electron / 网络，便于单独测试；真正的摘要生成在 context.ts。
import type { AiChatMessage } from '../../types/ai'
import type { AiAgent } from '../../types/agent'

/** 多数现代模型 128k；Agent 可单独指定 */
export const DEFAULT_CONTEXT_WINDOW = 128_000
/** 低于该值的窗口视为配置错误，回退默认值 */
export const MIN_CONTEXT_WINDOW = 8_000
/** 占预算多少时触发压缩 */
export const COMPRESS_TRIGGER = 0.7
/** 压缩后保留的近期消息预算比例 */
export const KEEP_RATIO = 0.35
/** 工具声明的固定预留（6 个只读工具约 1.5k~2k token） */
export const TOOL_OVERHEAD = 2_000
/** 窗口预算的安全余量，吸收估算误差 */
export const SAFETY_MARGIN = 512

/**
 * 粗略 token 估算：中日韩字符按 1 token，其余按 3.6 字符/token。
 * 比 tiktoken 便宜得多，用于预算判断足够；误差由触发阈值与预留量吸收。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let wide = 0
  let narrow = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x2e80) wide++
    else narrow++
  }
  return Math.ceil(wide + narrow / 3.6)
}

/** 单条消息的估算（含 4 token 结构开销） */
export function estimateMessageTokens(m: AiChatMessage): number {
  return estimateTokens(m.content) + 4
}

export function estimateMessagesTokens(msgs: AiChatMessage[]): number {
  let total = 0
  for (const m of msgs) total += estimateMessageTokens(m)
  return total
}

/** 可用于历史消息的预算（已扣除输出预留与安全余量；工具开销由调用方计入 systemTokens） */
export function contextBudget(agent: AiAgent): number {
  const configured = Number(agent.contextWindow)
  const window =
    Number.isFinite(configured) && configured >= MIN_CONTEXT_WINDOW ? configured : DEFAULT_CONTEXT_WINDOW
  const output = Math.max(Number(agent.maxTokens) || 0, 1024)
  return Math.max(2_000, window - output - SAFETY_MARGIN)
}

export interface CompressionPlan {
  /** 是否需要压缩 */
  compress: boolean
  /** 从消息数组的哪个下标开始保留（之前的进入摘要） */
  cut: number
  /** 保留部分的估算 token */
  keepTokens: number
}

/**
 * 判断是否需要压缩，并算出保留近期消息的起始下标。
 * 规则：总量超过预算的 70% 才压缩；从尾部往前累积到保留预算（约 35%），
 * 其余全部进入摘要；至少保留最后一条（通常是本轮用户输入）。
 */
export function planCompression(input: {
  messages: AiChatMessage[]
  systemTokens: number
  summaryTokens: number
  budget: number
}): CompressionPlan {
  const { messages, systemTokens, summaryTokens, budget } = input
  const total = systemTokens + summaryTokens + estimateMessagesTokens(messages)
  if (total <= budget * COMPRESS_TRIGGER) {
    return { compress: false, cut: 0, keepTokens: total - systemTokens - summaryTokens }
  }

  const keepLimit = Math.max(budget * KEEP_RATIO, 1)
  let keepTokens = 0
  let cut = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(messages[i])
    // 已经保留了至少一条时，超预算就停止
    if (keepTokens + t > keepLimit && cut < messages.length) break
    keepTokens += t
    cut = i
  }
  // 至少保留最后一条
  if (cut >= messages.length) cut = Math.max(0, messages.length - 1)
  return { compress: cut > 0, cut, keepTokens }
}

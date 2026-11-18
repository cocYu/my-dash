// AI Agent 与会话共享类型（主进程 / 渲染层双端使用）。
import type { AiChatMessage } from './ai'

/** 思考强度：off 表示不显式开启（走模型默认） */
export type AiReasoningEffort = 'off' | 'low' | 'medium' | 'high'

/** 自定义 AI 助手（Agent）：一个可复用的角色配置 */
export interface AiAgent {
  id: string
  name: string
  /** 展示用 emoji，避免额外图标资源 */
  emoji: string
  description: string
  /** 角色设定与行为约束 */
  systemPrompt: string
  /** 绑定的供应商与模型 */
  providerId: string
  model: string
  temperature: number
  maxTokens: number
  /** 模型上下文窗口（token），用于上下文预算；缺省按 128k */
  contextWindow?: number
  /** 默认思考强度；会话内可覆盖 */
  reasoningEffort?: AiReasoningEffort
  /** 允许调用的工具 ID 白名单（后续批次启用，先预留） */
  tools: string[]
  /** 挂载为背景知识的文件夹（后续批次启用） */
  knowledgeFolderIds: number[]
  /** 空会话时展示的快捷指令 */
  quickPrompts: string[]
  createdAt: string
  updatedAt: string
}

/** 会话元数据（消息正文单独存文件） */
export interface AiSessionMeta {
  id: string
  agentId: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  /** 会话级覆盖：供应商 / 模型 / 思考强度，缺省沿用 Agent 配置 */
  providerId?: string
  model?: string
  reasoningEffort?: AiReasoningEffort
  /** 早期消息的滚动摘要（已压缩部分） */
  summary?: string
  /** 已纳入摘要的消息条数（消息数组前缀长度） */
  summarizedCount?: number
  /** 摘要更新时间 */
  summaryAt?: string
}

/** 会话可修改的字段（含运行时覆盖项） */
export interface AiSessionPatch {
  title?: string
  providerId?: string
  model?: string
  reasoningEffort?: AiReasoningEffort
  summary?: string
  summarizedCount?: number
  summaryAt?: string
}

/** 工具能力级别：read 自动执行，其余需确认（后续批次启用） */
export type AiToolLevel = 'read' | 'write' | 'destructive' | 'paid'

/** 工具目录项：渲染层展示与勾选 */
export interface AiToolInfo {
  name: string
  label: string
  description: string
  level: AiToolLevel
  /** 参数说明（人类可读，用于编辑页提示） */
  hint?: string
}

/** 一次工具调用的展示快照（随助手消息落盘，便于回看） */
export interface AiToolStep {
  name: string
  label: string
  args: Record<string, unknown>
  /** 结果摘要，超长已截断 */
  summary: string
  ok: boolean
  durationMs: number
}

/** 单条会话消息 */
export interface AiSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** 该轮回答中执行过的工具调用（仅助手消息） */
  steps?: AiToolStep[]
}

/** 发起流式对话的请求 */
export interface AiStreamRequest {
  /** 渲染层生成的请求 ID，用于匹配流事件与中止 */
  requestId: string
  agentId: string
  sessionId: string
  /** 前端持有的历史消息（已含本轮用户输入） */
  messages: AiChatMessage[]
}

/** 主进程推给渲染层的流事件 */
export type AiStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; step: AiToolStep }
  | { type: 'notice'; message: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** 实际跨进程传输的事件：带 requestId 便于多路复用 */
export type AiStreamEventPayload = AiStreamEvent & { requestId: string }

/** 流式调用结果（invoke 的返回值；错误详情另经事件下发） */
export interface AiStreamResult {
  ok: boolean
  /** 完整回答（便于前端做兜底渲染） */
  text?: string
  message?: string
}

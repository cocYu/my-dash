// AI 工作台共享类型（主进程与渲染层双端使用，放在中立目录）。

/** 供应商协议类型：对应三种主流 LLM HTTP 协议 */
export type AiProtocol = 'chat' | 'responses' | 'messages'

/** 供应商预设标识 */
export type AiVendorPreset = 'openai' | 'anthropic' | 'deepseek' | 'qwen' | 'moonshot' | 'zhipu' | 'openrouter' | 'custom'

/** 可用模型（GET /models 拉取结果，字段做归一化） */
export interface AiModel {
  id: string
  /** 展示名（部分供应商提供 display_name / name） */
  name?: string
  ownedBy?: string
  contextWindow?: number
}

/** 供应商配置。apiKey 在渲染层视图中为脱敏空串，主进程落盘加密 */
export interface AiProvider {
  id: string
  name: string
  preset: AiVendorPreset
  protocol: AiProtocol
  /** 根地址，不含版本路径（如 https://api.openai.com），网关层自动补 /v1 */
  baseUrl: string
  apiKey: string
  enabled: boolean
  /** 拉取到的模型缓存 */
  models: AiModel[]
  /** 用户在拉取结果中勾选的展示模型 ID；为空表示全部展示 */
  visibleModelIds?: string[]
  modelsFetchedAt?: string
  createdAt: string
  /** 渲染层视图标记：服务端已有密钥，输入框留空即保留 */
  hasApiKey?: boolean
}

/** 多模态消息部件：文本或图片（url 为 data URI，网关层按供应商协议转换） */
export interface AiTextPart {
  type: 'text'
  text: string
}
export interface AiImagePart {
  type: 'image_url'
  image_url: { url: string }
}
export type AiChatContentPart = AiTextPart | AiImagePart

/** 统一内部聊天消息。content 为纯文本或多模态部件数组（vision 模型用） */
export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AiChatContentPart[]
}

/** 统一内部聊天请求 */
export interface AiChatRequest {
  providerId: string
  model: string
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
}

/** 统一聊天响应 */
export interface AiChatResponse {
  text: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** 生图模式 */
export type AiImageMode = 'text2image' | 'image2image'

/** 统一生图请求。inputImages 为 data URI（图生图输入图，可多张） */
export interface AiImageRequest {
  providerId: string
  model: string
  mode: AiImageMode
  prompt: string
  size?: string
  quality?: string
  n?: number
  inputImages?: string[]
}

/** 单张生图结果：落附件库后的文件名 + 预览 dataUrl + 真实像素尺寸 */
export interface AiImageResult {
  name: string
  dataUrl: string
  width?: number
  height?: number
}

/** 历史记录中引用的单张图片（本体在附件库，内容寻址） */
export interface AiHistoryImage {
  name: string
  width?: number
  height?: number
}

/** 生图历史条目：提示词 / 时间 / 尺寸 / 模型 / 图片引用 */
export interface AiImageHistoryItem {
  id: string
  prompt: string
  model: string
  providerId: string
  providerName: string
  mode: AiImageMode
  size?: string
  quality?: string
  createdAt: string
  images: AiHistoryImage[]
}

/** 提示词增强请求（复用 LLM 网关，可任选已启用供应商与模型） */
export interface AiPromptEnhanceRequest {
  providerId: string
  model: string
  prompt: string
}

/** 供应商预设（新建表单下拉用） */
export interface AiPreset {
  id: AiVendorPreset
  name: string
  baseUrl: string
  protocol: AiProtocol
  note?: string
}

export const AI_PRESETS: AiPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', protocol: 'chat' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'messages' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'chat' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', protocol: 'chat' },
  { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn', protocol: 'chat' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas', protocol: 'chat' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', protocol: 'chat' },
  { id: 'custom', name: '自定义', baseUrl: '', protocol: 'chat', note: '任意兼容上述协议的网关' }
]

// ---- 用量统计 / 额度 ----

/** 一次 LLM / 生图调用的用量记录 */
export interface AiUsageRecord {
  id: string
  providerId: string
  providerName: string
  model: string
  kind: 'chat' | 'image'
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** ISO 时间，用于按日期聚合 */
  at: string
}

/** 用量查询条件（均为 YYYY-MM-DD，本地日期） */
export interface AiUsageQuery {
  date?: string
  from?: string
  to?: string
}

/** 某日（或整个查询区间）聚合结果 */
export interface AiUsageDay {
  date: string
  chatCalls: number
  imageCalls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  byProvider: {
    providerId: string
    providerName: string
    calls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }[]
}

/** 用量查询结果 */
export interface AiUsageSummary {
  records: AiUsageRecord[]
  days: AiUsageDay[]
  total: {
    chatCalls: number
    imageCalls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** 供应商额度信息（探测成功时返回） */
export interface AiQuotaInfo {
  /** 额度上限（美元/账户货币单位），未知时为 null */
  limit: number | null
  /** 已用额度（美元/账户货币单位），未知时为 null */
  used: number | null
  /** 剩余额度 */
  remaining: number | null
  /** 货币标识，如 USD / CNY */
  currency: string
  /** 探测来源，便于用户判断可信度 */
  source: string
  /** 探测时间 ISO */
  checkedAt: string
}

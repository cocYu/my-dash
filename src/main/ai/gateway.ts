// LLM 网关层：把 chat / responses / messages 三种协议归一化到统一接口。
// 主进程发请求（无 CORS 限制），渲染层只调统一内部格式。
//   chat      → OpenAI Chat Completions   POST /v1/chat/completions
//   responses → OpenAI Responses API      POST /v1/responses
//   messages  → Anthropic Messages API    POST /v1/messages
import type { AiChatMessage, AiChatRequest, AiChatResponse, AiModel, AiProvider, AiProtocol } from '../../types/ai'

const DEFAULT_TIMEOUT = 120_000

/** 根地址补版本路径：用户填根地址即可，已带 /vN 时不重复补 */
function apiBase(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (!b) throw new Error('接口地址未配置')
  if (/\/v\d+$/.test(b)) return b
  return `${b}/v1`
}

/** 按协议构造鉴权头 */
function authHeaders(provider: AiProvider): Record<string, string> {
  const key = provider.apiKey
  if (!key) throw new Error(`供应商「${provider.name}」尚未配置 API Key`)
  if (provider.protocol === 'messages') {
    return {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }
  }
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
}

/** 读取响应体并转成可读错误（失败时抛错，成功返回解析后的 JSON） */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const body = JSON.parse(text) as Record<string, unknown>
      const err = body.error
      if (typeof err === 'string') detail = err
      else if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>
        detail = typeof e.message === 'string' ? e.message : text
      } else if (typeof body.message === 'string') detail = body.message
    } catch {
      /* 非 JSON 响应，直接用原文 */
    }
    throw new Error(`HTTP ${res.status}：${detail.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('供应商返回了无法解析的响应')
  }
}

// ---- 请求构造 ----

function buildChatBody(req: AiChatRequest, protocol: AiProtocol): Record<string, unknown> {
  if (protocol === 'responses') {
    // Responses API：input 为消息数组，content 可为字符串或 input_text 块
    return {
      model: req.model,
      input: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_output_tokens: req.maxTokens } : {})
    }
  }
  if (protocol === 'messages') {
    // Anthropic：system 单列顶层，messages 仅 user/assistant
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    const turns = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))
    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: turns,
      ...(system ? { system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
    }
  }
  // OpenAI Chat Completions
  return {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})
  }
}

function endpointFor(protocol: AiProtocol): string {
  if (protocol === 'responses') return '/responses'
  if (protocol === 'messages') return '/messages'
  return '/chat/completions'
}

// ---- 响应解析 ----

/** 从 content 块中提取文本（兼容 string / [{type:text,text}] / [{type:output_text,text}]） */
function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object') {
          const o = c as Record<string, unknown>
          if (typeof o.text === 'string') return o.text
        }
        return ''
      })
      .join('')
  }
  return ''
}

function parseChatResponse(body: Record<string, unknown>, protocol: AiProtocol): AiChatResponse {
  let text = ''
  if (protocol === 'chat') {
    const choices = body.choices as Record<string, unknown>[] | undefined
    const first = choices?.[0]?.message as Record<string, unknown> | undefined
    text = textFromContent(first?.content)
  } else if (protocol === 'responses') {
    // 优先顶层 output_text，否则遍历 output[].content[]
    if (typeof body.output_text === 'string' && body.output_text) {
      text = body.output_text
    } else {
      const output = body.output as Record<string, unknown>[] | undefined
      for (const item of output ?? []) {
        if (item.type !== 'message') continue
        const parts = item.content as Record<string, unknown>[] | undefined
        for (const p of parts ?? []) {
          if (p.type === 'output_text' && typeof p.text === 'string') text += p.text
        }
      }
    }
  } else {
    // Anthropic messages：content[] 内 type=text 的块
    const content = body.content as Record<string, unknown>[] | undefined
    for (const c of content ?? []) {
      if (c.type === 'text' && typeof c.text === 'string') text += c.text
    }
  }

  const usage = body.usage as Record<string, unknown> | undefined
  const promptKey = protocol === 'chat' ? 'prompt_tokens' : 'input_tokens'
  const completionKey = protocol === 'chat' ? 'completion_tokens' : 'output_tokens'
  return {
    text,
    usage: usage
      ? {
          promptTokens: Number(usage[promptKey] ?? 0),
          completionTokens: Number(usage[completionKey] ?? 0),
          totalTokens: Number(usage.total_tokens ?? (Number(usage[promptKey] ?? 0) + Number(usage[completionKey] ?? 0)))
        }
      : undefined
  }
}

// ---- 对外接口 ----

/** 统一聊天调用 */
export async function chatOnce(provider: AiProvider, req: AiChatRequest): Promise<AiChatResponse> {
  const url = `${apiBase(provider.baseUrl)}${endpointFor(provider.protocol)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(provider),
    body: JSON.stringify(buildChatBody(req, provider.protocol)),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
  })
  const body = await readJson(res)
  return parseChatResponse(body, provider.protocol)
}

/** 拉取供应商可用模型，归一化字段（兼容 OpenAI / Anthropic / 常见网关） */
export async function fetchModels(provider: AiProvider): Promise<AiModel[]> {
  const url = `${apiBase(provider.baseUrl)}/models`
  const res = await fetch(url, {
    headers: authHeaders(provider),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
  })
  const body = await readJson(res)
  const raw = (Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
      ? body.models
      : []) as Record<string, unknown>[]
  return raw
    .map((m) => {
      const id = typeof m.id === 'string' ? m.id : typeof m.name === 'string' ? m.name : ''
      if (!id) return null
      const name = typeof m.display_name === 'string' ? m.display_name : typeof m.name === 'string' ? m.name : undefined
      const ownedBy = typeof m.owned_by === 'string' ? m.owned_by : undefined
      const ctx = typeof m.context_window === 'number' ? m.context_window : undefined
      return { id, ...(name && name !== id ? { name } : {}), ...(ownedBy ? { ownedBy } : {}), ...(ctx ? { contextWindow: ctx } : {}) } as AiModel
    })
    .filter((m): m is AiModel => m !== null)
}

/** 连通性/凭据自检：拉一次模型列表，成功即返回数量 */
export async function testProvider(provider: AiProvider): Promise<{ models: number }> {
  const models = await fetchModels(provider)
  return { models: models.length }
}

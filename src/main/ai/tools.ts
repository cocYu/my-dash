// Agent 工具注册表：本地能力的统一封装，供 LLM 以函数调用形式使用。
// 本批次只开放只读工具（read）：查文件夹 / 列笔记 / 搜笔记 / 读笔记 / 查待办 / 取当前时间。
// 写操作与破坏性操作在后续批次加入，并配套确认弹窗与审计日志。
import type { AiAgent, AiToolInfo, AiToolLevel } from '../../types/agent'

export interface ToolContext {
  baseUrl: string
  token: string
}

/** 供 LLM 使用的函数声明（JSON Schema） */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface ToolDef extends AiToolInfo {
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

/** 工具返回内容的字符上限：超出会截断，避免撑爆上下文 */
export const TOOL_RESULT_LIMIT = 4000

// ---- 通用助手 ----

function apiUrl(ctx: ToolContext, pathname: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(pathname, ctx.baseUrl)
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  return url.toString()
}

async function apiGet(ctx: ToolContext, pathname: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
  const res = await fetch(apiUrl(ctx, pathname, params), {
    headers: { 'X-API-Token': ctx.token }
  })
  const text = await res.text()
  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* 非 JSON */
  }
  if (!res.ok || !body) {
    const msg = body && typeof body.message === 'string' ? body.message : text.slice(0, 200)
    throw new Error(`本地接口 ${pathname} 调用失败（HTTP ${res.status}）：${msg}`)
  }
  if (typeof body.code === 'number' && body.code !== 0) {
    throw new Error(`本地接口 ${pathname} 返回错误：${String(body.message ?? body.code)}`)
  }
  return body.data
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

/** 取前 n 个字符，超出补提示 */
export function clipText(text: string, limit = TOOL_RESULT_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n（内容过长已截断，原始长度 ${text.length} 字符）`
}

function fmtTime(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---- 工具定义 ----

const TOOLS: ToolDef[] = [
  {
    name: 'list_folders',
    label: '列出文件夹',
    level: 'read',
    description:
      '列出全部笔记文件夹及其层级关系。当你不确定笔记放在哪个文件夹、或需要向用户说明目录结构时先调用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_args, ctx) => {
      const folders = (await apiGet(ctx, '/api/folders')) as Record<string, unknown>[]
      if (!Array.isArray(folders) || !folders.length) return '当前没有任何笔记文件夹。'
      const lines = folders.map((f) => {
        const parent = f.parent_id === null || f.parent_id === undefined ? '根目录' : `父文件夹 #${String(f.parent_id)}`
        return `#${String(f.id)} ${String(f.name ?? '')}（${parent}）`
      })
      return `共 ${folders.length} 个文件夹：\n${lines.join('\n')}`
    }
  },
  {
    name: 'list_notes',
    label: '列出笔记',
    level: 'read',
    description:
      '按更新时间倒序列出笔记标题（不含正文）。用于了解用户有哪些笔记、或缩小阅读范围。只看某一文件夹时传 folder_id。',
    parameters: {
      type: 'object',
      properties: {
        folder_id: { type: 'number', description: '只列出该文件夹下的笔记；不传表示全部' },
        limit: { type: 'number', description: '返回条数，默认 30，最大 100' }
      },
      additionalProperties: false
    },
    run: async (args, ctx) => {
      const folderId = asNumber(args.folder_id)
      let limit = asNumber(args.limit) ?? 30
      if (limit < 1) limit = 1
      if (limit > 100) limit = 100
      const all = (await apiGet(ctx, '/api/notes')) as Record<string, unknown>[]
      if (!Array.isArray(all) || !all.length) return '当前没有任何笔记。'
      const filtered = folderId === undefined ? all : all.filter((n) => asNumber(n.folder_id) === folderId)
      if (!filtered.length) return `文件夹 #${folderId} 下没有笔记。`
      const sorted = [...filtered].sort((a, b) => asString(b.updated_at).localeCompare(asString(a.updated_at)))
      const lines = sorted.slice(0, limit).map((n) => {
        const folder = n.folder_id === null || n.folder_id === undefined ? '根目录' : `文件夹 #${String(n.folder_id)}`
        return `#${String(n.id)} ${asString(n.title, '(无标题)')}｜${folder}｜更新于 ${fmtTime(n.updated_at)}`
      })
      const head = `共 ${filtered.length} 篇，展示最近 ${Math.min(limit, filtered.length)} 篇：`
      return `${head}\n${lines.join('\n')}`
    }
  },
  {
    name: 'search_notes',
    label: '搜索笔记',
    level: 'read',
    description:
      '在笔记标题与正文中搜索关键词，返回命中笔记及上下文片段。用户问“我记过关于 X 的内容吗”这类问题时必须先用它，再决定是否 read_note。',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '关键词，支持中文与英文子串' },
        limit: { type: 'number', description: '返回条数，默认 10，最大 30' }
      },
      required: ['q'],
      additionalProperties: false
    },
    run: async (args, ctx) => {
      const q = asString(args.q).trim()
      if (!q) return '搜索关键词为空，请提供 q 参数。'
      let limit = asNumber(args.limit) ?? 10
      if (limit < 1) limit = 1
      if (limit > 30) limit = 30
      const hits = (await apiGet(ctx, '/api/search/notes', { q, limit })) as Record<string, unknown>[]
      if (!Array.isArray(hits) || !hits.length) return `没有找到包含「${q}」的笔记。`
      const lines = hits.map((h) => {
        const snippet = asString(h.snippet)
        return `#${String(h.id)} ${asString(h.title, '(无标题)')}｜更新于 ${fmtTime(h.updated_at)}${snippet ? `\n   片段：${snippet}` : ''}`
      })
      return `「${q}」命中 ${hits.length} 篇：\n${lines.join('\n')}`
    }
  },
  {
    name: 'read_note',
    label: '读取笔记',
    level: 'read',
    description:
      '读取一篇笔记的完整内容（Markdown）。长文会分段返回：若结果提示还有后续内容，用相同的 id 加上 offset 继续读取。回答涉及笔记细节时必须依据这里的原文，不要凭空推测。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '笔记 ID（来自 list_notes / search_notes）' },
        offset: { type: 'number', description: '从第几个字符开始读，默认 0；续读时传上次结果末尾提示的数值' }
      },
      required: ['id'],
      additionalProperties: false
    },
    run: async (args, ctx) => {
      const id = asNumber(args.id)
      if (id === undefined) return '缺少笔记 id 参数。'
      const offset = Math.max(0, asNumber(args.offset) ?? 0)
      const note = (await apiGet(ctx, `/api/notes/${id}`)) as Record<string, unknown>
      if (!note || typeof note !== 'object') return `没有找到笔记 #${id}。`
      const content = asString(note.content)
      const chunkLimit = 3200
      const chunk = content.slice(offset, offset + chunkLimit)
      const nextOffset = offset + chunk.length
      const tail =
        nextOffset < content.length
          ? `\n\n（本段结束于第 ${nextOffset} 字符，全文共 ${content.length} 字符。如需继续，请用 offset=${nextOffset} 再次调用 read_note）`
          : ''
      return `《${asString(note.title, '(无标题)')}》（#${id}，更新于 ${fmtTime(note.updated_at)}）\n\n${chunk}${tail}`
    }
  },
  {
    name: 'query_todos',
    label: '查询待办',
    level: 'read',
    description:
      '查询用户待办事项，可按状态、关键词、截止时间筛选。用户问“还有什么没做”“今天要交什么”时使用。状态：open 未完成 / done 已完成 / closed 已关闭。',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'open', 'done', 'closed'], description: '默认 open' },
        keyword: { type: 'string', description: '标题或描述关键词' },
        due_within_days: { type: 'number', description: '只看未来 N 天内到期的（负数表示已逾期）' },
        limit: { type: 'number', description: '返回条数，默认 30，最大 100' }
      },
      additionalProperties: false
    },
    run: async (args, ctx) => {
      const status = asString(args.status, 'open') || 'open'
      const keyword = asString(args.keyword).trim().toLowerCase()
      const dueWithin = asNumber(args.due_within_days)
      let limit = asNumber(args.limit) ?? 30
      if (limit < 1) limit = 1
      if (limit > 100) limit = 100

      const [all, categories] = await Promise.all([
        apiGet(ctx, '/api/todos') as Promise<Record<string, unknown>[]>,
        apiGet(ctx, '/api/todo-categories').catch(() => []) as Promise<Record<string, unknown>[]>
      ])
      if (!Array.isArray(all) || !all.length) return '当前没有任何待办。'
      const catName = new Map<string, string>()
      if (Array.isArray(categories)) {
        for (const c of categories) catName.set(String(c.id), asString(c.name))
      }

      const now = Date.now()
      const filtered = all.filter((t) => {
        if (status !== 'all' && asString(t.status) !== status) return false
        if (keyword) {
          const hay = `${asString(t.title)} ${asString(t.subtitle)} ${asString(t.description)}`.toLowerCase()
          if (!hay.includes(keyword)) return false
        }
        if (dueWithin !== undefined) {
          const due = asString(t.due_at)
          if (!due) return false
          const dueMs = new Date(due).getTime()
          if (Number.isNaN(dueMs)) return false
          const diffDays = (dueMs - now) / 86_400_000
          if (dueWithin >= 0 ? diffDays > dueWithin || diffDays < 0 : diffDays >= 0) return false
        }
        return true
      })
      if (!filtered.length) return '按当前条件没有匹配的待办。'

      const sorted = [...filtered].sort((a, b) => asString(a.due_at || '').localeCompare(asString(b.due_at || '')))
      const lines = sorted.slice(0, limit).map((t) => {
        const bits = [`#${String(t.id)}`, asString(t.title, '(无标题)')]
        const cid = t.category_id === null || t.category_id === undefined ? '' : catName.get(String(t.category_id))
        if (cid) bits.push(`[${cid}]`)
        bits.push(`状态=${asString(t.status)}`)
        if (t.due_at) bits.push(`截止 ${fmtTime(t.due_at)}`)
        if (t.priority) bits.push(`优先级 ${String(t.priority)}`)
        const total = asNumber(t.sub_total) ?? 0
        if (total > 0) bits.push(`子任务 ${String(asNumber(t.sub_done) ?? 0)}/${String(total)}`)
        if (asString(t.description).trim()) bits.push(`描述：${asString(t.description).replace(/\s+/g, ' ').slice(0, 60)}`)
        return bits.join('｜')
      })
      return `匹配 ${filtered.length} 条，展示 ${Math.min(limit, sorted.length)} 条：\n${lines.join('\n')}`
    }
  },
  {
    name: 'get_current_time',
    label: '获取当前时间',
    level: 'read',
    description: '获取本机当前日期与时间。涉及“今天/本周/最近”等相对时间时先调用，不要凭训练数据猜测。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const now = new Date()
      const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
      const pad = (n: number): string => String(n).padStart(2, '0')
      const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      return `本地时间：${local}（${week}），时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}；UTC：${now.toISOString()}`
    }
  }
]

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]))

/** 工具目录（渲染层勾选用） */
export function toolCatalog(): AiToolInfo[] {
  return TOOLS.map(({ name, label, description, level, hint }) => ({
    name,
    label,
    description,
    level,
    ...(hint ? { hint } : {})
  }))
}

/** Agent 实际可用的工具：白名单过滤，未知名称忽略 */
export function toolsForAgent(agent: AiAgent): ToolDef[] {
  const allowed = Array.isArray(agent.tools) ? agent.tools : []
  return allowed.map((n) => TOOL_MAP.get(n)).filter((t): t is ToolDef => Boolean(t))
}

/** 转成协议无关的函数声明 */
export function toolSchemas(tools: ToolDef[]): ToolSchema[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

/** 默认开启的只读工具（新建 Agent 时用） */
export function defaultReadTools(): string[] {
  return TOOLS.filter((t) => t.level === 'read').map((t) => t.name)
}

export function toolLevelOf(name: string): AiToolLevel | null {
  return TOOL_MAP.get(name)?.level ?? null
}

export { TOOL_MAP }
export type { ToolDef }

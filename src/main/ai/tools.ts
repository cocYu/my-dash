// Agent 工具注册表：本地能力的统一封装，供 LLM 以函数调用形式使用。
// 只读工具（read）直接执行；写工具（write）必须经用户确认后才执行，并落审计日志。
import type { AiProvider } from '../../types/ai'
import type { AiAgent, AiToolInfo, AiToolLevel } from '../../types/agent'
import { generateImageAndRecord } from './image'

/** 写操作确认请求（requestId 由 IPC 层补齐） */
export interface ToolConfirmInput {
  tool: string
  label: string
  /** 一句话说明将要做什么 */
  summary: string
  /** 详细内容预览（如将要写入的正文片段） */
  detail?: string
  level: AiToolLevel
}

export interface ToolContext {
  baseUrl: string
  token: string
  /** 当前运行中的 Agent：生图等工具需要读取助手级配置 */
  agent?: AiAgent
  /** 读取供应商列表（含解密后的密钥），生图工具据此调用图像接口 */
  getProviders?: () => AiProvider[]
  /** 写操作确认回调；未注入时一律拒绝写操作（安全默认） */
  confirm?: (req: ToolConfirmInput) => Promise<boolean>
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
  /** 写操作执行前给用户看的说明；只读工具不需要 */
  preview?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolPreview> | ToolPreview
}

export interface ToolPreview {
  summary: string
  detail?: string
}

/** 工具返回内容的字符上限：超出会截断，避免撑爆上下文 */
export const TOOL_RESULT_LIMIT = 4000
/** 确认弹窗里正文预览的上限 */
const PREVIEW_LIMIT = 800

// ---- 通用助手 ----

function apiUrl(ctx: ToolContext, pathname: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(pathname, ctx.baseUrl)
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  return url.toString()
}

/** 统一解析后端响应：HTTP 非 2xx 或 code != 0 都抛错 */
async function readApiBody(res: Response, pathname: string): Promise<unknown> {
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

async function apiGet(
  ctx: ToolContext,
  pathname: string,
  params?: Record<string, string | number | undefined>
): Promise<unknown> {
  const res = await fetch(apiUrl(ctx, pathname, params), {
    headers: { 'X-API-Token': ctx.token }
  })
  return readApiBody(res, pathname)
}

async function apiSend(
  ctx: ToolContext,
  method: 'POST' | 'PUT' | 'DELETE',
  pathname: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(apiUrl(ctx, pathname), {
    method,
    headers: { 'X-API-Token': ctx.token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  return readApiBody(res, pathname)
}

/** 正文预览：超长截断并标注原长 */
function previewBody(text: string): string {
  if (!text) return '（正文为空）'
  if (text.length <= PREVIEW_LIMIT) return text
  return `${text.slice(0, PREVIEW_LIMIT)}\n…（共 ${text.length} 字，预览已截断）`
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

/** 供应商展示名：找不到时退回占位文案，避免确认弹窗信息缺失 */
function providerNameOf(ctx: ToolContext, id: string): string {
  if (!id) return '未选择供应商'
  return ctx.getProviders?.().find((p) => p.id === id)?.name ?? `供应商 #${id}`
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
  },
  {
    name: 'create_note',
    label: '新建笔记',
    level: 'write',
    description:
      '在用户笔记库里新建一篇 Markdown 笔记。仅当用户明确要求记录、保存、写一篇笔记时调用；只是讨论内容不要擅自建档。不确定文件夹时先 list_folders，或直接放根目录。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '笔记标题；同一文件夹内不能重名' },
        content: { type: 'string', description: 'Markdown 正文' },
        folder_id: { type: 'number', description: '目标文件夹 ID；不传表示根目录' }
      },
      required: ['title'],
      additionalProperties: false
    },
    preview: (args) => {
      const title = asString(args.title).trim()
      const content = asString(args.content)
      const fid = asNumber(args.folder_id)
      return {
        summary: `在${fid === undefined ? '根目录' : `文件夹 #${fid}`}新建笔记《${title || '(无标题)'}》，正文 ${content.length} 字`,
        detail: previewBody(content)
      }
    },
    run: async (args, ctx) => {
      const title = asString(args.title).trim()
      if (!title) return '缺少标题，请提供 title 参数。'
      const content = asString(args.content)
      const fid = asNumber(args.folder_id)
      const created = (await apiSend(ctx, 'POST', '/api/notes', {
        title,
        content,
        ...(fid !== undefined ? { folder_id: fid } : {})
      })) as Record<string, unknown>
      return `已创建笔记《${asString(created.title, title)}》，ID=${String(created.id)}，正文 ${content.length} 字。`
    }
  },
  {
    name: 'update_note',
    label: '修改笔记',
    level: 'write',
    description:
      '修改已有笔记。content 会整体覆盖原正文（不是追加），只改标题时可省略 content。用户没有明确要求改写时不要调用；改写前建议先 read_note 拿到原文。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '笔记 ID（来自 list_notes / search_notes / read_note）' },
        title: { type: 'string', description: '新标题；不传表示不改' },
        content: { type: 'string', description: '新的完整正文，会覆盖原内容；不传表示不改' }
      },
      required: ['id'],
      additionalProperties: false
    },
    preview: async (args, ctx) => {
      const id = asNumber(args.id)
      const hasTitle = args.title !== undefined
      const hasContent = args.content !== undefined
      const nextTitle = hasTitle ? asString(args.title) : ''
      const nextContent = hasContent ? asString(args.content) : ''

      let oldTitle = ''
      if (id !== undefined) {
        try {
          const note = (await apiGet(ctx, `/api/notes/${id}`)) as Record<string, unknown>
          oldTitle = asString(note.title)
        } catch {
          /* 读不到原名不影响确认流程 */
        }
      }
      const parts: string[] = []
      if (hasTitle) parts.push(`标题改为《${nextTitle || '(空)'}》`)
      if (hasContent) parts.push(`正文整体覆盖为 ${nextContent.length} 字`)
      return {
        summary: `修改笔记${oldTitle ? `《${oldTitle}》` : ` #${String(id)}`}：${parts.join('；') || '无实际改动'}`,
        detail: hasContent ? previewBody(nextContent) : undefined
      }
    },
    run: async (args, ctx) => {
      const id = asNumber(args.id)
      if (id === undefined) return '缺少笔记 id 参数。'
      const body: Record<string, unknown> = {}
      if (args.title !== undefined) body.title = asString(args.title)
      if (args.content !== undefined) body.content = asString(args.content)
      if (!Object.keys(body).length) return '没有提供任何需要修改的字段（title / content）。'
      const updated = (await apiSend(ctx, 'PUT', `/api/notes/${id}`, body)) as Record<string, unknown>
      return `已更新笔记《${asString(updated.title, String(id))}》，更新于 ${fmtTime(updated.updated_at)}。`
    }
  },
  {
    name: 'create_todo',
    label: '新建待办',
    level: 'write',
    description:
      '为用户新建一条待办。仅当用户明确要求加待办、提醒、记一件要做的事时调用。截止时间用 ISO 8601（如 2026-11-20T18:00:00+08:00）；需要相对时间时先 get_current_time。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '待办标题' },
        description: { type: 'string', description: '补充说明' },
        priority: { type: 'number', description: '优先级 0-6，0 最高，默认 4' },
        due_at: { type: 'string', description: '截止时间，ISO 8601 带时区' }
      },
      required: ['title'],
      additionalProperties: false
    },
    preview: (args) => {
      const title = asString(args.title).trim()
      const pri = asNumber(args.priority)
      const due = asString(args.due_at).trim()
      const bits = [`新建待办「${title || '(未命名)'}」`]
      if (pri !== undefined) bits.push(`优先级 P${Math.max(0, Math.min(6, Math.round(pri)))}`)
      if (due) bits.push(`截止 ${due}`)
      const desc = asString(args.description).trim()
      return { summary: bits.join('，'), detail: desc || undefined }
    },
    run: async (args, ctx) => {
      const title = asString(args.title).trim()
      if (!title) return '缺少标题，请提供 title 参数。'
      const body: Record<string, unknown> = { title }
      const desc = asString(args.description).trim()
      if (desc) body.description = desc
      const pri = asNumber(args.priority)
      if (pri !== undefined) body.priority = Math.max(0, Math.min(6, Math.round(pri)))
      const due = asString(args.due_at).trim()
      if (due) {
        const ms = new Date(due).getTime()
        if (Number.isNaN(ms)) return `截止时间无法解析：${due}。请使用 ISO 8601，例如 2026-11-20T18:00:00+08:00。`
        // 后端存 UTC RFC3339，去掉毫秒保持格式一致
        body.due_at = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
      }
      const created = (await apiSend(ctx, 'POST', '/api/todos', body)) as Record<string, unknown>
      return `已创建待办「${asString(created.title, title)}」，ID=${String(created.id)}，状态=${asString(created.status, 'open')}。`
    }
  },
  {
    name: 'delete_note',
    label: '删除笔记',
    level: 'destructive',
    description:
      '永久删除一篇笔记，连同它的全部历史版本，删除后无法恢复。仅当用户明确要求删除某篇笔记时调用；不确定是哪一篇时先用 search_notes / list_notes 核实。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '要删除的笔记 ID（务必先核实）' }
      },
      required: ['id'],
      additionalProperties: false
    },
    preview: async (args, ctx) => {
      const id = asNumber(args.id)
      if (id === undefined) return { summary: '缺少笔记 ID，无法删除' }
      try {
        const note = (await apiGet(ctx, `/api/notes/${id}`)) as Record<string, unknown>
        const title = asString(note.title, '(无标题)')
        const content = asString(note.content)
        return {
          summary: `永久删除笔记《${title}》（#${id}，正文 ${content.length} 字），历史版本一并清除，不可恢复`,
          detail: previewBody(content)
        }
      } catch {
        return { summary: `永久删除笔记 #${id}（未能读取标题），历史版本一并清除，不可恢复` }
      }
    },
    run: async (args, ctx) => {
      const id = asNumber(args.id)
      if (id === undefined) return '缺少笔记 id 参数。'
      await apiSend(ctx, 'DELETE', `/api/notes/${id}`)
      return `已删除笔记 #${id}，历史版本一并清除。`
    }
  },
  {
    name: 'generate_image',
    label: '生成图片',
    level: 'paid',
    description:
      '按提示词调用图像生成模型画一张图（会产生费用）。图片会存入附件库与生图历史，并在回复中以 Markdown 图片展示。仅在用户明确要求画图、生成插画/海报/图标时调用；提示词要写清主体、场景、风格、光线、构图。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '完整的生图提示词（建议包含主体、风格、光线、画质词）' },
        size: {
          type: 'string',
          description: '图片尺寸，如 1024x1024 / 1536x1024 / 1024x1536；不传则用助手配置的默认尺寸'
        }
      },
      required: ['prompt'],
      additionalProperties: false
    },
    preview: (args, ctx) => {
      const prompt = asString(args.prompt).trim()
      const model = ctx.agent?.imageModel?.trim()
      const provider = ctx.agent?.imageProviderId?.trim() || ctx.agent?.providerId || ''
      const size = asString(args.size).trim() || ctx.agent?.imageSize?.trim() || '默认尺寸'
      const who = model ? `${providerNameOf(ctx, provider)} / ${model}` : '尚未配置生图模型'
      return {
        summary: `调用 ${who} 生成 1 张图片（${size}），属于付费操作`,
        detail: prompt ? `提示词：${prompt}` : '提示词为空'
      }
    },
    run: async (args, ctx) => {
      const prompt = asString(args.prompt).trim()
      if (!prompt) return '缺少提示词，请提供 prompt 参数。'

      const agent = ctx.agent
      const model = agent?.imageModel?.trim()
      if (!model) {
        return '助手没有配置生图模型，无法生成图片。请告知用户在助手编辑页的「生图配置」里选择供应商与模型，或到「AI 生图」页手动生成。'
      }
      const providerId = agent?.imageProviderId?.trim() || agent?.providerId || ''
      const provider = (ctx.getProviders?.() ?? []).find((p) => p.id === providerId)
      if (!provider) {
        return '找不到可用的生图供应商配置。请告知用户在助手编辑页重新选择生图供应商。'
      }
      if (!provider.apiKey) {
        return `生图供应商「${provider.name}」缺少 API Key，请到「供应商管理」补全后再试。`
      }

      const size = asString(args.size).trim() || agent?.imageSize?.trim() || undefined
      const results = await generateImageAndRecord(provider, {
        providerId: provider.id,
        model,
        mode: 'text2image',
        prompt,
        ...(size ? { size } : {}),
        n: 1
      })
      const first = results[0]
      if (!first) return '生图接口没有返回图片数据。'

      const dims = first.width && first.height ? `${first.width}×${first.height}` : size || '尺寸未知'
      return [
        `已生成 1 张图片（${dims}，模型 ${model}），已存入附件库与生图历史。`,
        `![生成的图片](attach://${first.name})`,
        `引用名：attach://${first.name}`
      ].join('\n')
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

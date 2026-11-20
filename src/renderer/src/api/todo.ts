// 待办模块 API：待办 / 分类 / 标签 / 评论。
import { request } from './http'

export type TodoStatus = 'open' | 'done' | 'closed'

/** 重复规则类型：'' 不重复 / daily 每天 / weekly 每周 / monthly 每月 / custom 每 N 天 */
export type RecType = '' | 'daily' | 'weekly' | 'monthly' | 'custom'

export interface Todo {
  id: number
  category_id: number | null
  parent_id: number | null
  title: string
  subtitle: string
  description: string
  /** 0-6 对应 P0-P6，P0 最高 */
  priority: number
  status: TodoStatus
  start_at: string | null
  due_at: string | null
  /** 距截止时间多少分钟标记为「即将超时」；null 不提示（旧单档字段，warn_offsets 为空时兜底） */
  warn_minutes: number | null
  /** 多档提前提醒（分钟，升序）；空数组时退化用 warn_minutes */
  warn_offsets: number[]
  /** 重复规则（仅顶层待办生效，完成后自动生成下一期） */
  rec_type: RecType
  rec_interval: number
  sort: number
  completed_at: string | null
  created_at: string
  updated_at: string
  /** 回收站：进入回收站的时间；null = 未删除 */
  deleted_at: string | null
  tags: string[]
  sub_total: number
  sub_done: number
}

export interface TodoCategory {
  id: number
  name: string
  sort: number
  created_at: string
  updated_at: string
  count: number
}

export interface TodoTag {
  id: number
  name: string
  count: number
}

export interface TodoComment {
  id: number
  todo_id: number
  content: string
  created_at: string
}

// ---- 待办 ----
export function listTodos(): Promise<Todo[]> {
  return request<Todo[]>({ url: '/api/todos', method: 'GET' })
}
export function createTodo(data: Partial<Todo> & { title: string; tags?: string[] }): Promise<Todo> {
  return request<Todo>({ url: '/api/todos', method: 'POST', data })
}
export function updateTodo(id: number, data: Partial<Todo> & { tags?: string[] }): Promise<Todo> {
  return request<Todo>({ url: `/api/todos/${id}`, method: 'PUT', data })
}
export function setTodoStatus(id: number, status: TodoStatus): Promise<Todo> {
  return request<Todo>({ url: `/api/todos/${id}/status`, method: 'POST', data: { status } })
}
export function deleteTodo(id: number): Promise<void> {
  return request<void>({ url: `/api/todos/${id}`, method: 'DELETE' })
}

// ---- 回收站 ----
export function listTrash(): Promise<Todo[]> {
  return request<Todo[]>({ url: '/api/todos/trash', method: 'GET' })
}
export function restoreTodo(id: number): Promise<void> {
  return request<void>({ url: `/api/todos/${id}/restore`, method: 'POST' })
}
export function purgeTodo(id: number): Promise<void> {
  return request<void>({ url: `/api/todos/${id}/purge`, method: 'POST' })
}

// ---- 批量 / 排序 ----
export type BatchOp = 'done' | 'open' | 'closed' | 'category' | 'tags_add' | 'tags_remove' | 'delete'
export function batchTodos(
  ids: number[],
  op: BatchOp,
  payload?: { category_id?: number | null; tags?: string[] }
): Promise<void> {
  return request<void>({ url: '/api/todos/batch', method: 'POST', data: { ids, op, ...payload } })
}
export function sortTodos(ids: number[]): Promise<void> {
  return request<void>({ url: '/api/todos/sort', method: 'POST', data: { ids } })
}

// ---- 评论 ----
export function listComments(todoId: number): Promise<TodoComment[]> {
  return request<TodoComment[]>({ url: `/api/todos/${todoId}/comments`, method: 'GET' })
}
export function addComment(todoId: number, content: string): Promise<TodoComment> {
  return request<TodoComment>({ url: `/api/todos/${todoId}/comments`, method: 'POST', data: { content } })
}
export function deleteComment(todoId: number, commentId: number): Promise<void> {
  return request<void>({ url: `/api/todos/${todoId}/comments/${commentId}`, method: 'DELETE' })
}

// ---- 分类 ----
export function listTodoCategories(): Promise<TodoCategory[]> {
  return request<TodoCategory[]>({ url: '/api/todo-categories', method: 'GET' })
}
export function createTodoCategory(name: string): Promise<TodoCategory> {
  return request<TodoCategory>({ url: '/api/todo-categories', method: 'POST', data: { name } })
}
export function renameTodoCategory(id: number, name: string): Promise<void> {
  return request<void>({ url: `/api/todo-categories/${id}`, method: 'PUT', data: { name } })
}
export function deleteTodoCategory(id: number): Promise<void> {
  return request<void>({ url: `/api/todo-categories/${id}`, method: 'DELETE' })
}

// ---- 标签 ----
export function listTodoTags(): Promise<TodoTag[]> {
  return request<TodoTag[]>({ url: '/api/todo-tags', method: 'GET' })
}

// ---- 展示辅助 ----

export interface PriorityMeta {
  value: number
  label: string
  color: string
}

/** P0 最高（红）→ P6 最低（灰） */
export const PRIORITIES: PriorityMeta[] = [
  { value: 0, label: 'P0 紧急', color: '#e5484d' },
  { value: 1, label: 'P1 极高', color: '#f76b15' },
  { value: 2, label: 'P2 高', color: '#ff9f1a' },
  { value: 3, label: 'P3 中高', color: '#e0a100' },
  { value: 4, label: 'P4 中', color: '#4c8dff' },
  { value: 5, label: 'P5 低', color: '#7aa7e9' },
  { value: 6, label: 'P6 极低', color: '#9aa5b1' }
]

export function priorityMeta(value: number): PriorityMeta {
  return PRIORITIES[Math.min(6, Math.max(0, value))]
}

export type DueState = 'none' | 'soon' | 'overdue'

/** 截止时间状态：仅对待处理任务生效；warn_minutes 配置了才提示「即将超时」 */
export function dueState(t: Todo, now = Date.now()): DueState {
  if (!t.due_at || t.status !== 'open') return 'none'
  const due = Date.parse(t.due_at)
  if (Number.isNaN(due)) return 'none'
  if (now >= due) return 'overdue'
  if (t.warn_minutes != null && now >= due - t.warn_minutes * 60000) return 'soon'
  return 'none'
}

/** 截止时间的紧凑展示：今天/明天 + HH:mm，更早/更晚用完整日期 */
export function formatDue(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const dayStart = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((dayStart(d) - dayStart(now)) / 86400000)
  if (diffDays === 0) return `今天 ${hm}`
  if (diffDays === 1) return `明天 ${hm}`
  if (diffDays === -1) return `昨天 ${hm}`
  const sameYear = d.getFullYear() === now.getFullYear()
  return `${sameYear ? '' : `${d.getFullYear()}-`}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

/** 距截止的剩余时间文案（如 3 小时 / 2 天） */
export function untilDueText(t: Todo, now = Date.now()): string {
  if (!t.due_at) return ''
  const diff = Date.parse(t.due_at) - now
  const abs = Math.abs(diff)
  const past = diff < 0
  const minutes = Math.round(abs / 60000)
  let text: string
  if (minutes < 60) text = `${minutes} 分钟`
  else if (minutes < 60 * 24) text = `${Math.round(minutes / 60)} 小时`
  else text = `${Math.round(minutes / (60 * 24))} 天`
  return past ? `超时 ${text}` : `剩 ${text}`
}

/** 时间选择值 ↔ ISO 字符串 */
export function toDateInput(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
export function fromDateInput(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

// ---- 多档提前提醒 ----

/** 提前提醒档位预设（分钟） */
export const WARN_OFFSET_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 30, label: '提前 30 分钟' },
  { minutes: 60, label: '提前 1 小时' },
  { minutes: 180, label: '提前 3 小时' },
  { minutes: 720, label: '提前 12 小时' },
  { minutes: 1440, label: '提前 1 天' },
  { minutes: 2880, label: '提前 2 天' },
  { minutes: 4320, label: '提前 3 天' },
  { minutes: 10080, label: '提前 1 周' }
]

/** 分钟数 → 档位文案（任意自定义档位也能展示，如 45 → 「提前 45 分钟」） */
export function warnOffsetLabel(minutes: number): string {
  const hit = WARN_OFFSET_PRESETS.find((p) => p.minutes === minutes)
  if (hit) return hit.label
  if (minutes % 1440 === 0) return `提前 ${minutes / 1440} 天`
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时`
  return `提前 ${minutes} 分钟`
}

/** 生效的提前提醒档位：warn_offsets 优先，为空退化用旧单档 warn_minutes */
export function effectiveWarnOffsets(t: Pick<Todo, 'warn_offsets' | 'warn_minutes'>): number[] {
  if (t.warn_offsets && t.warn_offsets.length > 0) return t.warn_offsets
  if (t.warn_minutes != null && t.warn_minutes >= 0) return [t.warn_minutes]
  return []
}

// ---- 重复规则 ----

export const REC_TYPES: { value: RecType; label: string; hint: string }[] = [
  { value: '', label: '不重复', hint: '' },
  { value: 'daily', label: '每天', hint: '完成后创建明天的一期' },
  { value: 'weekly', label: '每周', hint: '完成后创建下周同一时间的一期' },
  { value: 'monthly', label: '每月', hint: '完成后创建下月同一时间的一期' },
  { value: 'custom', label: '自定义间隔', hint: '完成后按天数间隔创建下一期' }
]

/** 重复规则的短文案（列表徽标用），如「每周」「每 3 天」 */
export function recBadge(t: Pick<Todo, 'rec_type' | 'rec_interval'>): string {
  switch (t.rec_type) {
    case 'daily':
      return '每天'
    case 'weekly':
      return '每周'
    case 'monthly':
      return '每月'
    case 'custom':
      return `每 ${t.rec_interval || 1} 天`
    default:
      return ''
  }
}

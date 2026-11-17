// 待办模块 API：待办 / 分类 / 标签 / 评论。
import { request } from './http'

export type TodoStatus = 'open' | 'done' | 'closed'

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
  /** 距截止时间多少分钟标记为「即将超时」；null 不提示 */
  warn_minutes: number | null
  sort: number
  completed_at: string | null
  created_at: string
  updated_at: string
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

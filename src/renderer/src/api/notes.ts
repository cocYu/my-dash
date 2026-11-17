// 笔记模块 API：文件夹树 / Markdown 笔记 / 版本。
import { request } from './http'

export interface Folder {
  id: number
  name: string
  parent_id: number | null
  sort: number
  created_at: string
  updated_at: string
}

export interface NoteMeta {
  id: number
  folder_id: number | null
  title: string
  sort: number
  created_at: string
  updated_at: string
}

export interface NoteFull extends NoteMeta {
  content: string
}

export interface VersionMeta {
  id: number
  note_id: number
  label: string
  auto: boolean
  size: number
  created_at: string
}

// ---- 文件夹 ----
export function listFolders(): Promise<Folder[]> {
  return request<Folder[]>({ url: '/api/folders', method: 'GET' })
}
export function createFolder(name: string, parent_id: number | null): Promise<Folder> {
  return request<Folder>({ url: '/api/folders', method: 'POST', data: { name, parent_id } })
}
export function renameFolder(id: number, name: string): Promise<Folder> {
  return request<Folder>({ url: `/api/folders/${id}`, method: 'PUT', data: { name } })
}
export function deleteFolder(id: number): Promise<void> {
  return request<void>({ url: `/api/folders/${id}`, method: 'DELETE' })
}

// ---- 笔记 ----
export function listNotes(): Promise<NoteMeta[]> {
  return request<NoteMeta[]>({ url: '/api/notes', method: 'GET' })
}
export function getNote(id: number): Promise<NoteFull> {
  return request<NoteFull>({ url: `/api/notes/${id}`, method: 'GET' })
}
export function createNote(title: string, folder_id: number | null, content = ''): Promise<NoteFull> {
  return request<NoteFull>({ url: '/api/notes', method: 'POST', data: { title, folder_id, content } })
}
export function updateNote(
  id: number,
  data: Partial<Pick<NoteFull, 'title' | 'content' | 'folder_id'>>
): Promise<NoteFull> {
  return request<NoteFull>({ url: `/api/notes/${id}`, method: 'PUT', data })
}
export function deleteNote(id: number): Promise<void> {
  return request<void>({ url: `/api/notes/${id}`, method: 'DELETE' })
}
export function reorder(payload: {
  type: 'note' | 'folder'
  parent_id: number | null
  ids: number[]
}): Promise<void> {
  return request<void>({ url: '/api/notes/reorder', method: 'POST', data: payload })
}

// ---- 通用辅助 ----
/** 在 taken 集合之外取唯一名：冲突时追加 " 2"、" 3"…（导入/示例/新建默认值用） */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const name = `${base} ${i}`
    if (!taken.has(name)) return name
  }
  return `${base} (${Date.now()})`
}

// ---- 版本 ----
export function listVersions(noteId: number): Promise<VersionMeta[]> {
  return request<VersionMeta[]>({ url: `/api/notes/${noteId}/versions`, method: 'GET' })
}
export function getVersionContent(noteId: number, vid: number): Promise<string> {
  return request<{ content: string }>({ url: `/api/notes/${noteId}/versions/${vid}`, method: 'GET' }).then(
    (r) => r.content
  )
}
export function createVersion(noteId: number, label = ''): Promise<{ id: number; label: string }> {
  return request<{ id: number; label: string }>({
    url: `/api/notes/${noteId}/versions`,
    method: 'POST',
    data: { label }
  })
}
export function restoreVersion(noteId: number, vid: number): Promise<void> {
  return request<void>({ url: `/api/notes/${noteId}/versions/${vid}/restore`, method: 'POST' })
}

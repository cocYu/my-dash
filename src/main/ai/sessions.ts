// Agent 会话存储：userData/ai/sessions/。
//   index.json    所有会话元数据（列表页只读它，快）
//   <id>.json     单会话消息正文（按需读取）
// 会话不参与云同步（体积大、设备相关性高），Agent 配置另行同步。
import fs from 'node:fs'
import path from 'node:path'
import { aiDir } from './config'
import type { AiSessionMessage, AiSessionMeta, AiSessionPatch } from '../../types/agent'

const MAX_MESSAGES = 500
const MAX_SESSIONS_PER_AGENT = 50

function sessionsDir(): string {
  return path.join(aiDir(), 'sessions')
}

function indexFile(): string {
  return path.join(sessionsDir(), 'index.json')
}

/** 会话 ID 会拼进文件名，必须严格校验防路径穿越 */
function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,64}$/.test(id)
}

function messageFile(id: string): string {
  return path.join(sessionsDir(), `${id}.json`)
}

function readIndex(): AiSessionMeta[] {
  try {
    const list = JSON.parse(fs.readFileSync(indexFile(), 'utf-8'))
    if (!Array.isArray(list)) return []
    return list.filter((x): x is AiSessionMeta => Boolean(x && typeof x.id === 'string'))
  } catch {
    return []
  }
}

function writeIndex(list: AiSessionMeta[]): void {
  fs.mkdirSync(sessionsDir(), { recursive: true })
  const tmp = `${indexFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, indexFile())
}

/** 会话列表：按更新时间倒序，可按 Agent 过滤 */
export function listSessions(agentId?: string): AiSessionMeta[] {
  return readIndex()
    .filter((s) => (agentId ? s.agentId === agentId : true))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function createSession(agentId: string, title = '新对话'): AiSessionMeta {
  const now = new Date().toISOString()
  const meta: AiSessionMeta = {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0
  }
  const list = readIndex()
  list.unshift(meta)
  // 同一 Agent 的会话上限，超出时清理最老的（连同消息文件）
  const same = list.filter((s) => s.agentId === agentId)
  if (same.length > MAX_SESSIONS_PER_AGENT) {
    const stale = same.slice(MAX_SESSIONS_PER_AGENT)
    for (const s of stale) {
      fs.rmSync(messageFile(s.id), { force: true })
    }
    const staleIds = new Set(stale.map((s) => s.id))
    writeIndex(list.filter((s) => !staleIds.has(s.id)))
  } else {
    writeIndex(list)
  }
  return meta
}

export function deleteSession(id: string): void {
  if (!isValidId(id)) return
  writeIndex(readIndex().filter((s) => s.id !== id))
  fs.rmSync(messageFile(id), { force: true })
}

export function renameSession(id: string, title: string): AiSessionMeta[] {
  const list = readIndex()
  const target = list.find((s) => s.id === id)
  if (target) {
    target.title = title.trim() || target.title
    target.updatedAt = new Date().toISOString()
    writeIndex(list)
  }
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function readSession(id: string): AiSessionMeta | undefined {
  return readIndex().find((s) => s.id === id)
}

/** 局部更新会话元数据（模型 / 思考强度覆盖、滚动摘要） */
export function updateSession(id: string, patch: AiSessionPatch): AiSessionMeta | undefined {
  const list = readIndex()
  const session = list.find((s) => s.id === id)
  if (!session) return undefined
  if (patch.title !== undefined) session.title = patch.title.trim() || session.title
  if (patch.providerId !== undefined) session.providerId = patch.providerId
  if (patch.model !== undefined) session.model = patch.model
  if (patch.reasoningEffort !== undefined) session.reasoningEffort = patch.reasoningEffort
  if (patch.summary !== undefined) session.summary = patch.summary
  if (patch.summarizedCount !== undefined) session.summarizedCount = patch.summarizedCount
  if (patch.summaryAt !== undefined) session.summaryAt = patch.summaryAt
  writeIndex(list)
  return session
}

export function readMessages(sessionId: string): AiSessionMessage[] {
  if (!isValidId(sessionId)) return []
  try {
    const list = JSON.parse(fs.readFileSync(messageFile(sessionId), 'utf-8'))
    return Array.isArray(list) ? (list as AiSessionMessage[]) : []
  } catch {
    return []
  }
}

/** 追加一条消息并同步索引（messageCount / updatedAt / 首条用户消息自动作标题） */
export function appendMessage(sessionId: string, msg: AiSessionMessage): void {
  if (!isValidId(sessionId)) return
  fs.mkdirSync(sessionsDir(), { recursive: true })
  const messages = readMessages(sessionId)
  messages.push(msg)
  const trimmed = messages.slice(-MAX_MESSAGES)
  const tmp = `${messageFile(sessionId)}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2))
  fs.renameSync(tmp, messageFile(sessionId))

  const list = readIndex()
  const session = list.find((s) => s.id === sessionId)
  if (session) {
    session.messageCount = trimmed.length
    session.updatedAt = msg.createdAt
    // 首条用户消息截断作为会话标题，便于识别
    if (msg.role === 'user' && session.title === '新对话') {
      session.title = msg.content.trim().slice(0, 24) || session.title
    }
    writeIndex(list)
  }
}

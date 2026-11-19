/** Agent 写操作审计日志：记录谁在什么时候用什么工具做了什么，出问题能追溯。
 *
 * 只记写/破坏性/付费类工具，只读工具不记（量大且无风险）。
 * 存 userData/ai/agent-audit.json，滚动保留最近 1000 条。
 */
import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface AuditEntry {
  at: string
  agentId: string
  agentName: string
  tool: string
  label: string
  level: string
  args: Record<string, unknown>
  /** 执行是否成功（被用户拒绝时也记 false） */
  ok: boolean
  /** null = 无需确认；true = 用户允许；false = 用户拒绝 */
  approved: boolean | null
  /** 结果摘要 */
  result: string
}

const MAX_ENTRIES = 1000

function auditFile(): string {
  const dir = path.join(app.getPath('userData'), 'ai')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'agent-audit.json')
}

export function readAudit(): AuditEntry[] {
  try {
    const list = JSON.parse(fs.readFileSync(auditFile(), 'utf-8'))
    return Array.isArray(list) ? (list as AuditEntry[]) : []
  } catch {
    return []
  }
}

export function appendAudit(entry: AuditEntry): void {
  try {
    const list = readAudit()
    list.push(entry)
    const trimmed = list.slice(-MAX_ENTRIES)
    fs.writeFileSync(auditFile(), JSON.stringify(trimmed, null, 2), 'utf-8')
  } catch (err) {
    // 审计失败不能影响主流程
    console.error('[ai] 写审计日志失败:', err)
  }
}

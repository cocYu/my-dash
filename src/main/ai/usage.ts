// AI 用量统计：userData/ai/usage.json。
// 每次 chat / 生图调用后追加一条记录，供按日期/日期范围聚合统计。
// 只存元数据，无敏感信息；随云备份 zip 一起上云。
import fs from 'node:fs'
import path from 'node:path'
import { aiDir } from './config'
import type { AiUsageDay, AiUsageQuery, AiUsageRecord, AiUsageSummary } from '../../types/ai'

const MAX_RECORDS = 5000

function usageFile(): string {
  return path.join(aiDir(), 'usage.json')
}

export function readUsage(): AiUsageRecord[] {
  try {
    const list = JSON.parse(fs.readFileSync(usageFile(), 'utf-8'))
    if (!Array.isArray(list)) return []
    return list.filter((x): x is AiUsageRecord => Boolean(x && typeof x.at === 'string' && typeof x.providerId === 'string'))
  } catch {
    return []
  }
}

function writeUsage(list: AiUsageRecord[]): void {
  fs.mkdirSync(aiDir(), { recursive: true })
  const tmp = `${usageFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, MAX_RECORDS), null, 2))
  fs.renameSync(tmp, usageFile())
}

/** 追加一条调用记录；写入失败不影响调用主流程 */
export function appendUsage(rec: AiUsageRecord): void {
  writeUsage([rec, ...readUsage()])
}

/** 云端还原整份用量记录 */
export function writeUsageFromBackup(list: AiUsageRecord[]): void {
  if (Array.isArray(list)) writeUsage(list)
}

/** 本地日期 YYYY-MM-DD（不用 toISOString，避免时区偏移） */
function localDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 按日期/日期范围查询并聚合 */
export function queryUsage(query: AiUsageQuery = {}): AiUsageSummary {
  const { date, from, to } = query
  const filtered = readUsage().filter((r) => {
    const day = localDate(r.at)
    if (date) return day === date
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })

  const dayMap = new Map<string, AiUsageDay>()
  for (const r of filtered) {
    const day = localDate(r.at)
    if (!day) continue
    let bucket = dayMap.get(day)
    if (!bucket) {
      bucket = {
        date: day,
        chatCalls: 0,
        imageCalls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        byProvider: []
      }
      dayMap.set(day, bucket)
    }
    bucket[r.kind === 'image' ? 'imageCalls' : 'chatCalls'] += 1
    bucket.promptTokens += r.promptTokens || 0
    bucket.completionTokens += r.completionTokens || 0
    bucket.totalTokens += r.totalTokens || 0

    const p = bucket.byProvider.find((x) => x.providerId === r.providerId)
    const target = p ?? {
      providerId: r.providerId,
      providerName: r.providerName,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
    if (!p) bucket.byProvider.push(target)
    target.calls += 1
    target.promptTokens += r.promptTokens || 0
    target.completionTokens += r.completionTokens || 0
    target.totalTokens += r.totalTokens || 0
  }

  const days = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date))
  return {
    records: filtered,
    days,
    total: days.reduce(
      (acc, d) => ({
        chatCalls: acc.chatCalls + d.chatCalls,
        imageCalls: acc.imageCalls + d.imageCalls,
        promptTokens: acc.promptTokens + d.promptTokens,
        completionTokens: acc.completionTokens + d.completionTokens,
        totalTokens: acc.totalTokens + d.totalTokens
      }),
      { chatCalls: 0, imageCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    )
  }
}

/** 某供应商最近一次调用时间；不存在返回 null */
export function lastCallAt(providerId: string): string | null {
  const rec = readUsage().find((r) => r.providerId === providerId)
  return rec?.at ?? null
}

// 供应商额度探测：
// 1) OpenAI Billing 风格 GET /v1/dashboard/billing/subscription + usage（主流中转站也兼容）
// 2) new-api 风格 GET /api/status 的 quota_per_unit / quota_display_type（仅作为货币线索）
// 探测全部失败时抛错，UI 明确提示供应商不提供额度接口。
import type { AiQuotaInfo, AiProvider } from '../../types/ai'

const TIMEOUT = 15_000

function apiBase(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (!b) throw new Error('接口地址未配置')
  if (/\/v\d+$/.test(b)) return b
  return `${b}/v1`
}

function authHeaders(provider: AiProvider): Record<string, string> {
  const key = provider.apiKey
  if (!key) throw new Error(`供应商「${provider.name}」尚未配置 API Key`)
  if (provider.protocol === 'messages') {
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  }
  return { authorization: `Bearer ${key}` }
}

async function tryJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return null
    const body = await res.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** 探测额度；失败时抛出可读错误 */
export async function fetchQuota(provider: AiProvider): Promise<AiQuotaInfo> {
  const headers = authHeaders(provider)
  const root = provider.baseUrl.trim().replace(/\/+$/, '').replace(/\/v\d+$/, '')
  const base = apiBase(provider.baseUrl)
  const checkedAt = new Date().toISOString()

  // 路径 A：OpenAI Billing 风格（subscription + usage），兼容性最广
  const sub = await tryJson(`${base}/dashboard/billing/subscription`, headers)
  if (sub) {
    // OpenAI 官方字段为 hard_limit_usd / soft_limit_usd；部分中转站用 total_amount / quota
    const limit =
      num(sub.hard_limit_usd) ??
      num(sub.soft_limit_usd) ??
      num(sub.total_amount) ??
      num(sub.total_quota) ??
      num(sub.quota)
    const currency = num(sub.hard_limit_usd) !== null || num(sub.soft_limit_usd) !== null ? 'USD' : 'CNY'

    // usage 返回 total_usage，OpenAI 官方单位为美分；new-api 兼容实现多沿用此约定
    const usage = await tryJson(`${base}/dashboard/billing/usage`, headers)
    const rawUsed = usage ? num(usage.total_usage) ?? num(usage.used_quota) ?? num(usage.total_quota) : null
    const used = rawUsed === null ? null : currency === 'USD' ? rawUsed / 100 : rawUsed

    const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null
    return {
      limit,
      used,
      remaining,
      currency,
      source: 'OpenAI Billing',
      checkedAt
    }
  }

  // 路径 B：new-api /api/status —— 能拿到货币单位与换算比例，但用户余额需 session，API Key 取不到
  const status = await tryJson(`${root}/api/status`, headers)
  if (status) {
    const data = (status.data && typeof status.data === 'object' ? status.data : status) as Record<string, unknown>
    const display = typeof data.quota_display_type === 'string' ? data.quota_display_type : ''
    const perUnit = num(data.quota_per_unit)
    if (display || perUnit !== null) {
      return {
        limit: null,
        used: null,
        remaining: null,
        currency: display === 'CNY' ? 'CNY' : display === 'USD' ? 'USD' : display || '未知',
        source: 'new-api 状态接口（仅货币信息，未提供用户额度）',
        checkedAt
      }
    }
  }

  throw new Error('该供应商未暴露额度查询接口，无法获取额度信息')
}

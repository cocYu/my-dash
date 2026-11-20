// 待办超时通知调度器：主进程常驻，每分钟检查一次 + 启动后立即补跑（覆盖关机期间错过的节点）。
// 已通知标记按「渠道 × 待办 × 节点 × 截止指纹」存 notify/state.json：
// - 指纹含 dueMs+warnMinutes → 待办改期后自动重新武装
// - 按渠道记录 → 单渠道失败只影响自己，下轮重试，不影响其他渠道
import type { NotifyChannelId } from '../../types/notify'
import { readNotifyConfig, type NotifyConfig } from './config'
import { buildNotifyMessage, sendToChannel, type NotifyEvent, type NotifyTodo } from './channels'
import fs from 'node:fs'
import path from 'node:path'
import { notifyDir } from './config'

export interface NotifyContext {
  baseUrl: string
  token: string
}

interface NotifyState {
  sent: Record<string, number>
}

let timer: NodeJS.Timeout | null = null
let running = false

function stateFile(): string {
  return path.join(notifyDir(), 'state.json')
}

function readState(): NotifyState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as NotifyState
  } catch {
    return { sent: {} }
  }
}

function writeState(state: NotifyState): void {
  fs.mkdirSync(notifyDir(), { recursive: true })
  const tmp = `${stateFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, stateFile())
}

/** 每个渠道实际可发送的最小校验（system 无需配置） */
function channelReady(id: NotifyChannelId, cfg: NotifyConfig): boolean {
  if (!cfg.enabled) return false
  switch (id) {
    case 'system':
      return cfg.system.enabled
    case 'wecom':
      return cfg.wecom.enabled && !!cfg.wecom.webhook
    case 'feishu':
      return cfg.feishu.enabled && !!cfg.feishu.webhook
    case 'dingtalk':
      return cfg.dingtalk.enabled && !!cfg.dingtalk.webhook
    case 'email':
      return cfg.email.enabled && !!cfg.email.host && !!cfg.email.username && !!cfg.email.to
  }
}

const ALL_CHANNELS: NotifyChannelId[] = ['system', 'wecom', 'feishu', 'dingtalk', 'email']

/** 计算当前处于提醒窗口且未满足跳过条件的事件（不含去重） */
function collectEvents(todos: NotifyTodo[], cfg: NotifyConfig, now: number): NotifyEvent[] {
  const events: NotifyEvent[] = []
  for (const t of todos) {
    if (t.status !== 'open') continue
    // 开始提醒：start_at 到点触发一次（指纹含开始时间，改期自动重新武装）
    if (cfg.notifyOnStart && t.start_at) {
      const startMs = Date.parse(t.start_at)
      if (!Number.isNaN(startMs) && now >= startMs) {
        events.push({ todo: t, node: 'start', key: `${t.id}:${startMs}:start`, anchorMs: startMs })
      }
    }
    if (!t.due_at) continue
    const dueMs = Date.parse(t.due_at)
    if (Number.isNaN(dueMs)) continue
    // 多档提前提醒：warn_offsets 优先，为空退化用 warn_minutes 单档（负值/null 不提醒）
    const offsets =
      t.warn_offsets && t.warn_offsets.length > 0
        ? t.warn_offsets
        : t.warn_minutes != null && t.warn_minutes >= 0
          ? [t.warn_minutes]
          : []
    for (const offset of offsets) {
      if (offset <= 0) continue
      // 指纹含截止+提前量：改期/改提醒 → 键变化 → 自动重新提醒
      if (cfg.notifyOnSoon && now >= dueMs - offset * 60_000 && now < dueMs) {
        events.push({ todo: t, node: 'warn', key: `${t.id}:${dueMs}:${offset}:warn`, anchorMs: dueMs })
      }
    }
    if (cfg.notifyOnOverdue && now >= dueMs) {
      events.push({ todo: t, node: 'due', key: `${t.id}:${dueMs}:due`, anchorMs: dueMs })
    }
  }
  return events
}

/** 一轮完整检查；返回成功推送的渠道数（供 IPC 手动触发与 e2e 断言） */
export async function runNotifyCheck(ctx: NotifyContext): Promise<{ channels: number; events: number }> {
  const cfg = readNotifyConfig()
  if (!cfg.enabled) return { channels: 0, events: 0 }
  const ids = ALL_CHANNELS.filter((id) => channelReady(id, cfg))
  if (ids.length === 0) return { channels: 0, events: 0 }

  const res = await fetch(`${ctx.baseUrl}/api/todos`, { headers: { 'X-API-Token': ctx.token } })
  if (!res.ok) throw new Error(`拉取待办失败：HTTP ${res.status}`)
  const body = (await res.json()) as { code: number; data?: NotifyTodo[] }
  if (body.code !== 0 || !Array.isArray(body.data)) throw new Error('拉取待办失败：响应格式异常')
  const todos = body.data

  const now = Date.now()
  const state = readState()

  // 清理已删除待办的残留标记（键格式：channel:todoId:anchorMs:offset:node）
  const alive = new Set(todos.map((t) => String(t.id)))
  for (const key of Object.keys(state.sent)) {
    if (!alive.has(key.split(':')[1])) delete state.sent[key]
  }

  const events = collectEvents(todos, cfg, now)
  if (events.length === 0) {
    writeState(state)
    return { channels: 0, events: 0 }
  }

  const msg = buildNotifyMessage(events, now)
  let okChannels = 0
  let stateChanged = false
  // 外部渠道推送阈值：仅优先级 ≤ 阈值（P0 最高）的待办推送到企微/飞书/钉钉/邮箱；系统通知不受限
  const threshold = cfg.externalMinPriority
  for (const id of ids) {
    const pending = events.filter(
      (e) => state.sent[`${id}:${e.key}`] == null && !(threshold != null && id !== 'system' && e.todo.priority > threshold)
    )
    if (pending.length === 0) continue
    try {
      await sendToChannel(id, cfg, msg)
      const at = Date.now()
      for (const e of pending) state.sent[`${id}:${e.key}`] = at
      stateChanged = true
      okChannels++
    } catch (err) {
      // 单渠道失败不阻断其他渠道；该渠道未标记，下轮自动重试
      console.error(`[notify] ${id} 渠道发送失败:`, err instanceof Error ? err.message : err)
    }
  }
  if (stateChanged) writeState(state)
  return { channels: okChannels, events: events.length }
}

export function startNotifyScheduler(ctx: NotifyContext): void {
  if (timer) clearInterval(timer)
  const tick = (): void => {
    if (running) return
    running = true
    runNotifyCheck(ctx)
      .then(({ channels }) => {
        if (channels > 0) console.log(`[notify] 已向 ${channels} 个渠道推送提醒`)
      })
      .catch((err) => console.error('[notify] 检查失败:', err instanceof Error ? err.message : err))
      .finally(() => {
        running = false
      })
  }
  setTimeout(tick, 10_000) // 启动后先跑一轮（补发关机期间错过的提醒）
  // MYDASH_NOTIFY_NO_TIMER=1：e2e 用，禁用周期 tick，仅手动 run-check 触发，保证断言确定性
  if (process.env['MYDASH_NOTIFY_NO_TIMER'] !== '1') {
    timer = setInterval(tick, 60_000)
  }
}

export function stopNotifyScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

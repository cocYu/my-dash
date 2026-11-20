// 通知渠道发送：系统通知 / 企业微信 / 飞书 / 钉钉 / 邮箱(SMTP)。
// 每个渠道一个 sender，失败抛错（message 面向用户，供「发送测试」直接展示）。
// MYDASH_NOTIFY_OUTBOX=1 时进入 outbox 模式：不真实发送，追加写 notify/outbox.jsonl 供 e2e 断言。
import { Notification } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import nodemailer from 'nodemailer'
import type {
  DingtalkChannel,
  EmailChannel,
  FeishuChannel,
  NotifyChannelId,
  NotifyConfig,
  WecomChannel
} from '../../types/notify'
import { notifyDir } from './config'

/** 调度器筛出的待提醒待办（与 REST GET /api/todos 的字段对齐） */
export interface NotifyTodo {
  id: number
  title: string
  subtitle: string | null
  priority: number
  status: 'open' | 'done' | 'closed'
  start_at: string | null
  due_at: string | null
  /** 全天事件：due_at 为当天零点，提醒按整天处理 */
  all_day: boolean
  /** 多档提前提醒（分钟）；空数组时退化用 warn_minutes */
  warn_offsets: number[] | null
  warn_minutes: number | null
}

/** 一个待触发节点（start=已开始 / warn=即将超时 / due=已超时）；key 用于按渠道去重 */
export interface NotifyEvent {
  todo: NotifyTodo
  node: 'start' | 'warn' | 'due'
  key: string
  /** 节点锚点时间：start 取开始时间，warn/due 取截止时间 */
  anchorMs: number
}

/** 一条聚合通知：md 用于企微/钉钉，plain 用于飞书/系统弹窗，html 用于邮件 */
export interface NotifyMessage {
  title: string
  md: string
  plain: string
  html: string
}

export function isOutboxMode(): boolean {
  return process.env['MYDASH_NOTIFY_OUTBOX'] === '1'
}

function writeOutbox(channel: NotifyChannelId, to: string, msg: NotifyMessage): void {
  fs.mkdirSync(notifyDir(), { recursive: true })
  const line = JSON.stringify({ channel, to, title: msg.title, text: msg.plain, at: new Date().toISOString() })
  fs.appendFileSync(path.join(notifyDir(), 'outbox.jsonl'), line + '\n')
}

async function postJson(url: string, body: unknown, timeoutMs = 15_000): Promise<{ status: number; json: Record<string, unknown> }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(`HTTP ${res.status}：${text.slice(0, 120)}`)
    }
    return { status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

// ---- 企业微信群机器人 ----
// 文档：https://developer.work.weixin.qq.com/document/path/91770
async function sendWecom(ch: WecomChannel, msg: NotifyMessage): Promise<void> {
  if (!ch.webhook) throw new Error('未配置 webhook 地址')
  const { status, json } = await postJson(ch.webhook, { msgtype: 'markdown', markdown: { content: msg.md } })
  if (status !== 200 || json['errcode'] !== 0) {
    throw new Error(`企业微信返回 errcode=${String(json['errcode'])} ${String(json['errmsg'] ?? '')}`)
  }
}

// ---- 飞书自定义机器人 ----
// 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
// 加签：stringToSign = `${秒级时间戳}\n${secret}`，以其为 HMAC-SHA256 key 对空串签名后 base64
function feishuSign(secret: string, timestampSec: number): string {
  return crypto.createHmac('sha256', `${timestampSec}\n${secret}`).update('').digest('base64')
}

async function sendFeishu(ch: FeishuChannel, msg: NotifyMessage): Promise<void> {
  if (!ch.webhook) throw new Error('未配置 webhook 地址')
  const body: Record<string, unknown> = { msg_type: 'text', content: { text: msg.plain } }
  if (ch.secret) {
    const timestamp = Math.floor(Date.now() / 1000)
    body['timestamp'] = timestamp
    body['sign'] = feishuSign(ch.secret, timestamp)
  }
  const { status, json } = await postJson(ch.webhook, body)
  const code = json['code'] ?? json['StatusCode']
  if (status !== 200 || (code !== 0 && code !== '0')) {
    const reason = String(json['msg'] ?? json['StatusMessage'] ?? '')
    throw new Error(`飞书返回 code=${String(code)} ${reason}`)
  }
}

// ---- 钉钉自定义机器人 ----
// 文档：https://open.dingtalk.com/document/robots/custom-robot-access
// 加签：sign = urlencode(base64(HMAC-SHA256(secret, `${毫秒时间戳}\n${secret}`)))，拼进 URL
async function sendDingtalk(ch: DingtalkChannel, msg: NotifyMessage): Promise<void> {
  if (!ch.webhook) throw new Error('未配置 webhook 地址')
  let url = ch.webhook
  if (ch.secret) {
    const timestamp = Date.now()
    const sign = crypto.createHmac('sha256', ch.secret).update(`${timestamp}\n${ch.secret}`).digest('base64')
    url += `${url.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
  }
  const { status, json } = await postJson(url, { msgtype: 'markdown', markdown: { title: msg.title, text: msg.md } })
  if (status !== 200 || json['errcode'] !== 0) {
    throw new Error(`钉钉返回 errcode=${String(json['errcode'])} ${String(json['errmsg'] ?? '')}`)
  }
}

// ---- 邮箱 SMTP ----
async function sendEmail(ch: EmailChannel, msg: NotifyMessage): Promise<void> {
  if (!ch.host || !ch.username || !ch.password) throw new Error('SMTP 主机/账号/授权码未配置完整')
  const to = ch.to.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean)
  if (to.length === 0) throw new Error('未填写收件人')
  const transport = nodemailer.createTransport({
    host: ch.host,
    port: ch.port,
    secure: ch.secure,
    auth: { user: ch.username, pass: ch.password }
  })
  try {
    await transport.sendMail({
      from: ch.from || ch.username,
      to: to.join(', '),
      subject: msg.title,
      text: msg.plain,
      html: msg.html
    })
  } catch (err) {
    throw new Error(`SMTP 发送失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    transport.close()
  }
}

// ---- 系统通知 ----
function sendSystem(msg: NotifyMessage): void {
  if (!Notification.isSupported()) throw new Error('当前系统不支持桌面通知')
  const n = new Notification({ title: msg.title, body: msg.plain, silent: false })
  n.show()
}

/** 向单个渠道发送；outbox 模式下只落盘不真发。to 仅用于 outbox 记录 */
export async function sendToChannel(
  id: NotifyChannelId,
  cfg: NotifyConfig,
  msg: NotifyMessage
): Promise<void> {
  if (isOutboxMode()) {
    writeOutbox(id, id === 'email' ? cfg.email.to : '', msg)
    return
  }
  switch (id) {
    case 'system':
      return sendSystem(msg)
    case 'wecom':
      return sendWecom(cfg.wecom, msg)
    case 'feishu':
      return sendFeishu(cfg.feishu, msg)
    case 'dingtalk':
      return sendDingtalk(cfg.dingtalk, msg)
    case 'email':
      return sendEmail(cfg.email, msg)
  }
}

// ---- 消息构建 ----
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatDueTime(dueMs: number): string {
  const d = new Date(dueMs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function spanText(diffMs: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000))
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
  return `${Math.round(minutes / 1440)} 天`
}

/** 优先级展示（与渲染层 PRIORITIES 对齐） */
function priorityLabel(p: number): string {
  return `P${p}`
}

const DAY_MS = 86_400_000

export function buildNotifyMessage(events: NotifyEvent[], now: number): NotifyMessage {
  const title = `AtoZ 待办提醒（${events.length} 条）`
  const lines: string[] = []
  const plainLines: string[] = []
  const htmlParts: string[] = []
  const pushGroup = (label: string, node: NotifyEvent['node']): void => {
    const group = events.filter((e) => e.node === node)
    if (group.length === 0) return
    lines.push(`**${label}**`)
    plainLines.push(label)
    htmlParts.push(`<h3>${label}</h3><ul>`)
    for (const { todo, anchorMs } of group) {
      let anchorText: string
      if (node === 'start') {
        anchorText = `开始 ${formatDueTime(anchorMs)}`
      } else if (todo.all_day && todo.due_at) {
        // 全天事件：截止日未跨过 → 今天截止；跨过 → 按整天算超时天数
        const dueMs = Date.parse(todo.due_at)
        if (now < dueMs + DAY_MS) anchorText = `今天截止（全天）`
        else anchorText = `截止 ${formatDueTime(dueMs)}，已超时 ${Math.max(1, Math.round((now - dueMs) / DAY_MS))} 天`
      } else if (node === 'warn') {
        anchorText = `截止 ${formatDueTime(anchorMs)}，剩 ${spanText(anchorMs - now)}`
      } else {
        anchorText = `截止 ${formatDueTime(anchorMs)}，已超时 ${spanText(now - anchorMs)}`
      }
      const sub = todo.subtitle ? `（${todo.subtitle}）` : ''
      lines.push(`- ${todo.title}${sub}（${priorityLabel(todo.priority)}）— ${anchorText}`)
      plainLines.push(`· ${todo.title}${sub}（${priorityLabel(todo.priority)}）— ${anchorText}`)
      htmlParts.push(`<li>${todo.title}${sub}（${priorityLabel(todo.priority)}）— ${anchorText}</li>`)
    }
    htmlParts.push('</ul>')
  }
  pushGroup('🟢 已开始', 'start')
  pushGroup('🟡 即将超时', 'warn')
  pushGroup('🔴 已超时', 'due')
  return {
    title,
    md: `### ${title}\n${lines.join('\n')}`,
    plain: `${title}\n${plainLines.join('\n')}`,
    html: `<div style="font-family:sans-serif"><h2>${title}</h2>${htmlParts.join('')}<p style="color:#888">由 AtoZ 桌面端发送</p></div>`
  }
}

/** 「发送测试」用的一句话消息 */
export function buildTestMessage(id: NotifyChannelId): NotifyMessage {
  const text = `AtoZ 通知测试成功（${id} 渠道，${new Date().toLocaleString()}）`
  return { title: 'AtoZ 通知测试', md: text, plain: text, html: `<p>${text}</p>` }
}

/** outbox 文件路径（e2e 读取用；顺便暴露给设置页「打开目录」） */
export function outboxFile(): string {
  return path.join(notifyDir(), 'outbox.jsonl')
}

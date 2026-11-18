/** 待办超时通知全链路验证（outbox 模式）：调度→聚合→去重→改期重武装→状态过滤 + 配置加密落盘/读回 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:5173'))
if (!page) throw new Error('未找到渲染窗口')
await page.setViewportSize({ width: 1400, height: 840 })

const cfg = await page.evaluate(() => window.api.getBackendConfig())
const H = { 'Content-Type': 'application/json', 'X-API-Token': cfg.token }
const outboxFile = path.join(cfg.userDataPath, 'notify', 'outbox.jsonl')

function outboxLines() {
  try {
    return fs.readFileSync(outboxFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
const iso = (ms) => new Date(Date.now() + ms).toISOString()

// 清场 + 造三条样例：即将超时（warn 窗口内）/ 已超时 / 未进窗口
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  for (const t of (await r.json()).data ?? []) {
    if (t.title.startsWith('通知e2e')) await fetch(`${cfg.baseUrl}/api/todos/${t.id}`, { method: 'DELETE', headers: H })
  }
  await fetch(`${cfg.baseUrl}/api/todos`, { method: 'POST', headers: H, body: JSON.stringify({ title: '通知e2e-即将', priority: 1, due_at: iso(30 * 60e3), warn_minutes: 60 }) })
  await fetch(`${cfg.baseUrl}/api/todos`, { method: 'POST', headers: H, body: JSON.stringify({ title: '通知e2e-已超时', priority: 0, due_at: iso(-5 * 60e3), warn_minutes: 60 }) })
  await fetch(`${cfg.baseUrl}/api/todos`, { method: 'POST', headers: H, body: JSON.stringify({ title: '通知e2e-未到期', priority: 2, due_at: iso(10 * 3600e3), warn_minutes: 60 }) })
}

// 1. 手动触发一轮检查 → 聚合消息（2 条：即将 + 已超时；未到期不触发）
const before = outboxLines().length
const r1 = await page.evaluate(() => window.api.notify.runCheck())
const lines1 = outboxLines().slice(before)
console.log('[1] run-check 返回:', JSON.stringify(r1))
const notifyLine = lines1.find((l) => l.channel === 'system' && l.title.includes('待办提醒'))
console.log('[1] 聚合消息:', notifyLine ? notifyLine.text.replace(/\n/g, ' | ') : '(无)')
console.log('[1] 含即将/已超时/不含未到期:', notifyLine?.text.includes('通知e2e-即将'), notifyLine?.text.includes('通知e2e-已超时'), !notifyLine?.text.includes('通知e2e-未到期'))

// 2. 立即再跑一轮 → 去重（outbox 无新增）
const before2 = outboxLines().length
await page.evaluate(() => window.api.notify.runCheck())
console.log('[2] 第二轮无新增:', outboxLines().length === before2 ? 'OK' : 'FAIL')

// 3. 改期「通知e2e-即将」→ 新指纹 → 重新武装
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  const t = (await r.json()).data.find((x) => x.title === '通知e2e-即将')
  await fetch(`${cfg.baseUrl}/api/todos/${t.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ due_at: iso(45 * 60e3) }) })
}
const before3 = outboxLines().length
await page.evaluate(() => window.api.notify.runCheck())
const lines3 = outboxLines().slice(before3)
const line3 = lines3.find((l) => l.channel === 'system' && l.title.includes('待办提醒'))
console.log('[3] 改期后重新提醒:', line3 ? 'OK' : 'FAIL', '|', line3?.text.replace(/\n/g, ' | ').slice(0, 80))

// 4. 完成「通知e2e-已超时」→ 不再提醒
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  const t = (await r.json()).data.find((x) => x.title === '通知e2e-已超时')
  await fetch(`${cfg.baseUrl}/api/todos/${t.id}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'done' }) })
}
const before4 = outboxLines().length
await page.evaluate(() => window.api.notify.runCheck())
console.log('[4] 完成后无新提醒:', outboxLines().length === before4 ? 'OK' : 'FAIL')

// ---- 配置：UI 保存 → 磁盘加密 → 读回明文 ----
await page.evaluate(() => {
  location.hash = '#/settings'
})
await page.reload()
await page.waitForSelector('.settings-page', { timeout: 10000 })
await page.waitForTimeout(800)
await page.locator('.el-menu-item', { hasText: '通知提醒' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'output/playwright/notify-settings.png' })

const wecomBlock = page.locator('.panel .block', { hasText: '企业微信' })
const wecomInput = wecomBlock.getByPlaceholder(/群机器人 Webhook/)
await wecomInput.fill('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=e2e-test-key')
await page.getByRole('button', { name: '保存配置' }).click()
await page.waitForTimeout(800)
const diskRaw = fs.readFileSync(path.join(cfg.userDataPath, 'notify', 'config.json'), 'utf-8')
const disk = JSON.parse(diskRaw)
console.log('[5] webhook 加密落盘:', disk.wecom.webhook.startsWith('enc:') ? 'OK' : `FAIL(${disk.wecom.webhook.slice(0, 30)})`)
await page.reload()
await page.waitForSelector('.settings-page', { timeout: 10000 })
await page.waitForTimeout(800)
await page.locator('.el-menu-item', { hasText: '通知提醒' }).click()
await page.waitForTimeout(500)
const back = await wecomInput.inputValue()
console.log('[5] 读回明文一致:', back.includes('e2e-test-key') ? 'OK' : 'FAIL')

// 清理：清空 webhook + 测试待办
await wecomInput.fill('')
await page.getByRole('button', { name: '保存配置' }).click()
await page.waitForTimeout(600)
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  for (const t of (await r.json()).data ?? []) {
    if (t.title.startsWith('通知e2e')) await fetch(`${cfg.baseUrl}/api/todos/${t.id}`, { method: 'DELETE', headers: H })
  }
}
console.log('[完成] 通知模块 e2e 验证结束')
await browser.close()

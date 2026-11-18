/** 待办右键菜单验证：右键选中 + 标记完成 + 删除（含确认框） */
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:5173'))
if (!page) throw new Error('未找到渲染窗口')
await page.setViewportSize({ width: 1400, height: 840 })
await page.evaluate(() => {
  location.hash = '#/todos'
})
await page.reload()
await page.waitForSelector('.todos-page', { timeout: 10000 })
await page.waitForTimeout(900)

const cfg = await page.evaluate(() => window.api.getBackendConfig())
const H = { 'Content-Type': 'application/json', 'X-API-Token': cfg.token }

// 清场 + 造两条样例
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  for (const t of (await r.json()).data ?? []) {
    if (t.title === '右键删除样例' || t.title === '右键完成样例') {
      await fetch(`${cfg.baseUrl}/api/todos/${t.id}`, { method: 'DELETE', headers: H })
    }
  }
  await fetch(`${cfg.baseUrl}/api/todos`, { method: 'POST', headers: H, body: JSON.stringify({ title: '右键删除样例' }) })
  await fetch(`${cfg.baseUrl}/api/todos`, { method: 'POST', headers: H, body: JSON.stringify({ title: '右键完成样例' }) })
  await page.reload()
  await page.waitForSelector('.todos-page', { timeout: 10000 })
  await page.waitForTimeout(800)
}

// 1. 右键「右键完成样例」→ 菜单出现 + 行被选中
const rowDone = page.locator('.todo-row', { hasText: '右键完成样例' }).first()
await rowDone.click({ button: 'right' })
await page.waitForTimeout(300)
console.log('[1] 菜单可见:', await page.locator('.ctx-menu').isVisible())
console.log('[1] 菜单项:', (await page.locator('.ctx-item').allTextContents()).join(','))
console.log('[1] 行被选中:', await rowDone.evaluate((el) => el.classList.contains('selected')))
await page.screenshot({ path: 'output/playwright/todos-ctx-menu.png' })

// 2. 点「标记完成」→ 状态变 done
await page.locator('.ctx-item', { hasText: '标记完成' }).click()
await page.waitForTimeout(900)
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  const t = (await r.json()).data.find((x) => x.title === '右键完成样例')
  console.log('[2] 标记完成生效:', t?.status === 'done' ? 'OK' : `FAIL(${t?.status})`)
}

// 3. 右键「右键删除样例」→ 点「删除」→ 确认框 → 删除成功
const rowDel = page.locator('.todo-row', { hasText: '右键删除样例' }).first()
await rowDel.click({ button: 'right' })
await page.waitForTimeout(300)
await page.locator('.ctx-item', { hasText: '删除' }).click()
await page.waitForTimeout(500)
console.log('[3] 确认框出现:', await page.locator('.el-message-box').isVisible())
console.log('[3] 确认文案:', (await page.locator('.el-message-box__message').textContent())?.trim().slice(0, 40))
await page.locator('.el-message-box__btns .el-button--primary').click()
await page.waitForTimeout(1000)
const stillThere = await page.locator('.todo-row', { hasText: '右键删除样例' }).count()
const toast = await page.locator('.el-message').last().textContent().catch(() => '')
console.log('[3] 行已删除:', stillThere === 0 ? 'OK' : 'FAIL', '| toast:', toast?.trim())

// 4. 左键点击不弹菜单
await page.locator('.todo-row').first().click()
await page.waitForTimeout(300)
console.log('[4] 左键无菜单:', !(await page.locator('.ctx-menu').isVisible()) ? 'OK' : 'FAIL')

// 清理
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  for (const t of (await r.json()).data ?? []) {
    if (t.title === '右键完成样例' || t.title === '右键删除样例') {
      await fetch(`${cfg.baseUrl}/api/todos/${t.id}`, { method: 'DELETE', headers: H })
    }
  }
}
await page.screenshot({ path: 'output/playwright/todos-ctx-final.png' })
console.log('[完成] 右键菜单验证结束')
await browser.close()

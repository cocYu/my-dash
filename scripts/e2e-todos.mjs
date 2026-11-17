/** 待办模块 UI 全链路验证：分类/标签/优先级/子任务/富文本/评论/筛选/超时徽标/状态流转 */
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

async function lastMessage() {
  const el = page.locator('.el-message').last()
  try {
    await el.waitFor({ state: 'visible', timeout: 4000 })
    const text = (await el.textContent())?.trim()
    await page.waitForTimeout(2200)
    return text
  } catch {
    return '(无消息)'
  }
}

// REST 通道（构造超时样例用）
const cfg = await page.evaluate(() => window.api.getBackendConfig())
const H = { 'Content-Type': 'application/json', 'X-API-Token': cfg.token }
const iso = (ms) => new Date(Date.now() + ms).toISOString()

// 清场：删除上轮遗留的测试待办（含子任务级联）
{
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: H })
  const list = (await r.json()).data ?? []
  for (const t of list) {
    if (['完成季度报告', '逾期样例', '即将到期样例', '新待办'].includes(t.title)) {
      await fetch(`${cfg.baseUrl}/api/todos/${t.id}`, { method: 'DELETE', headers: H })
    }
  }
  await page.reload()
  await page.waitForSelector('.todos-page', { timeout: 10000 })
  await page.waitForTimeout(700)
}

// 1. 新建分类「工作」
await page.locator('.side-add').first().click()
await page.locator('.el-message-box__input input').fill('工作')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(700)
{
  const msg = await lastMessage()
  console.log('[1] 新建分类:', msg)
}
console.log('[1] 分类就绪')

// 2. 新建待办（落在当前分类），改标题/副标题
await page.getByRole('button', { name: '新建待办' }).first().click()
await page.waitForTimeout(900)
await page.locator('.title-input').fill('完成季度报告')
await page.locator('.subtitle-input').fill('市场部数据汇总')
await page.waitForTimeout(1200)
console.log('[2] 新建待办+标题副标题:', (await page.locator('.todo-row', { hasText: '完成季度报告' }).first().textContent())?.replace(/\s+/g, ' ').slice(0, 60))

// 3. 详情：优先级 P1、标签、超时提醒
await page.locator('.detail-panel .meta-grid .el-select').nth(1).click() // 优先级
await page.getByRole('option', { name: 'P1 极高' }).click()
await page.waitForTimeout(400)
const tagSelect = page.locator('.detail-panel .meta-grid .el-select').nth(3)
await tagSelect.click()
await tagSelect.locator('input').last().fill('报告')
await page.keyboard.press('Enter')
await tagSelect.locator('input').last().fill('季度')
await page.keyboard.press('Enter')
await page.keyboard.press('Escape')
await page.waitForTimeout(900)
const rowText = (await page.locator('.todo-row', { hasText: '完成季度报告' }).first().textContent())?.replace(/\s+/g, ' ')
console.log('[3] 行含 P1/标签:', rowText?.includes('P1'), rowText?.includes('报告'), rowText?.includes('季度'))

// 4. 截止时间：明晚 18 点 + 提前 1 天提醒（编辑日期输入框直接键入）
const dueInput = page.locator('.detail-panel .meta-grid .el-date-editor input').nth(1)
await dueInput.click()
await dueInput.fill('2026-11-18 18:00:00')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
const warnSelect = page.locator('.detail-panel .meta-grid .el-select').nth(2)
await warnSelect.click()
await page.getByRole('option', { name: '提前 1 天' }).click()
await page.waitForTimeout(900)
console.log('[4] 截止时间已保存:', (await dueInput.inputValue()).includes('2026-11-18'))

// 5. 子任务：两条，勾选完成一条 → 进度 1/2
const subAdd = page.locator('.sub-add')
await subAdd.fill('收集数据')
await subAdd.press('Enter')
await page.waitForTimeout(700)
await subAdd.fill('撰写结论')
await subAdd.press('Enter')
await page.waitForTimeout(700)
await page.locator('.sub-row').first().locator('.el-checkbox').click()
await page.waitForTimeout(800)
const progress = await page.locator('.sub-progress').textContent()
console.log('[5] 子任务进度:', progress?.trim(), progress?.includes('1/2') ? 'OK' : 'FAIL')

// 6. 富文本描述：输入 + 全选加粗
await page.locator('.detail-panel .rte-body').click()
await page.keyboard.type('重点覆盖增长数据')
await page.locator('.detail-panel .rte-body').evaluate((el) => {
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
})
await page.locator('.rte-toolbar button').first().click() // 加粗
await page.waitForTimeout(900)
const descSaved = await page.evaluate(async () => {
  const cfg = await window.api.getBackendConfig()
  const r = await fetch(`${cfg.baseUrl}/api/todos`, { headers: { 'X-API-Token': cfg.token } })
  const body = await r.json()
  return body.data.find((t) => t.title === '完成季度报告')?.description ?? ''
})
console.log('[6] 富文本描述入库含<b>:', /<b>|<strong>/.test(descSaved) && descSaved.includes('重点覆盖增长数据'))

// 7. 评论
await page.locator('.comment-input textarea').fill('记得同步给老板')
await page.getByRole('button', { name: '发送' }).click()
await page.waitForTimeout(700)
const commentText = await page.locator('.comment-row').first().textContent()
console.log('[7] 评论:', commentText?.includes('记得同步给老板') ? 'OK' : 'FAIL')

// 8. REST 造超时样例：已超时（2 小时前截止）+ 即将超时（30 分钟后截止，提前 1 小时提醒）
const r1 = await fetch(`${cfg.baseUrl}/api/todos`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ title: '逾期样例', priority: 0, due_at: iso(-2 * 3600e3), tags: ['工作'] })
})
const overdueId = (await r1.json()).data.id
const r2 = await fetch(`${cfg.baseUrl}/api/todos`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ title: '即将到期样例', priority: 2, due_at: iso(30 * 60e3), warn_minutes: 60 })
})
const soonId = (await r2.json()).data.id
await page.reload()
await page.waitForSelector('.todos-page', { timeout: 10000 })
await page.waitForTimeout(900)
const allRows = (await page.locator('.todo-row').allTextContents()).join(' ')
console.log('[8] 已超时徽标:', allRows.includes('已超时'), '即将超时徽标:', allRows.includes('即将超时'))
await page.screenshot({ path: 'output/playwright/todos-list.png' })

// 9. 筛选：优先级 P0 → 只剩逾期样例；搜索；标签
await page.locator('.mini-select').first().click()
await page.getByRole('option', { name: 'P0 紧急' }).click()
await page.waitForTimeout(400)
const p0Rows = await page.locator('.todo-row').count()
console.log('[9] P0 筛选后行数:', p0Rows, p0Rows === 1 ? 'OK' : 'FAIL')
// 清除 P0 筛选（hover 出 clear 图标）
await page.locator('.mini-select').first().hover()
await page.locator('.mini-select').first().locator('.el-select__clear').click()
await page.waitForTimeout(400)
await page.locator('.search-input input').fill('季度报告')
await page.waitForTimeout(400)
console.log('[9b] 搜索「季度报告」行数:', await page.locator('.todo-row').count())
await page.locator('.search-input input').fill('')
await page.waitForTimeout(300)

// 10. 状态流转：完成 → 已完成 tab；重新开启；关闭 → 已关闭；再重开
await page.locator('.todo-row', { hasText: '完成季度报告' }).first().click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(700)
await page.locator('.filter-row .el-radio-button').nth(1).click() // 已完成
await page.waitForTimeout(400)
console.log('[10a] 已完成 tab 含报告:', (await page.locator('.todo-row').allTextContents()).join(' ').includes('完成季度报告'))
await page.locator('.todo-row', { hasText: '完成季度报告' }).first().click()
await page.getByRole('button', { name: '重新开启' }).click()
await page.waitForTimeout(700)
await page.locator('.filter-row .el-radio-button').nth(0).click() // 待处理
await page.waitForTimeout(300)
await page.locator('.todo-row', { hasText: '完成季度报告' }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '关闭', exact: true }).click()
await page.waitForTimeout(700)
await page.locator('.filter-row .el-radio-button').nth(2).click() // 已关闭
await page.waitForTimeout(300)
const closedHas = (await page.locator('.todo-row').allTextContents()).join(' ').includes('完成季度报告')
await page.locator('.todo-row', { hasText: '完成季度报告' }).first().click()
await page.getByRole('button', { name: '重新开启' }).click()
await page.waitForTimeout(600)
console.log('[10b] 关闭→已关闭tab→重开:', closedHas ? 'OK' : 'FAIL')

// 11. 删除清理测试样例
for (const id of [overdueId, soonId]) {
  await fetch(`${cfg.baseUrl}/api/todos/${id}`, { method: 'DELETE', headers: H })
}
const cats = await (await fetch(`${cfg.baseUrl}/api/todo-categories`, { headers: H })).json()
const workCat = cats.data.find((c) => c.name === '工作')
console.log('[11] 清理样例完成，工作分类保留:', !!workCat)
await page.screenshot({ path: 'output/playwright/todos-final.png' })

console.log('[完成] 待办模块 UI 验证结束')
await browser.close()

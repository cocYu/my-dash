/** 笔记模块三期验证：tooltip 文字可见 / 目录-大纲切换与跳转 / Typora 主题导入-应用-删除 */
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:5173'))
if (!page) throw new Error('未找到渲染窗口')
await page.setViewportSize({ width: 1360, height: 820 })
await page.evaluate(() => {
  localStorage.setItem('mydash:notes-panel', 'tree') // 上轮可能把左侧停在大纲
  localStorage.setItem('mydash:md-theme', 'github') // 上轮可能停在 e2e Typora 主题（导致「使用」按钮禁用）
  location.hash = '#/notes'
})
await page.reload()
await page.waitForSelector('.note-tree', { timeout: 10000 })
await page.waitForTimeout(900)

// 1. tooltip 文字可见（之前 bug：浅色主题白底白字看似空白 tooltip）
await page.locator('.tree-toolbar button').nth(3).hover() // 示例笔记按钮
await page.waitForSelector('.el-popper:not([style*="display: none"])', { timeout: 4000 })
await page.waitForTimeout(500)
const tip = await page.evaluate(() => {
  const poppers = [...document.querySelectorAll('.el-popper')].filter((el) => {
    const s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null
  })
  const el = poppers[poppers.length - 1]
  if (!el) return { found: false }
  const style = getComputedStyle(el)
  const text = (el.textContent ?? '').trim()
  return { found: true, text: text.slice(0, 30), color: style.color, bg: style.backgroundColor }
})
console.log('[1] tooltip:', JSON.stringify(tip))
const rgb = (c) => (c.match(/\d+/g) ?? [0, 0, 0]).slice(0, 3).map(Number)
const lum = (c) => {
  const [r, g, b] = rgb(c)
  return 0.299 * r + 0.587 * g + 0.114 * b
}
console.log('[1b] tooltip 文字/背景对比度足够:', tip.found && tip.text.length > 0 && Math.abs(lum(tip.color) - lum(tip.bg)) > 60)

// 打开示例笔记作为大纲数据源
await page.locator('.tree-row', { hasText: 'Markdown 语法示例' }).first().click()
await page.waitForTimeout(1200)

// 2. 目录/大纲切换
await page.locator('.panel-switch .el-segmented__item').nth(1).click()
await page.waitForTimeout(500)
const outlineTexts = await page.locator('.outline-item .outline-text').allTextContents()
console.log('[2] 大纲条目数:', outlineTexts.length, '前5项:', outlineTexts.slice(0, 5).join(' | '))
console.log('[2b] 未把代码围栏注释当标题:', !outlineTexts.some((t) => t.includes('克隆并启动')))
console.log('[2c] 未把转义 # 当标题:', !outlineTexts.some((t) => t.includes('不是标题')))

// 3. 大纲跳转：点击「数学公式」→ 预览滚动位置变化
await page.locator('.view-switch .el-radio-button').nth(2).click() // 预览视图
await page.waitForTimeout(500)
const beforeTop = await page.evaluate(() => document.querySelector('.md-preview')?.scrollTop ?? -1)
await page.locator('.outline-item', { hasText: '数学公式' }).click()
await page.waitForTimeout(900)
const afterTop = await page.evaluate(() => document.querySelector('.md-preview')?.scrollTop ?? -1)
console.log('[3] 大纲跳转滚动: %s → %s', beforeTop, afterTop, '→', afterTop > beforeTop + 50 ? 'OK' : 'FAIL')
await page.screenshot({ path: 'output/playwright/notes3-outline.png' })
await page.locator('.view-switch .el-radio-button').nth(1).click() // 回分屏
await page.waitForTimeout(400)
// 分屏下点「结语」→ 源码滚动
await page.locator('.outline-item', { hasText: '结语' }).click()
await page.waitForTimeout(700)
const cmScroll = await page.evaluate(() => {
  const sc = document.querySelector('.editor-pane .cm-scroller')
  return sc?.scrollTop ?? -1
})
console.log('[3b] 分屏源码滚动到结语:', cmScroll)

// 4. Typora 主题：导入 → 使用 → 生效 → 删除
await page.locator('.editor-toolbar button[title^="Typora 主题"]').click()
await page.waitForSelector('.el-dialog:has-text("Typora 主题")', { timeout: 4000 })
await page.waitForTimeout(400)
await page.getByRole('button', { name: '导入 .css 主题…' }).click()
await page.waitForTimeout(1000)
const tableText = await page.locator('.typora-table').textContent()
console.log('[4] 导入后列表含 e2e-typora:', tableText?.includes('e2e-typora'))
await page.screenshot({ path: 'output/playwright/notes3-typora-dialog.png' })
// 使用
await page.locator('.typora-table .el-table__row', { hasText: 'e2e-typora' }).getByRole('button', { name: '使用' }).click()
await page.waitForTimeout(1200)
const typo = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  if (!el) return null
  const s = getComputedStyle(el)
  const bq = el.querySelector('blockquote')
  return { fontSize: s.fontSize, maxWidth: s.maxWidth, bqBorder: bq ? getComputedStyle(bq).borderLeftColor : '' }
})
console.log('[4b] Typora 主题生效(41px/700px/gold):', JSON.stringify(typo))
await page.screenshot({ path: 'output/playwright/notes3-typora-applied.png' })

// 关闭对话框（完成），再从工具栏下拉验证「Typora 主题」分组
await page.getByRole('button', { name: '完成', exact: true }).last().click()
await page.waitForTimeout(500)
await page.locator('.theme-select').click()
await page.waitForTimeout(400)
const groupVisible = await page.getByText('Typora 主题', { exact: true }).first().isVisible()
const optVisible = await page.getByRole('option', { name: 'e2e-typora' }).isVisible()
console.log('[4c] 主题下拉含「Typora 主题」分组与选项:', groupVisible, optVisible)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 重新打开对话框删除主题
await page.locator('.editor-toolbar button[title^="Typora 主题"]').click()
await page.waitForTimeout(500)
await page.locator('.typora-table .el-table__row', { hasText: 'e2e-typora' }).getByRole('button', { name: '删除' }).click()
await page.waitForTimeout(1000)
const afterRows = await page.locator('.typora-table .el-table__row').count()
console.log('[4d] 删除后列表行数:', afterRows)
await page.getByRole('button', { name: '完成', exact: true }).last().click()
await page.waitForTimeout(400)
const reverted = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? getComputedStyle(el).fontSize : ''
})
console.log('[4e] 删除后回退默认渲染(字号不再是41px):', reverted !== '41px' ? `OK(${reverted})` : 'FAIL')

console.log('[完成] 笔记模块三期验证通过')
await browser.close()

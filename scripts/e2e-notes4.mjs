/** 笔记模块四期验证：进入默认目录面板 + 导出 PDF 带书签大纲 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'


const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:5173'))
if (!page) throw new Error('未找到渲染窗口')
await page.setViewportSize({ width: 1360, height: 820 })
// 模拟上轮遗留的大纲模式（旧版本写入 localStorage）
await page.evaluate(() => {
  localStorage.setItem('mydash:notes-panel', 'outline')
  localStorage.setItem('mydash:md-theme', 'github')
  location.hash = '#/notes'
})
await page.reload()
await page.waitForSelector('.note-tree', { timeout: 10000 })
await page.waitForTimeout(900)

// 1. 进入笔记页默认显示「目录」（即使遗留了大纲标记）
const activeLabel = await page.evaluate(() => {
  const el = document.querySelector('.panel-switch .el-segmented__item.is-selected .el-segmented__item-label')
  return el?.textContent?.trim()
})
console.log('[1] 进入时面板:', activeLabel, activeLabel === '目录' ? 'OK' : 'FAIL')

// 1b. 切到大纲 → 路由离开再回来 → 仍是大纲（会话内记忆）；重启类刷新 → 回目录
await page.locator('.panel-switch .el-segmented__item').nth(1).click()
await page.waitForTimeout(300)
await page.evaluate(() => {
  location.hash = '#/dashboard'
})
await page.waitForTimeout(500)
await page.evaluate(() => {
  location.hash = '#/notes'
})
await page.waitForTimeout(600)
const afterBack = await page.evaluate(() => {
  const el = document.querySelector('.panel-switch .el-segmented__item.is-selected .el-segmented__item-label')
  return el?.textContent?.trim()
})
console.log('[1b] 路由切走再回来保持大纲:', afterBack)
await page.reload()
await page.waitForSelector('.note-tree', { timeout: 10000 })
await page.waitForTimeout(800)
const afterReload = await page.evaluate(() => {
  const el = document.querySelector('.panel-switch .el-segmented__item.is-selected .el-segmented__item-label')
  return el?.textContent?.trim()
})
console.log('[1c] 刷新后回到目录:', afterReload, afterReload === '目录' ? 'OK' : 'FAIL')

// 2. 导出 PDF（示例笔记，含 17 个标题）→ 原生对话框回车 → 校验书签大纲
await page.evaluate(() => {
  location.hash = '#/notes'
})
await page.waitForTimeout(500)
await page.locator('.tree-row', { hasText: 'Markdown 语法示例' }).first().click()
await page.waitForTimeout(1400)
await page.locator('.editor-toolbar .el-dropdown').first().hover()
await page.locator('.editor-toolbar .el-dropdown').first().click()
await page.waitForTimeout(500)
await page.getByText('导出 PDF (.pdf)').click()
await page.waitForTimeout(1800) // 等原生保存对话框
await page.keyboard.press('Enter')
await page.waitForTimeout(2500)
const toast = (await page.locator('.el-message').last().textContent().catch(() => '')) ?? ''
console.log('[2] 导出结果:', toast.trim())
const savedPath = toast.match(/已导出：(.+)/)?.[1]?.trim()
if (!savedPath) throw new Error('导出未完成：' + toast)
const pdfPath = savedPath
const raw = fs.readFileSync(pdfPath).toString('latin1')
const hasOutlines = raw.includes('/Outlines')
const titleCount = (raw.match(/\/Title[\s(]/g) ?? []).length
const tagged = raw.includes('/MarkInfo') || raw.includes('/StructTreeRoot')
console.log('[2] PDF:', path.basename(pdfPath), `(${(raw.length / 1024).toFixed(0)} KB)`)
console.log('[2a] 含 /Outlines 书签树:', hasOutlines)
console.log('[2b] /Title 书签条目数:', titleCount, titleCount >= 10 ? 'OK' : 'FAIL')
console.log('[2c] 带标签 PDF 结构:', tagged)
await browser.close()

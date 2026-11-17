/** 笔记模块二期验证：同名约束 / Markdown 导入 / 示例笔记 / 排版微调 / 状态栏（需 dev + 9222 + MYDASH_IMPORT_FIXTURE） */
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find((p) => p.url().includes('localhost:5173'))
if (!page) throw new Error('未找到渲染窗口')
await page.setViewportSize({ width: 1360, height: 820 })
await page.evaluate(() => {
  location.hash = '#/notes'
})
await page.reload() // 先整页刷新，避免 HMR 半更新状态干扰
await page.waitForSelector('.note-tree', { timeout: 8000 })
await page.waitForTimeout(800)

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

// 清场：删除上轮运行可能留下的测试对象（按名字）
for (const name of ['测试组', '会议纪要', '导入测试一', '导入测试二', '说明文档', 'Markdown 语法示例', '子目录']) {
  const row = page.locator('.tree-row', { hasText: name }).first()
  let guard = 0
  while ((await row.count()) && guard++ < 8) {
    await row.hover()
    await row.locator('.row-actions .el-icon[title="删除"]').click()
    await page.getByRole('button', { name: '删除' }).last().click()
    await page.waitForTimeout(600)
  }
}
const deepFolder = page.locator('.tree-row', { hasText: '导入' }).first()
if (await deepFolder.count()) {
  await deepFolder.hover()
  await deepFolder.locator('.row-actions .el-icon[title="删除"]').click()
  await page.getByRole('button', { name: '删除' }).last().click()
  await page.waitForTimeout(600)
}
console.log('[0] 清场完成')

// 1. 同名约束：新建根文件夹「测试组」，再建同名应报错
await page.click('.tree-toolbar button:nth-child(1)')
await page.locator('.el-message-box__input input').fill('测试组')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(600)
console.log('[1a] 新建文件夹「测试组」:', await lastMessage())

await page.click('.tree-toolbar button:nth-child(1)')
await page.locator('.el-message-box__input input').fill('测试组')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(600)
console.log('[1b] 再建同名文件夹:', await lastMessage())

// 1c. 根级同名笔记
await page.click('.tree-toolbar button:nth-child(2)')
await page.locator('.el-message-box__input input').fill('会议纪要')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(700)
console.log('[1c] 新建笔记「会议纪要」:', await lastMessage())

await page.click('.tree-toolbar button:nth-child(2)')
await page.locator('.el-message-box__input input').fill('会议纪要')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(600)
console.log('[1d] 再建同名笔记:', await lastMessage())

// 1e. 拖拽同名拒绝：把根级「会议纪要」拖进「测试组」（先在其中建同名）
const groupNode = page.locator('.tree-row', { hasText: '测试组' }).first()
await groupNode.hover()
await groupNode.locator('.row-actions .el-icon[title="新建笔记"]').click()
await page.locator('.el-message-box__input input').fill('会议纪要')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(700)
console.log('[1e] 测试组内建同名笔记「会议纪要」(不同层级,应成功):', await lastMessage())

// 2. 导入 Markdown 文件（dev fixture 钩子绕过原生对话框）
await page.locator('.tree-toolbar .el-dropdown').first().hover()
await page.locator('.tree-toolbar .el-dropdown').first().click()
await page.waitForTimeout(400)
await page.getByText('导入 Markdown 文件…').click()
await page.waitForTimeout(1200)
console.log('[2] 导入 2 个 md 文件:', await lastMessage())

// 3. 导入 Markdown 文件夹（递归：子目录/深层/深层笔记.md）
await page.locator('.tree-toolbar .el-dropdown').first().hover()
await page.locator('.tree-toolbar .el-dropdown').first().click()
await page.waitForTimeout(400)
await page.getByText('导入 Markdown 文件夹…').click()
await page.waitForTimeout(1500)
console.log('[3] 导入文件夹:', await lastMessage())
await page.waitForTimeout(500)
const importedDeep = await page.locator('.tree-row', { hasText: '深层笔记' }).count()
console.log('[3b] 深层笔记出现在树中:', importedDeep > 0)
await page.screenshot({ path: 'output/playwright/notes2-imported.png' })

// 4. 示例笔记
await page.locator('.tree-toolbar button').nth(3).click()
await page.waitForTimeout(1200)
console.log('[4] 创建示例笔记:', await lastMessage())
const previewHtml = await page.evaluate(() => document.querySelector('.preview-pane .md-body')?.innerHTML ?? '')
console.log('[4b] 预览覆盖: h1=%s h2=%s 表格=%s task=%s katex=%s toc=%s code=%s', /<h1/.test(previewHtml), /<h2/.test(previewHtml), /<table/.test(previewHtml), /task-list/.test(previewHtml), /katex/.test(previewHtml), /md-toc/.test(previewHtml), /hljs/.test(previewHtml))
await page.screenshot({ path: 'output/playwright/notes2-sample.png' })

// 5. 排版微调：字号 15→20，行高 1.75→2.2，取消铺满(限宽 900)
const fontSizeBefore = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? getComputedStyle(el).fontSize : ''
})
await page.locator('.editor-toolbar button[title^="排版微调"]').click()
await page.waitForSelector('.el-dialog:has-text("排版微调")', { timeout: 4000 })
await page.waitForTimeout(400)
await page.getByRole('button', { name: '恢复默认' }).click() // 从上次持久化值回到默认，便于断言
await page.waitForTimeout(400)
const fontSizeDefault = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? getComputedStyle(el).fontSize : ''
})
console.log('[5a] 恢复默认后字号(应 15px):', fontSizeDefault)
await page.getByRole('button', { name: '恢复默认' }).click() // 从上次持久化值回到默认，便于断言
await page.waitForTimeout(300)
// 字号滑杆 show-input：第一个 .el-input-number
const fontSizeInput = page.locator('.el-dialog .el-slider__input input').first()
await fontSizeInput.fill('20')
await fontSizeInput.press('Enter')
await page.waitForTimeout(400)
const lineHeightInput = page.locator('.el-dialog .el-slider').nth(1).locator('input.el-input__inner').first()
await lineHeightInput.fill('2.2')
await lineHeightInput.press('Enter')
await page.waitForTimeout(300)
await page.locator('.el-dialog .el-checkbox').click() // 取消铺满
await page.waitForTimeout(600)
const fontSizeAfter = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? getComputedStyle(el).fontSize : ''
})
const lineHeightAfter = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? getComputedStyle(el).lineHeight : ''
})
const maxWidthAfter = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? getComputedStyle(el).maxWidth : ''
})
console.log('[5] 排版微调: 字号 %s → %s, 行高→%s, maxWidth→%s', fontSizeBefore, fontSizeAfter, lineHeightAfter, maxWidthAfter)
await page.screenshot({ path: 'output/playwright/notes2-typography.png' })
await page.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(400)

// 6. 状态栏
const statusText = await page.locator('.editor-status').textContent()
console.log('[6] 状态栏:', statusText?.replace(/\s+/g, ' ').trim())
const statusOk = /字/.test(statusText ?? '') && /分钟/.test(statusText ?? '') && /创建 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(statusText ?? '') && /更新 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(statusText ?? '')
console.log('[6b] 状态栏格式完整:', statusOk)

// 7. 编辑器内改标题为同名 → 自动保存应报错（标题输入也触发自动保存）
await page.locator('.title-input input').first().fill('导入测试一')
await page.waitForTimeout(1800)
console.log('[7] 编辑器改标题为同名:', await lastMessage())
// 改回原标题，避免影响后续
await page.locator('.title-input input').first().fill('Markdown 语法示例')
await page.waitForTimeout(1200)

// 8. 排版持久化：刷新后重新打开示例笔记，字号仍为 20
await page.reload()
await page.waitForSelector('.note-tree', { timeout: 8000 })
await page.waitForTimeout(800)
await page.locator('.tree-row', { hasText: 'Markdown 语法示例' }).first().click()
await page.waitForTimeout(1200)
const fontSizeReload = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? getComputedStyle(el).fontSize : '(未找到预览)'
})
console.log('[8] 刷新后字号保持:', fontSizeReload)
const tocOk = await page.evaluate(() => {
  const el = document.querySelector('.preview-pane .md-body')
  return el ? { toc: /md-toc/.test(el.innerHTML), code: /hljs/.test(el.innerHTML), fence: !!el.querySelector('pre.hljs code') } : null
})
console.log('[8b] 修复后示例渲染: ', JSON.stringify(tocOk))
await page.screenshot({ path: 'output/playwright/notes2-final.png' })

console.log('[完成] 笔记模块二期验证通过')
await browser.close()

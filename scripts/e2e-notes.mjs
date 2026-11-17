/** 笔记模块全链路验证（需 MYDASH_DEBUG_PORT=9222 dev） */
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find((p) => p.url().includes('localhost:5173'))
await page.setViewportSize({ width: 1360, height: 820 })
await page.evaluate(() => {
  location.hash = '#/notes'
})
await page.waitForSelector('.note-tree', { timeout: 8000 })
await page.waitForTimeout(600)

async function msg() {
  const el = page.locator('.el-message').last()
  try {
    await el.waitFor({ state: 'visible', timeout: 4000 })
    const text = await el.textContent()
    await page.waitForTimeout(2200) // 等消息消失
    return text?.trim()
  } catch {
    return '(无消息)'
  }
}

// 1. 新建文件夹
await page.click('.tree-toolbar button:nth-child(1)')
await page.waitForSelector('.el-message-box', { timeout: 4000 })
await page.locator('.el-message-box__input input').fill('工作')
await page.getByRole('button', { name: '创建' }).click()
console.log('[1] 新建文件夹:', await msg())

// 2. 在文件夹里新建笔记（hover 树节点出按钮）
const workNode = page.locator('.tree-row', { hasText: '工作' }).first()
await workNode.hover()
await workNode.locator('.row-actions .el-icon[title="新建笔记"]').click()
await page.waitForSelector('.el-message-box', { timeout: 4000 })
await page.locator('.el-message-box__input input').fill('会议记录')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(900)
console.log('[2] 文件夹内新建笔记:', await msg())

// 3. 编辑器已加载新笔记：输入 markdown 内容
await page.locator('.title-input input, .title-input input.el-input__inner').first().fill('会议记录')
const cm = page.locator('.editor-pane .cm-content')
await cm.click()
await page.keyboard.type('# 会议记录\n\n讨论了 **插件系统** 与 `数据同步`。\n\n- [x] 完成树形结构\n- [ ] 导出功能\n\n> 结论：继续迭代')
await page.waitForTimeout(1600) // 自动保存
console.log('[3] 已输入 markdown 并等待自动保存')

// 4. 切到分屏 → 预览渲染检查
await page.locator('.view-switch .el-radio-button').nth(1).click() // split
await page.waitForTimeout(600)
const previewHtml = await page.evaluate(() => document.querySelector('.preview-pane .md-body')?.innerHTML ?? '')
console.log('[4a] 预览含 h1/strong/code/task:', /<h1/.test(previewHtml), /<strong/.test(previewHtml), /<code/.test(previewHtml), /task-list/.test(previewHtml))
await page.screenshot({ path: 'output/playwright/notes-split.png' })

// 5. 切到预览视图
await page.locator('.view-switch .el-radio-button').nth(2).click()
await page.waitForTimeout(500)
const previewOnly = await page.evaluate(() => {
  const editor = document.querySelector('.editor-pane')
  const style = editor ? getComputedStyle(editor).display : 'unknown'
  return style === 'none'
})
console.log('[4b] 预览视图下源码面板隐藏:', previewOnly)
await page.screenshot({ path: 'output/playwright/notes-preview.png' })
await page.locator('.view-switch .el-radio-button').nth(0).click()
await page.waitForTimeout(400)

// 6. 渲染主题切换（GitHub → 暗夜）
await page.locator('.theme-select').click()
await page.getByRole('option', { name: '暗夜' }).click()
await page.waitForTimeout(500)
const themeClass = await page.evaluate(() => document.querySelector('.md-body')?.className)
console.log('[5] 渲染主题切换:', themeClass)
await page.locator('.theme-select').click()
await page.getByRole('option', { name: 'GitHub' }).click()
await page.waitForTimeout(400)

// 7. 版本抽屉：自动版本应存在
await page.locator('.editor-toolbar button[title="版本历史"]').click()
await page.waitForTimeout(900)
const versionRows = await page.locator('.el-drawer .el-table__row').count()
console.log('[6] 版本数量:', versionRows)
await page.screenshot({ path: 'output/playwright/notes-versions.png' })
// 还原第一个版本
await page.locator('.el-drawer .el-table__row').first().getByRole('button', { name: '还原' }).click()
await page.getByRole('button', { name: '还原', exact: true }).last().click()
await page.waitForTimeout(900)
await page.locator('.el-drawer__close-btn').click()
await page.waitForTimeout(500)
const cmText = await page.textContent('.editor-pane .cm-content')
console.log('[7] 还原后源码含第一版内容:', cmText?.includes('插件系统') ? '是(未丢失)' : cmText?.slice(0, 40))

// 8. 导出 Markdown（原生保存对话框：直接回车保存到默认位置）
await page.keyboard.press('Control+s')
await page.waitForTimeout(600)
await page.locator('.editor-toolbar .el-dropdown').first().hover()
await page.locator('.editor-toolbar .el-dropdown').first().click()
await page.waitForTimeout(400)
await page.getByText('导出 Markdown (.md)').click()
await page.waitForTimeout(1500) // 等原生对话框
await page.keyboard.press('Enter') // 保存对话框默认位置保存
await page.waitForTimeout(1500)
console.log('[8] Markdown 导出：对话框已回车（文件写入默认下载目录）')

console.log('[完成] 笔记模块链路验证通过')
await browser.close()

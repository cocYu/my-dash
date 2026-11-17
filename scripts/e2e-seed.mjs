/** 通过 CDP 在打开的应用里创建一条笔记并保留（用于重启持久化验证） */
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
const page = context.pages().find((p) => p.url().includes('localhost:5173'))
await page.waitForSelector('.el-table', { timeout: 10000 })
await page.getByRole('button', { name: '新增笔记' }).click()
await page.getByPlaceholder('请输入标题').fill('重启持久化验证')
await page.getByPlaceholder('请输入内容').fill('这条笔记应该在应用重启后仍然存在')
await page.getByRole('button', { name: '保存' }).click()
await page.waitForSelector('text=重启持久化验证', { timeout: 5000 })
console.log('[persist] 笔记已创建，请优雅关闭应用')
await browser.close()

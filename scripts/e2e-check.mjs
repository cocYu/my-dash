/**
 * e2e 冒烟验证：通过 CDP 连接 dev 模式的 Electron 窗口，
 * 走一遍笔记 CRUD（新增 → 编辑 → 删除），并截图到 output/playwright/。
 *
 * 前置：npm run dev（且设置了 MYDASH_DEBUG_PORT=9222）
 * 运行：node scripts/e2e-check.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'output', 'playwright')
mkdirSync(outDir, { recursive: true })

const CDP_URL = process.env.E2E_CDP_URL ?? 'http://127.0.0.1:9222'

const browser = await chromium.connectOverCDP(CDP_URL)
const context = browser.contexts()[0]
const page =
  context.pages().find((p) => p.url().includes('localhost:5173')) ??
  (await context.waitForEvent('page'))

console.log('[e2e] 页面:', page.url())
await page.waitForSelector('.el-table', { timeout: 10000 })

// 1. 新增笔记
await page.getByRole('button', { name: '新增笔记' }).click()
await page.getByPlaceholder('请输入标题').fill('e2e 冒烟测试笔记')
await page.getByPlaceholder('请输入内容').fill('由 Playwright 通过 CDP 自动创建')
await page.screenshot({ path: path.join(outDir, '01-create-dialog.png') })
await page.getByRole('button', { name: '保存' }).click()
await page.waitForSelector('.el-message--success', { timeout: 5000 })
console.log('[e2e] 新增成功提示已出现')

// 2. 表格中出现新行
await page.waitForSelector('.el-table__row >> text=e2e 冒烟测试笔记', { timeout: 5000 })
console.log('[e2e] 表格中已出现新笔记')
await page.screenshot({ path: path.join(outDir, '02-created.png') })

// 3. 编辑该笔记
const row = page.locator('.el-table__row', { hasText: 'e2e 冒烟测试笔记' })
await row.getByRole('button', { name: '编辑' }).click()
await page.getByPlaceholder('请输入标题').fill('e2e 冒烟测试笔记（已编辑）')
await page.getByRole('button', { name: '保存' }).click()
await page.waitForSelector('text=e2e 冒烟测试笔记（已编辑）', { timeout: 5000 })
console.log('[e2e] 编辑生效')
await page.screenshot({ path: path.join(outDir, '03-edited.png') })

// 4. 删除该笔记
const editedRow = page.locator('.el-table__row', { hasText: '已编辑' })
await editedRow.getByRole('button', { name: '删除' }).click()
await page.getByRole('button', { name: '删除', exact: true }).last().click()
await page.waitForSelector('.el-message--success', { timeout: 5000 })
await page.waitForSelector('.el-table__row >> text=e2e 冒烟测试笔记', { state: 'detached', timeout: 5000 })
console.log('[e2e] 删除生效，表格已恢复')
await page.screenshot({ path: path.join(outDir, '04-deleted.png') })

console.log('[e2e] 全部通过 ✔  截图目录:', outDir)
await browser.close()

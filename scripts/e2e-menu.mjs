/**
 * 菜单快捷键验证（需 MYDASH_DEBUG_PORT=9222 npm run dev）：
 *   Ctrl+Shift+S 显示主窗口 / Ctrl+Shift+H 隐藏到托盘
 * （点 X 的真实关闭路径用 computer-use 验证：window.close() 受浏览器脚本限制无法模拟）
 * 运行：node scripts/e2e-menu.mjs
 */
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
const page = context.pages().find((p) => p.url().includes('localhost:5173'))

await page.waitForSelector('.el-table', { timeout: 10000 })
console.log('[e2e-menu] 1. 页面就绪')

await page.keyboard.press('Control+Shift+S')
await page.waitForTimeout(800)
const afterShow = await page.evaluate(() => document.visibilityState)
if (afterShow !== 'visible') throw new Error('Ctrl+Shift+S 未恢复窗口')
console.log('[e2e-menu] 2. Ctrl+Shift+S 显示主窗口 ✔')

await page.keyboard.press('Control+Shift+H')
await page.waitForTimeout(800)
const afterHide = await page.evaluate(() => document.visibilityState)
if (afterHide !== 'hidden') throw new Error('Ctrl+Shift+H 未隐藏窗口')
console.log('[e2e-menu] 3. Ctrl+Shift+H 隐藏到托盘 ✔')

await page.keyboard.press('Control+Shift+S')
await page.waitForTimeout(500)
const restored = await page.evaluate(() => document.visibilityState)
if (restored !== 'visible') throw new Error('窗口未恢复')
console.log('[e2e-menu] 4. 窗口已恢复显示，菜单快捷键全部通过')

/** 设置页小视口滚动验证 v2：切到内容最长的「插件」分区再锁高 */
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find((p) => p.url().includes('localhost:5173'))
await page.evaluate(() => {
  location.hash = '#/settings'
})
await page.waitForSelector('.settings-menu', { timeout: 8000 })
await page.click('.settings-menu .el-menu-item:has-text("插件")')
await page.waitForTimeout(600)

// 模拟小视口：锁高 380px
await page.evaluate(() => {
  document.querySelector('.settings-page').style.height = '380px'
})
await page.waitForTimeout(300)

const m = await page.evaluate(() => {
  const main = document.querySelector('.main')
  const nav = document.querySelector('.nav-panel')
  const content = document.querySelector('.content-panel')
  content.scrollTop = content.scrollHeight
  const scrollable = (el) => el.scrollHeight > el.clientHeight
  return {
    outerNoScroll: main.scrollHeight <= main.clientHeight,
    navOverflow: scrollable(nav),
    contentOverflow: scrollable(content),
    contentScrollTop: content.scrollTop
  }
})
console.log(JSON.stringify(m, null, 1))
await page.waitForTimeout(300)
await page.screenshot({ path: 'output/playwright/settings-scroll-small.png' })
await page.evaluate(() => {
  document.querySelector('.settings-page').style.height = ''
})
await browser.close()

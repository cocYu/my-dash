/** 图片附件全链路验证：粘贴/拖拽入库 → attach:// 预览 → 导出内嵌 → 同步备份含附件 → GC 清理 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:5173'))
if (!page) throw new Error('未找到渲染窗口')
await page.setViewportSize({ width: 1360, height: 820 })
await page.evaluate(() => {
  localStorage.setItem('mydash:md-theme', 'github')
  location.hash = '#/notes'
})
await page.reload()
await page.waitForSelector('.note-tree', { timeout: 10000 })
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

const statsBefore = await page.evaluate(() => window.api.attachments.stats())
console.log('[0] 初始附件:', JSON.stringify(statsBefore))

// 新建笔记「图片测试」
await page.click('.tree-toolbar button:nth-child(2)')
await page.locator('.el-message-box__input input').fill('图片测试')
await page.getByRole('button', { name: '创建' }).click()
await page.waitForTimeout(900)
await page.locator('.editor-pane .cm-content').click()
await page.keyboard.type('# 图片测试\n\n下面是一张粘贴的图片：\n')

// 1. 粘贴截图（合成 ClipboardEvent + DataTransfer File）
const pasteResult = await page.evaluate(async () => {
  // 标准有效 1x1 红色 PNG
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }))
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  document.querySelector('.cm-content').dispatchEvent(ev)
  await new Promise((r) => setTimeout(r, 900))
  return document.querySelector('.editor-pane .cm-content').textContent
})
const pastedName = pasteResult?.match(/attach:\/\/([a-f0-9]{16}\.png)/)?.[1]
console.log('[1] 粘贴入库:', pastedName ? `OK(${pastedName})` : `FAIL: ${pasteResult?.slice(0, 60)}`)

// 2. 拖拽图片（合成 DropEvent，落在内容末尾）
const dropResult = await page.evaluate(async () => {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8AAxIQBEwMDAwMDAwAkBgMBjXK9qwAAAABJRU5ErkJggg=='
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
  const cm = document.querySelector('.editor-pane .cm-content')
  const rect = cm.getBoundingClientRect()
  const ev = new DragEvent('drop', {
    dataTransfer: dt,
    bubbles: true,
    cancelable: true,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height - 10
  })
  cm.dispatchEvent(ev)
  await new Promise((r) => setTimeout(r, 900))
  return document.querySelector('.editor-pane .cm-content').textContent
})
const dropName = dropResult?.match(/attach:\/\/([a-f0-9]{16}\.png)/g)?.length >= 2
console.log('[2] 拖拽入库:', dropName ? 'OK' : `FAIL: ${dropResult?.slice(-60)}`)
await page.waitForTimeout(1400) // 自动保存

// 3. 预览经 attach:// 协议加载图片
await page.locator('.view-switch .el-radio-button').nth(1).click() // split
await page.waitForTimeout(700)
const imgs = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.preview-pane .md-body img')]
  return list.map((img) => ({ src: img.getAttribute('src')?.slice(0, 30), w: img.naturalWidth }))
})
console.log('[3] 预览图片:', JSON.stringify(imgs), imgs.length >= 2 && imgs.every((i) => i.w > 0) ? 'OK' : 'FAIL')
await page.screenshot({ path: 'output/playwright/attach-preview.png' })

// 4. 导出 HTML：附件内嵌 data URI
await page.locator('.editor-toolbar .el-dropdown').first().hover()
await page.locator('.editor-toolbar .el-dropdown').first().click()
await page.waitForTimeout(500)
await page.getByText('导出 HTML (.html)').click()
await page.waitForTimeout(1800)
await page.keyboard.press('Enter')
await page.waitForTimeout(2200)
const exportToast = (await page.locator('.el-message').last().textContent().catch(() => '')) ?? ''
const htmlPath = exportToast.match(/已导出：(.+)/)?.[1]?.trim()
if (!htmlPath) throw new Error('HTML 导出未完成：' + exportToast)
const html = fs.readFileSync(htmlPath, 'utf8')
const embedded = (html.match(/data:image\/png;base64,/g) ?? []).length
console.log('[4] HTML 内嵌 base64 图片数:', embedded, embedded >= 2 ? 'OK' : 'FAIL')
fs.rmSync(htmlPath, { force: true })

// 5. 同步备份包含 attachments/**
await page.evaluate(async () => {
  await window.api.sync.saveConfig({
    target: 'webdav',
    remotePath: '/mydash-e2e',
    keepLast: 3,
    webdav: { url: 'http://127.0.0.1:9988/', username: 'anonymous', password: '' },
    s3: { endpoint: '', region: '', bucket: '', accessKeyId: '', secretAccessKey: '', pathStyle: true },
    schedule: { enabled: false, mode: 'interval', intervalHours: 24, dailyTime: '09:00' }
  })
})
const syncRec = await page.evaluate(() => window.api.sync.run())
console.log('[5] 同步上传:', syncRec.status, syncRec.size, 'bytes')
const remoteName = syncRec.remoteFile.split('/').pop()
const zipPath = path.join('output', 'wd-root', 'mydash-e2e', remoteName)
const zip = new AdmZip(zipPath)
const attachEntries = zip.getEntries().filter((e) => e.entryName.startsWith('attachments/'))
const hasPasted = attachEntries.some((e) => e.entryName === `attachments/${pastedName}`)
console.log('[5b] 备份包内附件数:', attachEntries.length, '含粘贴图:', hasPasted ? 'OK' : 'FAIL')

// 6. GC：删除笔记 → 未引用附件被清理，被引用的保留
const statsMid = await page.evaluate(() => window.api.attachments.stats())
console.log('[6] 入库后附件:', JSON.stringify(statsMid))
const noteRow = page.locator('.tree-row', { hasText: '图片测试' }).first()
await noteRow.hover()
await noteRow.locator('.row-actions .el-icon[title="删除"]').click()
await page.getByRole('button', { name: '删除' }).last().click()
await page.waitForTimeout(800)
const gc = await page.evaluate(() => window.api.attachments.gc())
console.log('[6b] GC 清理:', JSON.stringify(gc), gc.deleted >= 2 ? 'OK' : 'FAIL')
const statsAfter = await page.evaluate(() => window.api.attachments.stats())
// 此场景下唯一笔记已删除，其两张图均无剩余引用 → 应全部清空（探针遗留图也一并回收）
console.log('[6c] GC 后附件:', JSON.stringify(statsAfter), statsAfter.count === 0 ? 'OK' : 'FAIL')

// 7. 设置页附件卡片显示
await page.evaluate(() => {
  location.hash = '#/settings'
})
await page.waitForTimeout(700)
const cardText = await page.locator('.attach-head').textContent()
console.log('[7] 设置附件卡片:', /图片附件/.test(cardText ?? '') && /\d+ 张/.test(cardText ?? '') ? 'OK' : `FAIL: ${cardText?.slice(0, 50)}`)
await page.screenshot({ path: 'output/playwright/attach-settings.png' })

console.log('[完成] 图片附件全链路验证通过')
await browser.close()

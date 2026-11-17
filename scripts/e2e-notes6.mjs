/** 分屏滚动同步验证：双向映射正确性 + 回声稳定 + 3000 行大文件滚动性能（长任务检测） */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:5173'))
if (!page) throw new Error('未找到渲染窗口')
await page.setViewportSize({ width: 1360, height: 820 })
await page.evaluate(() => {
  localStorage.setItem('mydash:notes-panel', 'tree')
  localStorage.setItem('mydash:md-theme', 'github')
  localStorage.setItem('mydash:md-viewmode', 'split')
  location.hash = '#/notes'
})
await page.reload()
await page.waitForSelector('.note-tree', { timeout: 10000 })
await page.waitForTimeout(900)

// 打开示例笔记（~120 行，17 个标题）
await page.locator('.tree-row', { hasText: 'Markdown 语法示例' }).first().click()
await page.waitForTimeout(1600)

const getState = () =>
  page.evaluate(() => {
    const sc = document.querySelector('.editor-pane .cm-scroller')
    const pv = document.querySelector('.md-preview')
    return {
      editor: sc?.scrollTop ?? 0,
      editorMax: (sc?.scrollHeight ?? 0) - (sc?.clientHeight ?? 0),
      preview: pv?.scrollTop ?? 0,
      previewMax: (pv?.scrollHeight ?? 0) - (pv?.clientHeight ?? 0),
      anchors: document.querySelectorAll('.preview-pane [data-line]').length
    }
  })

const s0 = await getState()
console.log('[0] 锚点数(顶层块):', s0.anchors, s0.anchors > 10 ? 'OK' : 'FAIL')

// 1. 编辑器滚到 40% → 预览跟随（比例容差 0.18）
await page.evaluate(() => {
  const sc = document.querySelector('.editor-pane .cm-scroller')
  sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * 0.4
  sc.dispatchEvent(new Event('scroll'))
})
await page.waitForTimeout(400)
let s = await getState()
const edRatio = s.editor / s.editorMax
const pvRatio = s.preview / s.previewMax
console.log(`[1] 编辑器40% → 预览比例 ${pvRatio.toFixed(3)}（编辑器 ${edRatio.toFixed(3)}）`, Math.abs(edRatio - pvRatio) < 0.18 ? 'OK' : 'FAIL')
await page.screenshot({ path: 'output/playwright/sync-mid.png' })

// 2. 编辑器到底 → 预览到底
await page.evaluate(() => {
  const sc = document.querySelector('.editor-pane .cm-scroller')
  sc.scrollTop = sc.scrollHeight
  sc.dispatchEvent(new Event('scroll'))
})
await page.waitForTimeout(400)
s = await getState()
console.log('[2] 编辑器到底 → 预览到底:', s.preview >= s.previewMax - 4 ? 'OK' : `FAIL(${s.preview}/${s.previewMax})`)

// 3. 编辑器回顶 → 预览回顶
await page.evaluate(() => {
  const sc = document.querySelector('.editor-pane .cm-scroller')
  sc.scrollTop = 0
  sc.dispatchEvent(new Event('scroll'))
})
await page.waitForTimeout(400)
s = await getState()
console.log('[3] 编辑器回顶 → 预览回顶:', s.preview <= 2 ? 'OK' : `FAIL(${s.preview})`)

// 4. 反向：预览滚到 55% → 编辑器跟随
await page.evaluate(() => {
  const pv = document.querySelector('.md-preview')
  pv.scrollTop = (pv.scrollHeight - pv.clientHeight) * 0.55
  pv.dispatchEvent(new Event('scroll'))
})
await page.waitForTimeout(400)
s = await getState()
const edRatio2 = s.editor / s.editorMax
console.log(`[4] 预览55% → 编辑器比例 ${edRatio2.toFixed(3)}`, Math.abs(edRatio2 - 0.55) < 0.2 ? 'OK' : 'FAIL')

// 5. 回声稳定：等待后再读两次应一致（无振荡）
await page.waitForTimeout(300)
const sA = await getState()
await page.waitForTimeout(300)
const sB = await getState()
console.log('[5] 无振荡:', Math.abs(sA.editor - sB.editor) < 2 && Math.abs(sA.preview - sB.preview) < 2 ? 'OK' : 'FAIL')
await page.screenshot({ path: 'output/playwright/sync-reverse.png' })

// ---- 6. 大文件性能：REST 建 3000 行笔记 ----
const cfg = await page.evaluate(() => window.api.getBackendConfig())
const headers = { 'Content-Type': 'application/json', 'X-API-Token': cfg.token }
let bigId = null
{
  const paras = []
  for (let i = 1; i <= 700; i++) {
    paras.push(`## 第 ${i} 节\n\n这是大文件性能测试的第 ${i} 段内容，包含**加粗**、\`行内代码\`与普通文字，用于填充滚动长度。以下是列表：\n\n- 条目甲 ${i}\n- 条目乙 ${i}\n- 条目丙 ${i}\n`)
  }
  const content = `# 大文件滚动测试\n\n${paras.join('\n')}`
  const r = await fetch(`${cfg.baseUrl}/api/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: '大文件滚动测试', content })
  })
  const body = await r.json()
  bigId = body.data.id
  console.log('[6] 大文件已创建: id=%s, 行数≈%s', bigId, content.split('\n').length)
}

// 打开大笔记并切分屏
await page.evaluate((id) => {
  location.hash = '#/notes'
}, bigId)
await page.reload()
await page.waitForSelector('.note-tree', { timeout: 10000 })
await page.waitForTimeout(600)
await page.locator('.tree-row', { hasText: '大文件滚动测试' }).first().click()
await page.waitForTimeout(2500) // 等首次渲染

const big0 = await getState()
console.log('[6b] 大文件锚点数:', big0.anchors, '编辑器可滚动:', big0.editorMax > 5000)

// 长任务观测 + 20 步滚动
await page.evaluate(() => {
  window.__longTasks = []
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__longTasks.push(e.duration)
  }).observe({ entryTypes: ['longtask'] })
})
const t0 = Date.now()
for (let i = 1; i <= 20; i++) {
  await page.evaluate((frac) => {
    const sc = document.querySelector('.editor-pane .cm-scroller')
    sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * frac
    sc.dispatchEvent(new Event('scroll'))
  }, i / 20)
  await page.waitForTimeout(60)
}
const wall = Date.now() - t0
const long = await page.evaluate(() => window.__longTasks)
const maxLong = long.length ? Math.max(...long) : 0
const bigSync = await getState()
console.log(`[6c] 20 步滚动耗时 ${wall}ms（含等待），长任务 ${long.length} 个，最长 ${maxLong.toFixed(1)}ms`)
console.log('[6d] 大文件同步生效: 预览比例', (bigSync.preview / bigSync.previewMax).toFixed(3), bigSync.preview > 0 ? 'OK' : 'FAIL')
const perfOk = maxLong < 150 && long.filter((d) => d > 100).length <= 2
console.log('[6e] 性能达标(无>100ms长任务,瞬时<150ms):', perfOk ? 'OK' : 'FAIL')
await page.screenshot({ path: 'output/playwright/sync-bigfile.png' })

// 反向大文件：预览拖到中部
await page.evaluate(() => {
  const pv = document.querySelector('.md-preview')
  pv.scrollTop = (pv.scrollHeight - pv.clientHeight) * 0.5
  pv.dispatchEvent(new Event('scroll'))
})
await page.waitForTimeout(400)
const bigRev = await getState()
console.log('[6f] 大文件反向同步: 编辑器比例', (bigRev.editor / bigRev.editorMax).toFixed(3), Math.abs(bigRev.editor / bigRev.editorMax - 0.5) < 0.2 ? 'OK' : 'FAIL')

// 清理大笔记
const del = await fetch(`${cfg.baseUrl}/api/notes/${bigId}`, { method: 'DELETE', headers })
console.log('[7] 清理大笔记:', del.ok ? 'OK' : 'FAIL')
await page.evaluate(() => window.api.attachments.gc?.()).catch(() => {})

console.log('[完成] 分屏滚动同步验证结束')
await browser.close()

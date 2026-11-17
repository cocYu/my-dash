/**
 * 插件管理页 e2e：启停 toggle / zip 导入 / 恶意 zip 拒绝（需 MYDASH_DEBUG_PORT=9222 dev）
 * 运行：node scripts/e2e-plugin-import.mjs
 */
import { chromium } from 'playwright-core'
import AdmZip from 'adm-zip'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const zipDir = path.join(root, 'output', 'test-zips')
rmSync(zipDir, { recursive: true, force: true })
mkdirSync(zipDir, { recursive: true })

// ---- 造一个最小 zip 插件 hello-zip（带根目录层，模拟真实分发格式）----
const helloDir = path.join(zipDir, 'src', 'hello-zip')
mkdirSync(helloDir, { recursive: true })
writeFileSync(
  path.join(helloDir, 'plugin.json'),
  JSON.stringify({
    id: 'hello-zip',
    name: 'Zip 导入测试',
    version: '0.1.0',
    description: 'e2e 导入测试',
    main: 'index.js',
    permissions: []
  })
)
writeFileSync(
  path.join(helloDir, 'index.js'),
  `export function activate(ctx) {
  const { h, defineComponent } = ctx.vue
  ctx.registerPage({
    path: '/hello',
    title: 'Zip 你好',
    component: defineComponent({ setup: () => () => h('div', { style: 'padding:16px' }, 'Hello from zip plugin!') })
  })
}
`
)
const helloZip = new AdmZip()
helloZip.addLocalFolder(helloDir, 'hello-zip')
const helloZipPath = path.join(zipDir, 'hello-zip.zip')
helloZip.writeZip(helloZipPath)

// ---- 造恶意 zip：adm-zip 会把 ../ 规范化掉，这里手工构造原始 ZIP 字节（store 模式），
//      让条目真的携带 evil-plugin/../../evil.txt，用于压测导入器的防穿越护栏 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function buildHostileZip(entries) {
  // entries: [{ name, data: Buffer }]
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf-8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const centralStart = offset
  const centralSize = centrals.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  return Buffer.concat([...locals, ...centrals, eocd])
}
const evilZipPath = path.join(zipDir, 'evil.zip')
writeFileSync(
  evilZipPath,
  buildHostileZip([
    { name: 'evil-plugin/plugin.json', data: Buffer.from(JSON.stringify({ id: 'evil-plugin', name: 'evil', version: '0.1.0', main: 'index.js', permissions: [] })) },
    { name: 'evil-plugin/index.js', data: Buffer.from('export function activate() {}') },
    { name: 'evil-plugin/../../evil-escaped.txt', data: Buffer.from('pwned') }
  ])
)
console.log('[import-e2e] 恶意 zip 条目: evil-plugin/../../evil-escaped.txt')

// ---- UI 驱动 ----
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find((p) => p.url().includes('localhost:5173'))
await page.waitForSelector('.el-menu', { timeout: 10000 })

// 1. 插件管理页列表
await page.click('.el-menu-item:has-text("插件管理")')
await page.waitForSelector('.el-table__row', { timeout: 5000 })
const rows = await page.$$eval('.el-table__row', (rs) => rs.map((r) => r.textContent))
console.log('[import-e2e] 1. 插件列表:', JSON.stringify(rows.map((t) => t.slice(0, 24))))
if (!rows.some((r) => r.includes('notes-stats'))) throw new Error('列表缺少 notes-stats')

// 2. 禁用 notes-stats → 侧边栏入口消失 → 重新启用 → 恢复
const switchEl = page.locator('.el-table__row', { hasText: 'notes-stats' }).locator('.el-switch')
await switchEl.click()
await page.waitForTimeout(1200) // 等重载完成
let menuTexts = await page.$$eval('.el-menu-item span', (els) => els.map((e) => e.textContent))
console.log('[import-e2e] 2a. 禁用后侧边栏:', JSON.stringify(menuTexts))
if (menuTexts.some((t) => t?.includes('笔记统计'))) throw new Error('禁用后入口仍存在')
await switchEl.click()
await page.waitForTimeout(1200)
menuTexts = await page.$$eval('.el-menu-item span', (els) => els.map((e) => e.textContent))
console.log('[import-e2e] 2b. 重新启用后侧边栏:', JSON.stringify(menuTexts))
if (!menuTexts.some((t) => t?.includes('笔记统计'))) throw new Error('重新启用后入口未恢复')

// 3. 导入恶意 zip → 必须被防穿越护栏拒绝
await page.setInputFiles('input[type=file]', evilZipPath)
await page.waitForSelector('.el-message--error', { timeout: 5000 })
const errText = await page.textContent('.el-message--error')
console.log('[import-e2e] 3. 恶意 zip 被拒:', errText?.trim())
if (!/非法路径/.test(errText ?? '')) throw new Error('恶意 zip 未被防穿越护栏拒绝: ' + errText)

// 4. 导入正常 zip → 侧边栏出现"Zip 你好"
await page.setInputFiles('input[type=file]', helloZipPath)
await page.waitForSelector('.el-message--success', { timeout: 5000 })
await page.waitForTimeout(1200)
menuTexts = await page.$$eval('.el-menu-item span', (els) => els.map((e) => e.textContent))
console.log('[import-e2e] 4. 导入后侧边栏:', JSON.stringify(menuTexts))
if (!menuTexts.some((t) => t?.includes('Zip 你好'))) throw new Error('zip 插件未生效')
await page.click('.el-menu-item:has-text("Zip 你好")')
await page.waitForSelector('text=Hello from zip plugin!', { timeout: 5000 })
console.log('[import-e2e] 4b. zip 插件页面渲染正常')

console.log('[import-e2e] 全部通过 ✔')
await browser.close()

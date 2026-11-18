/**
 * 应用图标生成：从一份方形品牌 logo 生成全套图标资产（正式版，替代早期的自绘占位图标）。
 *
 * 用法：node scripts/gen-icons.mjs <logo.png>
 *
 * 产物：
 *   build/icon.ico                     应用图标（electron-builder win.icon，16~256 多尺寸）
 *   build/icon.icns                    macOS 应用图标
 *   build/icon-512.png                 Linux/通用 512 应用图标
 *   resources/icons/tray.ico           Windows 托盘（16/24/32…256）
 *   resources/icons/trayTemplate.png   macOS 托盘 16×16（黑色剪影 + alpha，自动适配深浅色）
 *   resources/icons/trayTemplate@2x.png
 *   resources/icons/tray.png           Linux 托盘 22×22
 *   resources/icons/icon.png           开发期窗口/任务栏图标 256×256
 *
 * 处理：边缘泛洪去白底（只从四边进入，封闭白区如键帽保留）→ 1024 画布 88% 居中留边 → 各尺寸重采样。
 * 依赖（devDependencies）：jimp（位图处理）、png2icons（ico/icns 容器）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Jimp from 'jimp'
import png2icons from 'png2icons'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = process.argv[2]
if (!src || !fs.existsSync(src)) {
  console.error('用法: node scripts/gen-icons.mjs <logo.png>')
  process.exit(1)
}

const iconsDir = path.join(root, 'resources', 'icons')
const buildDir = path.join(root, 'build')
fs.mkdirSync(iconsDir, { recursive: true })
fs.mkdirSync(buildDir, { recursive: true })

/** 判定「近白背景」：各通道 >= 244 且接近中性（阈值避开米色桌面 (245,237,220)） */
function isBackground(r, g, b, a) {
  if (a === 0) return true
  return r >= 244 && g >= 244 && b >= 244 && Math.max(r, g, b) - Math.min(r, g, b) <= 8
}

/** 从四边泛洪填充透明（4 连通），封闭白区不受影响 */
function floodClearBackground(img) {
  const { width, height, data } = img.bitmap
  const visited = new Uint8Array(width * height)
  const queue = []
  const push = (x, y) => {
    const i = y * width + x
    if (visited[i]) return
    const o = i * 4
    if (!isBackground(data[o], data[o + 1], data[o + 2], data[o + 3])) return
    visited[i] = 1
    data[o + 3] = 0
    queue.push([x, y])
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  while (queue.length) {
    const [x, y] = queue.pop()
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }
}

/** 内容缩放到 size 画布的 ratio 居中（留边） */
async function paddedPng(img, size, ratio) {
  const canvas = new Jimp(size, size, 0x00000000)
  const inner = img.clone().resize(Math.round(size * ratio), Math.round(size * ratio), Jimp.RESIZE_BICUBIC)
  const offset = Math.round((size - inner.bitmap.width) / 2)
  canvas.composite(inner, offset, offset)
  return canvas
}

/** RGB 全黑 + 保留 alpha（macOS 模板图规范） */
function toSilhouette(img) {
  const out = img.clone()
  const d = out.bitmap.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 0
    d[i + 1] = 0
    d[i + 2] = 0
  }
  return out
}

const source = await Jimp.read(src)
const sw = source.bitmap.width
const sh = source.bitmap.height
if (sw !== sh) {
  // 非方形：内切居中裁剪
  const side = Math.min(sw, sh)
  source.crop(Math.round((sw - side) / 2), Math.round((sh - side) / 2), side, side)
}
console.log(`源图 ${sw}x${sh}`)

floodClearBackground(source)

const PAD_RATIO = 0.88
const master = await paddedPng(source, 1024, PAD_RATIO)

const write = async (img, file) => {
  const buf = await img.getBufferAsync(Jimp.MIME_PNG)
  fs.writeFileSync(file, buf)
  console.log('写出', path.relative(root, file), `${img.bitmap.width}x${img.bitmap.height}`)
}

// ---- ico / icns（png2icons 内部重采样，ICO 含 16~256 全尺寸） ----
const masterBuf = await master.getBufferAsync(Jimp.MIME_PNG)
const ico = png2icons.createICO(masterBuf, png2icons.BICUBIC, 0, true, true)
fs.writeFileSync(path.join(iconsDir, 'tray.ico'), ico)
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico)
console.log('写出 resources/icons/tray.ico 与 build/icon.ico', `(${ico.length} bytes)`)

const icns = png2icons.createICNS(masterBuf, png2icons.BICUBIC, 0)
fs.writeFileSync(path.join(buildDir, 'icon.icns'), icns)
console.log('写出 build/icon.icns', `(${icns.length} bytes)`)

// ---- 各尺寸 PNG ----
await write(await paddedPng(source, 512, PAD_RATIO), path.join(buildDir, 'icon-512.png'))
await write(await paddedPng(source, 256, PAD_RATIO), path.join(iconsDir, 'icon.png'))
await write(await paddedPng(source, 22, 0.92), path.join(iconsDir, 'tray.png'))

const tpl16 = await paddedPng(source, 16, 0.92)
const tpl32 = await paddedPng(source, 32, 0.92)
await write(toSilhouette(tpl16), path.join(iconsDir, 'trayTemplate.png'))
await write(toSilhouette(tpl32), path.join(iconsDir, 'trayTemplate@2x.png'))

console.log('[icons] 生成完成')

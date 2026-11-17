/**
 * 生成占位图标（零依赖：手写 PNG / ICO / ICNS 容器 + 3x3 超采样光栅化）。
 * 产物：正式设计资源出来后，直接替换同名文件即可。
 *
 *   build/icon.ico                     应用图标（electron-builder win.icon）
 *   build/icon.icns                    macOS 应用图标（预留）
 *   build/icon-512.png                 Linux 应用图标（预留）
 *   resources/icons/tray.ico           Windows 托盘（16/24/32）
 *   resources/icons/trayTemplate.png   macOS 托盘（黑色剪影 + alpha，自动适配深浅色）
 *   resources/icons/trayTemplate@2x.png
 *   resources/icons/tray.png           Linux 托盘
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------- PNG 编码 ----------------
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

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** rgba: length = width*height*4 */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------- ICO / ICNS 容器 ----------------
/** entries: [{ size, png }] */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach((e, i) => {
    const d = dir.subarray(i * 16, i * 16 + 16)
    d[0] = e.size >= 256 ? 0 : e.size // 0 表示 256
    d[1] = e.size >= 256 ? 0 : e.size
    d.writeUInt16LE(1, 4) // planes
    d.writeUInt16LE(32, 6) // bpp
    d.writeUInt32LE(e.png.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += e.png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

/** entries: [{ type, png }]，type 如 ic07(128)/ic08(256)/ic09(512) */
function encodeIcns(entries) {
  const chunks = entries.map((e) => {
    const c = Buffer.alloc(8 + e.png.length)
    c.write(e.type, 0, 'ascii')
    c.writeUInt32BE(8 + e.png.length, 4)
    e.png.copy(c, 8)
    return c
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((s, c) => s + c.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

// ---------------- 绘制 ----------------
/** 闪电多边形（归一化坐标） */
const BOLT = [
  [0.62, 0.04],
  [0.27, 0.58],
  [0.47, 0.58],
  [0.38, 0.96],
  [0.73, 0.40],
  [0.52, 0.40]
]

function pointInPoly(px, py, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 3x3 超采样：多边形覆盖率 */
function polyCoverage(px, py, poly, ss = 3) {
  let acc = 0
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      if (pointInPoly(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss, poly)) acc++
    }
  }
  return acc / (ss * ss)
}

/** 3x3 超采样：圆角矩形覆盖率（SDF） */
function roundedRectCoverage(px, py, size, radius, ss = 3) {
  let acc = 0
  const hw = size / 2
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const x = px + (sx + 0.5) / ss
      const y = py + (sy + 0.5) / ss
      const qx = Math.abs(x - hw) - (hw - radius)
      const qy = Math.abs(y - hw) - (hw - radius)
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius
      acc += Math.max(0, Math.min(1, 0.5 - d))
    }
  }
  return acc / (ss * ss)
}

/** 缩放归一化多边形到 [pad, size-pad] */
function scalePoly(size, pad = 0) {
  return BOLT.map(([x, y]) => [pad + x * (size - pad * 2), pad + y * (size - pad * 2)])
}

const BRAND_BLUE = [64, 158, 255] // #409EFF

/** 应用图标：蓝色圆角方块 + 白色闪电 */
function drawAppIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const radius = size * 0.22
  const bolt = scalePoly(size, size * 0.12)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bg = roundedRectCoverage(x, y, size, radius)
      const b = polyCoverage(x, y, bolt)
      const i = (y * size + x) * 4
      rgba[i] = Math.round(255 * b + BRAND_BLUE[0] * (1 - b))
      rgba[i + 1] = Math.round(255 * b + BRAND_BLUE[1] * (1 - b))
      rgba[i + 2] = Math.round(255 * b + BRAND_BLUE[2] * (1 - b))
      rgba[i + 3] = Math.round(bg * 255)
    }
  }
  return rgba
}

/** 托盘图标：透明底闪电剪影（macOS 传黑色，Windows/Linux 传品牌蓝） */
function drawBoltIcon(size, [r, g, b]) {
  const rgba = Buffer.alloc(size * size * 4)
  const bolt = scalePoly(size, size * 0.05)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = polyCoverage(x, y, bolt)
      const i = (y * size + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = Math.round(c * 255)
    }
  }
  return rgba
}

// ---------------- 产物 ----------------
const buildDir = path.join(root, 'build')
const iconsDir = path.join(root, 'resources', 'icons')
mkdirSync(buildDir, { recursive: true })
mkdirSync(iconsDir, { recursive: true })

// 应用图标
const appSizes = [256, 128, 64, 48, 32, 16]
writeFileSync(
  path.join(buildDir, 'icon.ico'),
  encodeIco(appSizes.map((size) => ({ size, png: encodePng(size, size, drawAppIcon(size)) })))
)
const png512 = encodePng(512, 512, drawAppIcon(512))
writeFileSync(path.join(buildDir, 'icon.icns'), encodeIcns([
  { type: 'ic07', png: encodePng(128, 128, drawAppIcon(128)) },
  { type: 'ic08', png: encodePng(256, 256, drawAppIcon(256)) },
  { type: 'ic09', png: png512 }
]))
writeFileSync(path.join(buildDir, 'icon-512.png'), png512)

// 托盘图标
writeFileSync(
  path.join(iconsDir, 'tray.ico'),
  encodeIco([16, 24, 32].map((size) => ({ size, png: encodePng(size, size, drawBoltIcon(size, BRAND_BLUE)) })))
)
writeFileSync(path.join(iconsDir, 'tray.png'), encodePng(22, 22, drawBoltIcon(22, BRAND_BLUE)))
writeFileSync(path.join(iconsDir, 'trayTemplate.png'), encodePng(16, 16, drawBoltIcon(16, [0, 0, 0])))
writeFileSync(path.join(iconsDir, 'trayTemplate@2x.png'), encodePng(32, 32, drawBoltIcon(32, [0, 0, 0])))

console.log('[icons] 生成完成:')
console.log('  build/icon.ico, build/icon.icns, build/icon-512.png')
console.log('  resources/icons/{tray.ico, tray.png, trayTemplate.png, trayTemplate@2x.png}')

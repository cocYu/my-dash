// 桌面截屏：desktopCapturer 窗口/屏幕源枚举 + 全屏遮罩式区域截图（冻屏就地编辑）+ 选区长截图 + 图片落盘。
// 供插件（screenshot-tool 等）通过 window.api.capture 调用；渲染层拿到源 id 后
// 调用 snapshot 获取屏幕或窗口画面，无需保持媒体流。
// 区域截图流程（冻屏快照在主进程完成——部分环境下屏幕源 MediaStream 不出帧，
// getSources 高分辨率 thumbnail 是更可靠的整屏快照通道；主窗先隐藏再快照，画面干净）：
//   1. capture:start-region / 全局快捷键（shortcuts.ts）：隐藏主窗 → 快照光标所在显示器 → 原位建遮罩窗加载插件遮罩页
//   2. 遮罩页 capture:get-overlay-image 取冻屏画面 → 拖框选区 → 就地标注/OCR/贴图（遮罩不关闭）
//   3. 遮罩页完成最终动作后 capture:finish-region 携带结果：关遮罩、按截图前可见性还原主窗、推回主窗
// 长截图流程：
//   1. 遮罩页把选区与首帧交给 capture:start-longshot：遮罩退场 → 建内容保护的浮动控制条小窗（不抢焦点）
//   2. 控制条页 capture:longshot-frame 逐帧整屏快照（自行按选区裁剪）→ 渲染层拼接（行哈希重叠对齐）
//   3. 自动模式经 capture:send-key 向前置目标应用发翻页键（macOS osascript，需辅助功能权限）
//   4. capture:finish-longshot 携带拼接结果：关控制条、推回主窗
import { BrowserWindow, app, clipboard, ClipboardItem, dialog, desktopCapturer, ipcMain, screen } from 'electron'
import type { CaptureAppearance } from '../types/capture'
import { Blob } from 'node:buffer'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

export interface CaptureSourceInfo {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnail: string
  appIcon?: string
}

const displayBySource = new Map<string, string>()
let overlayWindow: BrowserWindow | null = null
let overlayImage: string | null = null
let getMainWindow: () => BrowserWindow | null = () => null
// 截图开始前主窗是否可见：决定结束时是否还原并聚焦（快捷键触发且主窗隐藏时不打扰）
let mainWasVisible = false
let starting = false
let captureDisplay: Electron.Display | null = null

let longshotBarWindow: BrowserWindow | null = null
let longshotRect: { x: number; y: number; w: number; h: number } | null = null
type Region = { x: number; y: number; w: number; h: number }
let longshotAppearance: CaptureAppearance | undefined
let longshotPixels: Region | null = null
let longshotFirstFrame: string | null = null

/** 枚举屏幕与窗口源（缩略图 dataURL），供插件自绘选择器 */
export async function listCaptureSources(): Promise<CaptureSourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 440, height: 248 },
    fetchWindowIcons: true
  })
  displayBySource.clear()
  const infos: CaptureSourceInfo[] = []
  for (const s of sources) {
    const type = s.id.startsWith('screen:') ? 'screen' : 'window'
    if (type === 'screen') displayBySource.set(s.id, s.display_id)
    infos.push({
      id: s.id,
      name: s.name || (type === 'screen' ? '屏幕' : '窗口'),
      type,
      thumbnail: s.thumbnail.toDataURL(),
      ...(s.appIcon && !s.appIcon.isEmpty() ? { appIcon: s.appIcon.toDataURL() } : {})
    })
  }
  return infos
}

/** 校验插件页路径：仅允许插件目录内的 html 文件名，防穿越 */
function sanitizePage(page: string): string | null {
  if (typeof page !== 'string') return null
  const p = page.replace(/^\/+/, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(p) || p.includes('..') || !p.endsWith('.html')) return null
  return p
}

/** 整屏快照（当前会话显示器物理分辨率，thumbnail 通道），区域截图冻屏与长截图逐帧共用 */
async function snapshotSessionScreen(): Promise<string> {
  const fixture = !app.isPackaged && process.env['MYDASH_CAPTURE_TEST_IMAGE']
  if (fixture) return `data:image/png;base64,${(await fs.promises.readFile(fixture)).toString('base64')}`
  const display = captureDisplay ?? screen.getPrimaryDisplay()
  const dpr = display.scaleFactor
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.size.width * dpr), height: Math.round(display.size.height * dpr) }
  })
  const primary = sources.find((s) => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined)
  if (!primary || primary.thumbnail.isEmpty()) {
    throw new Error('无法获取屏幕画面（请检查系统屏幕录制权限，并确认显示器仍已连接）')
  }
  return primary.thumbnail.toDataURL()
}

/** 创建全屏遮罩窗（透明、置顶、不进任务栏、自身不被截屏） */
async function showOverlay(pluginId: string, page: string): Promise<void> {
  const display = captureDisplay ?? screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // 遮罩窗自身不能出现在后续截屏流里
  win.setContentProtection(true)
  overlayWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (overlayWindow === win) {
      overlayWindow = null
      overlayImage = null
      restoreMainWindow()
    }
  })
  win.webContents.once('render-process-gone', () => { if (!win.isDestroyed()) win.destroy() })
  await win.loadURL(`plugin://${pluginId}/${page}?t=${Date.now()}`)
}

/** 关闭遮罩窗并恢复截图前的主窗状态 */
function closeOverlay(): void {
  const win = overlayWindow
  overlayWindow = null
  if (win && !win.isDestroyed()) win.destroy()
  overlayImage = null
  restoreMainWindow()
}

/** 按截图前可见性还原主窗 */
function restoreMainWindow(): void {
  captureDisplay = null
  if (!mainWasVisible) return
  mainWasVisible = false
  const main = getMainWindow()
  if (main && !main.isVisible()) main.show()
  main?.focus()
}

/** 启动区域截图（IPC capture:start-region 与全局快捷键共用入口） */
export async function beginRegionCapture(pluginId: string, page = 'overlay.html', delaySeconds = 0): Promise<{ ok: boolean }> {
  if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) {
    throw new Error('非法插件标识')
  }
  const safe = sanitizePage(page)
  if (!safe) throw new Error('非法遮罩页路径')
  if (starting || overlayWindow || longshotBarWindow) throw new Error('已有截图进行中')
  starting = true
  captureDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const main = getMainWindow()
  mainWasVisible = !!main?.isVisible()
  main?.hide()
  // 等主窗真正从屏幕消失再快照，避免把本应用截进去
  await new Promise((r) => setTimeout(r, 260 + ([3, 5, 10].includes(delaySeconds) ? delaySeconds * 1000 : 0)))
  try {
    overlayImage = await snapshotSessionScreen()
    await showOverlay(pluginId, safe)
  } catch (err) {
    closeOverlay()
    throw err
  } finally {
    starting = false
  }
  return { ok: true }
}

/** 创建长截图浮动控制条窗（内容保护、置顶、不抢焦点，加载插件控制条页） */
function showLongshotBar(pluginId: string, page: string): void {
  // 只销毁旧窗口实例，不清 longshotRect/longshotFirstFrame——
  // 调用方（start-longshot handler）刚写入的转场数据还要给新窗口用
  const old = longshotBarWindow
  longshotBarWindow = null
  if (old && !old.isDestroyed()) old.destroy()
  const display = captureDisplay ?? screen.getPrimaryDisplay()
  const width = 560
  const height = 84
  const wa = display.workArea
  const win = new BrowserWindow({
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + wa.height - height - 40,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    // 不抢焦点：点击控制条不打断目标窗口聚焦，自动翻页键始终发给目标应用
    focusable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // 控制条自身不能出现在逐帧快照里
  win.setContentProtection(true)
  console.log('[capture] 长截图控制条创建:', pluginId, page)
  longshotBarWindow = win
  win.once('ready-to-show', () => win.show())
  win.webContents.once('render-process-gone', () => { if (!win.isDestroyed()) win.destroy() })
  win.loadURL(`plugin://${pluginId}/${page}?t=${Date.now()}`).catch((err) => {
    console.error('[capture] 长截图控制条页加载失败:', err)
    if (!win.isDestroyed()) win.destroy()
  })
  win.on('closed', () => {
    console.log('[capture] 长截图控制条已关闭')
    if (longshotBarWindow === win) {
      closeLongshotBar()
      restoreMainWindow()
    }
  })
}

function closeLongshotBar(): void {
  const win = longshotBarWindow
  longshotBarWindow = null
  longshotAppearance = undefined
  longshotPixels = null
  longshotRect = null
  longshotFirstFrame = null
  if (win && !win.isDestroyed()) win.destroy()
}

/** 图片字节落盘：dir 给定直写，否则弹另存对话框（取消返回 saved:false） */
async function saveImageFile(payload: {
  bytes: Uint8Array
  ext?: string
  dir?: string
  defaultName?: string
}): Promise<{ saved: boolean; filePath?: string }> {
  const ext = payload.ext && /^\.[A-Za-z0-9]{1,6}$/.test(payload.ext) ? payload.ext : '.png'
  const safeName = (payload.defaultName ?? `Screenshot_${stamp()}${ext}`).replace(/[\\/:*?"<>|]/g, '_')
  if (payload.dir) {
    const dir = payload.dir
    fs.mkdirSync(dir, { recursive: true })
    const parsed = path.parse(safeName)
    const bytes = Buffer.from(payload.bytes)
    for (let n = 0; ; n++) {
      const filePath = path.join(dir, n ? `${parsed.name} (${n})${parsed.ext}` : safeName)
      try {
        await fs.promises.writeFile(filePath, bytes, { flag: 'wx' })
        return { saved: true, filePath }
      } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err }
    }
  }
  // 主窗隐藏（截图流程中）时不用它做 parent，避免对话框不前置
  const main = getMainWindow()
  const parent = main && main.isVisible() ? main : null
  const r = parent
    ? await dialog.showSaveDialog(parent, { defaultPath: safeName })
    : await dialog.showSaveDialog({ defaultPath: safeName })
  if (r.canceled || !r.filePath) return { saved: false }
  const filePath = r.filePath.toLowerCase().endsWith(ext) ? r.filePath : `${r.filePath}${ext}`
  fs.writeFileSync(filePath, Buffer.from(payload.bytes))
  return { saved: true, filePath }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number, l = 2): string => String(n).padStart(l, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ---- macOS osascript：长截图自动翻页 ----

/** 执行 osascript，stdout 去尾换行 */
async function runOsascript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 })
  return stdout.trim()
}

/** System Events 报告的前置应用进程名 */
async function frontmostAppName(): Promise<string> {
  try {
    return await runOsascript('tell application "System Events" to get name of first application process whose frontmost is true')
  } catch {
    return ''
  }
}

function isSelfProcessName(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'electron' || n === app.getName().toLowerCase()
}

/** osascript 失败转可读提示（最常见是无辅助功能权限） */
function osascriptErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/assistive access|assistive/i.test(raw)) {
    return '需要辅助功能权限：系统设置 → 隐私与安全性 → 辅助功能，勾选本应用后重试'
  }
  return raw.slice(0, 200)
}

/** 翻页键 → System Events key code */
const SCROLL_KEY_CODES: Record<string, number> = { down: 125, pagedown: 121, space: 49 }

export function registerCaptureIpc(getter: () => BrowserWindow | null): void {
  getMainWindow = getter

  ipcMain.handle('capture:sources', () => listCaptureSources())

  // 隐藏主窗 → 目标显示器整屏快照（thumbnail 通道）→ 建遮罩窗展示
  ipcMain.handle('capture:start-region', (_e, payload: { pluginId: string; page?: string; delaySeconds?: number }) =>
    beginRegionCapture(payload?.pluginId ?? '', payload?.page ?? 'overlay.html', payload?.delaySeconds)
  )

  // 单帧快照（全屏/窗口捕获共用，走 thumbnail 通道，不依赖 MediaStream）
  ipcMain.handle('capture:snapshot', async (_e, sourceId: string) => {
    if (typeof sourceId !== 'string' || !/^(screen|window):[\w:]+$/i.test(sourceId)) {
      throw new Error('非法截屏源')
    }
    const type = sourceId.startsWith('screen:') ? 'screen' : 'window'
    if (starting || overlayWindow || longshotBarWindow) throw new Error('已有截图进行中')
    starting = true
    const main = getMainWindow()
    const hideMain = type === 'screen' && !!main?.isVisible()
    try {
      if (hideMain) {
        main?.hide()
        await new Promise(r => setTimeout(r, 260))
      }
      const display = screen.getAllDisplays().find(d => String(d.id) === displayBySource.get(sourceId)) ?? screen.getPrimaryDisplay()
      const { width, height } = display.size
      const thumbnailSize = { width: Math.round(width * display.scaleFactor), height: Math.round(height * display.scaleFactor) }
      const sources = await desktopCapturer.getSources({ types: [type], thumbnailSize })
      const hit = sources.find(s => s.id === sourceId)
      if (!hit || hit.thumbnail.isEmpty()) throw new Error('无法获取画面，请检查屏幕录制权限或重新选择窗口')
      return { dataUrl: hit.thumbnail.toDataURL(), ...hit.thumbnail.getSize() }
    } finally {
      starting = false
      if (hideMain && main && !main.isDestroyed()) main.show()
    }
  })

  // 遮罩页取冻屏画面（仅遮罩窗自身可取）
  ipcMain.handle('capture:get-overlay-image', (e): string | null => {
    if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.webContents !== e.sender) return null
    return overlayImage
  })

  // 遮罩页完成最终动作（就地标注/OCR/保存/贴图后）：关遮罩、按截图前可见性还原主窗、推回主窗记历史
  ipcMain.handle(
    'capture:finish-region',
    (e, payload: { dataUrl: string; kind?: string; ocrText?: string }) => {
      if (overlayWindow?.webContents !== e.sender) return
      const dataUrl = payload?.dataUrl
      const pluginId = new URL(e.sender.getURL()).hostname
      closeOverlay()
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        getMainWindow()?.webContents.send('capture:region-result', {
          dataUrl,
          pluginId,
          kind: payload?.kind === 'longshot' ? 'longshot' : 'region',
          ...(typeof payload?.ocrText === 'string' && payload.ocrText ? { ocrText: payload.ocrText } : {})
        })
      }
    }
  )

  ipcMain.handle('capture:cancel-region', (e) => {
    if (overlayWindow?.webContents !== e.sender) return
    closeOverlay()
    overlayImage = null
  })

  // ---- 选区长截图 ----

  // 遮罩页交棒：选区 + 首帧入库（内存），遮罩退场，建控制条窗
  ipcMain.handle(
    'capture:start-longshot',
    (e, payload: { pluginId: string; barPage?: string; rect: Region; pixelRect?: Region; appearance?: CaptureAppearance; firstFrame: string }) => {
      if (overlayWindow?.webContents !== e.sender) throw new Error('没有活动选区')
      const { pluginId, rect, firstFrame } = payload ?? {}
      if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) throw new Error('非法插件标识')
      const safe = sanitizePage(payload?.barPage ?? 'longshot-bar.html')
      if (!safe) throw new Error('非法控制条页路径')
      if (
        !rect ||
        ![rect.x, rect.y, rect.w, rect.h].every((n) => Number.isFinite(n) && n >= 0) ||
        rect.w < 8 ||
        rect.h < 8
      ) {
        throw new Error('非法选区')
      }
      if (typeof firstFrame !== 'string' || !firstFrame.startsWith('data:image/')) {
        throw new Error('非法首帧图像')
      }
      // 先建控制条再退遮罩：避免在 handle 内同步销毁 invoke sender 的窗口
      // （遮罩页随后随窗口销毁，invoke 回复收不到，无需处理）
      longshotRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
      const px = payload.pixelRect
      longshotPixels = px && [px.x, px.y, px.w, px.h].every(n => Number.isInteger(n) && n >= 0) && px.w && px.h ? px : null
      const style = payload.appearance
      longshotAppearance = style && typeof style.shell === 'string' && style.shell.length <= 32
        ? { rounded: style.rounded === true, radius: Number.isFinite(style.radius) ? Math.min(256,Math.max(0,style.radius)) : 16, shell: style.shell }
        : undefined
      longshotFirstFrame = firstFrame
      showLongshotBar(pluginId, safe)
      const win = overlayWindow
      overlayWindow = null
      overlayImage = null
      if (win && !win.isDestroyed()) win.destroy()
      return { ok: true }
    }
  )

  // 控制条页取初始选区与首帧（仅控制条窗自身可取）
  ipcMain.handle('capture:get-longshot-init', (e) => {
    if (!longshotBarWindow || longshotBarWindow.isDestroyed() || longshotBarWindow.webContents !== e.sender) return null
    return {
      rect: longshotRect,
      pixelRect: longshotPixels,
      appearance: longshotAppearance,
      firstFrame: longshotFirstFrame,
      dpr: (captureDisplay ?? screen.getPrimaryDisplay()).scaleFactor
    }
  })

  // 控制条页逐帧整屏快照（控制条窗内容保护，不会进画面）
  ipcMain.handle('capture:longshot-frame', async (e): Promise<{ dataUrl: string; dpr: number } | null> => {
    if (!longshotBarWindow || longshotBarWindow.isDestroyed() || longshotBarWindow.webContents !== e.sender) return null
    const bar = longshotBarWindow
    bar.hide()
    try {
      await new Promise(r => setTimeout(r, 100))
      if (bar !== longshotBarWindow) return null
      return { dataUrl: await snapshotSessionScreen(), dpr: (captureDisplay ?? screen.getPrimaryDisplay()).scaleFactor }
    } finally { if (bar === longshotBarWindow && !bar.isDestroyed()) bar.showInactive() }
  })

  // 自动翻页：向前置目标应用发翻页键（macOS；前置是本应用时拒绝，提示先点目标窗口）
  ipcMain.handle(
    'capture:send-key',
    async (e, payload: { key: string }): Promise<{ ok: boolean; message?: string }> => {
      if (!longshotBarWindow || longshotBarWindow.isDestroyed() || longshotBarWindow.webContents !== e.sender) {
        return { ok: false, message: '仅长截图控制条可发送翻页键' }
      }
      if (process.platform !== 'darwin') return { ok: false, message: '自动翻页目前仅支持 macOS' }
      const code = SCROLL_KEY_CODES[String(payload?.key)]
      if (!code) return { ok: false, message: '不支持的翻页键' }
      const front = await frontmostAppName()
      if (front && isSelfProcessName(front)) {
        return { ok: false, message: '请先点击要滚动的目标窗口' }
      }
      try {
        await runOsascript(`tell application "System Events" to key code ${code}`)
        return { ok: true }
      } catch (err) {
        return { ok: false, message: osascriptErrorMessage(err) }
      }
    }
  )

  // 拼接完成：关控制条、推回主窗记历史（长图）
  ipcMain.handle('capture:finish-longshot', (e, payload: { dataUrl: string; edit?: boolean }) => {
    if (longshotBarWindow?.webContents !== e.sender) return
    const dataUrl = payload?.dataUrl
    const pluginId = new URL(e.sender.getURL()).hostname
    const appearance = longshotAppearance
    const edit = payload?.edit === true
    closeLongshotBar()
    if (edit) mainWasVisible = true // 显式打开编辑器，包括从隐藏状态的快捷键发起时
    restoreMainWindow()
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      getMainWindow()?.webContents.send('capture:region-result', { dataUrl, pluginId, kind: 'longshot', edit, appearance })
    }
  })

  ipcMain.handle('capture:cancel-longshot', (e) => {
    if (longshotBarWindow?.webContents !== e.sender) return
    closeLongshotBar()
    restoreMainWindow()
  })

  // The non-focusable scrolling bar cannot use the renderer Clipboard API.
  ipcMain.handle('capture:copy-png', async (e, bytes: Uint8Array) => {
    if (e.sender !== overlayWindow?.webContents && e.sender !== longshotBarWindow?.webContents) throw new Error('没有活动截图')
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('截图为空')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })])
  })

  ipcMain.handle('capture:save-file', (_e, payload) => saveImageFile(payload))

  ipcMain.handle('capture:choose-dir', async (): Promise<{ dir: string } | null> => {
    const main = getMainWindow()
    const r = main
      ? await dialog.showOpenDialog(main, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return { dir: r.filePaths[0] }
  })
}

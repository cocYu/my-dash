// 桌面截屏：desktopCapturer 窗口/屏幕源枚举 + 全屏遮罩式区域截图 + 图片落盘。
// 供插件（screenshot-tool 等）通过 window.api.capture 调用；渲染层拿到源 id 后
// 用 getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId}}}) 抓帧。
// 区域截图流程（冻屏快照在主进程完成——部分环境下屏幕源 MediaStream 不出帧，
// getSources 高分辨率 thumbnail 是更可靠的整屏快照通道；主窗先隐藏再快照，画面干净）：
//   1. capture:start-region：校验插件 → 隐藏主窗 → 快照主屏 → 主屏建遮罩窗加载插件遮罩页
//   2. 遮罩页 capture:get-overlay-image 取冻屏画面 → 拖框选区
//   3. capture:finish-region 携带裁剪结果：关遮罩、还原主窗、推回主窗
import { BrowserWindow, dialog, desktopCapturer, ipcMain, screen } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

export interface CaptureSourceInfo {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnail: string
  appIcon?: string
}

let overlayWindow: BrowserWindow | null = null
let overlayImage: string | null = null
let getMainWindow: () => BrowserWindow | null = () => null

/** 枚举屏幕与窗口源（缩略图 dataURL），供插件自绘选择器 */
export async function listCaptureSources(): Promise<CaptureSourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 440, height: 248 },
    fetchWindowIcons: true
  })
  const infos: CaptureSourceInfo[] = []
  for (const s of sources) {
    const type = s.id.startsWith('screen:') ? 'screen' : 'window'
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

/** 创建全屏遮罩窗（透明、置顶、不进任务栏、自身不被截屏） */
function showOverlay(pluginId: string, page: string): void {
  closeOverlay(false)
  const display = screen.getPrimaryDisplay()
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
  void win.loadURL(`plugin://${pluginId}/${page}?t=${Date.now()}`)
  win.on('closed', () => {
    if (overlayWindow === win) overlayWindow = null
  })
}

/** 关闭遮罩窗；restore=true 时还原主窗 */
function closeOverlay(restore = true): void {
  const win = overlayWindow
  overlayWindow = null
  if (win && !win.isDestroyed()) win.destroy()
  if (restore) {
    const main = getMainWindow()
    if (main && !main.isVisible()) main.show()
    main?.focus()
  }
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
    const filePath = path.join(dir, safeName)
    fs.writeFileSync(filePath, Buffer.from(payload.bytes))
    return { saved: true, filePath }
  }
  const main = getMainWindow()
  const r = main
    ? await dialog.showSaveDialog(main, { defaultPath: safeName })
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

export function registerCaptureIpc(getter: () => BrowserWindow | null): void {
  getMainWindow = getter

  ipcMain.handle('capture:sources', () => listCaptureSources())

  // 隐藏主窗 → 主屏整屏快照（thumbnail 通道）→ 建遮罩窗展示
  ipcMain.handle('capture:start-region', async (_e, payload: { pluginId: string; page?: string }) => {
    const { pluginId, page } = payload ?? {}
    if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) {
      throw new Error('非法插件标识')
    }
    const safe = sanitizePage(page ?? 'overlay.html')
    if (!safe) throw new Error('非法遮罩页路径')
    const main = getMainWindow()
    main?.hide()
    // 等主窗真正从屏幕消失再快照，避免把本应用截进去
    await new Promise((r) => setTimeout(r, 260))
    // e2e 钩子：MYDASH_CAPTURE_TEST_IMAGE 指定测试图（无桌面复制能力的远程会话里
    // 整屏捕获不可用，遮罩交互流程用固定图验证，与 MYDASH_*_FIXTURE 系列同思路）
    const testImage = process.env['MYDASH_CAPTURE_TEST_IMAGE']
    if (testImage && fs.existsSync(testImage)) {
      overlayImage = `data:image/png;base64,${fs.readFileSync(testImage).toString('base64')}`
    } else {
      const display = screen.getPrimaryDisplay()
      const dpr = display.scaleFactor
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(display.size.width * dpr), height: Math.round(display.size.height * dpr) }
      })
      const primary = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
      if (!primary || primary.thumbnail.isEmpty()) {
        main?.show()
        throw new Error('无法获取屏幕画面（当前会话可能不支持整屏捕获）')
      }
      overlayImage = primary.thumbnail.toDataURL()
    }
    showOverlay(pluginId, safe)
    return { ok: true }
  })

  // 单帧快照（全屏/窗口捕获共用，走 thumbnail 通道，不依赖 MediaStream）
  ipcMain.handle('capture:snapshot', async (_e, sourceId: string) => {
    if (typeof sourceId !== 'string' || !/^(screen|window):[\w:]+$/i.test(sourceId)) {
      throw new Error('非法截屏源')
    }
    const type = sourceId.startsWith('screen:') ? 'screen' : 'window'
    const display = screen.getPrimaryDisplay()
    const dpr = display.scaleFactor
    // 窗口源以工作区物理尺寸为上限（thumbnail 会拉伸贴满 box，box 过大会放大发虚）；
    // 屏幕源即主屏物理分辨率
    const target =
      type === 'screen'
        ? { width: Math.round(display.size.width * dpr), height: Math.round(display.size.height * dpr) }
        : { width: Math.round(display.workAreaSize.width * dpr), height: Math.round(display.workAreaSize.height * dpr) }
    const sources = await desktopCapturer.getSources({ types: [type], thumbnailSize: target })
    const hit = sources.find((s) => s.id === sourceId)
    if (!hit || hit.thumbnail.isEmpty()) throw new Error('无法获取画面（窗口可能已关闭或受系统保护）')
    const size = hit.thumbnail.getSize()
    return { dataUrl: hit.thumbnail.toDataURL(), width: size.width, height: size.height }
  })

  // 遮罩页取冻屏画面（仅遮罩窗自身可取）
  ipcMain.handle('capture:get-overlay-image', (e): string | null => {
    if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.webContents !== e.sender) return null
    return overlayImage
  })

  ipcMain.handle('capture:finish-region', (_e, payload: { dataUrl: string }) => {
    const dataUrl = payload?.dataUrl
    closeOverlay(true)
    overlayImage = null
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      getMainWindow()?.webContents.send('capture:region-result', { dataUrl })
    }
  })

  ipcMain.handle('capture:cancel-region', () => {
    closeOverlay(true)
    overlayImage = null
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

// 截图贴图（pin）：把图片钉成无边框置顶悬浮窗。供插件通过 window.api.pin 调用。
// 窗口本体由主进程创建（渲染层无此能力），页面内容加载插件的 pin 页（plugin:// 协议），
// 图片以 dataUrl 存主进程内存（会话内有效，应用退出即消失；持久化由插件历史负责）。
import { BrowserWindow, clipboard, ClipboardItem, ipcMain, screen } from 'electron'
import { Blob } from 'node:buffer'
import * as path from 'node:path'

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const PIN_PAGE_RE = /^[A-Za-z0-9][A-Za-z0-9/._-]*\.html$/

interface PinEntry {
  id: string
  win: BrowserWindow
  dataUrl: string
}

const pins = new Map<string, PinEntry>()

/** data URI → { bytes, mime }，非法返回 null */
function decodeDataUri(uri: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(uri)
  if (!m || !m[1].startsWith('image/')) return null
  return { bytes: new Uint8Array(Buffer.from(m[2], 'base64')), mime: m[1] }
}

/** 尺寸封顶到工作区 90%，等比缩放 */
function fitSize(width: number, height: number): { width: number; height: number } {
  const workArea = screen.getPrimaryDisplay().workArea
  const maxW = Math.floor(workArea.width * 0.9)
  const maxH = Math.floor(workArea.height * 0.9)
  let w = Math.max(60, Math.round(width) || 320)
  let h = Math.max(40, Math.round(height) || 240)
  if (w > maxW || h > maxH) {
    const ratio = Math.min(maxW / w, maxH / h)
    w = Math.max(60, Math.round(w * ratio))
    h = Math.max(40, Math.round(h * ratio))
  }
  return { width: w, height: h }
}

function closePin(id: string): void {
  const entry = pins.get(id)
  if (!entry) return
  pins.delete(id)
  if (!entry.win.isDestroyed()) entry.win.destroy()
}

export function registerPinIpc(): void {
  ipcMain.handle(
    'pin:show',
    (_e, payload: { pluginId: string; page: string; dataUrl: string; width: number; height: number }) => {
      const { pluginId, page, dataUrl } = payload ?? {}
      if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) throw new Error('非法插件标识')
      const safe = typeof page === 'string' ? page.replace(/^\/+/, '') : ''
      if (!PIN_PAGE_RE.test(safe) || safe.includes('..')) throw new Error('非法贴图页路径')
      const decoded = decodeDataUri(dataUrl ?? '')
      if (!decoded) throw new Error('贴图内容必须是图片 data URI')
      const { width, height } = fitSize(payload.width, payload.height)
      const id = `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const win = new BrowserWindow({
        width,
        height,
        frame: false,
        transparent: true,
        resizable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          preload: path.join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      // 贴图窗不出现在后续截屏里
      win.setContentProtection(true)
      pins.set(id, { id, win, dataUrl })
      win.on('closed', () => pins.delete(id))
      void win.loadURL(`plugin://${pluginId}/${safe}?pin=${id}&t=${Date.now()}`)
      return { id, width, height }
    }
  )

  ipcMain.handle('pin:get', (_e, id: string): { dataUrl: string } | null => {
    const entry = pins.get(String(id))
    return entry ? { dataUrl: entry.dataUrl } : null
  })

  ipcMain.handle('pin:get-bounds', (_e, id: string): Electron.Rectangle | null => {
    const entry = pins.get(String(id))
    if (!entry || entry.win.isDestroyed()) return null
    return entry.win.getBounds()
  })

  ipcMain.handle(
    'pin:set-bounds',
    (_e, payload: { id: string; x?: number; y?: number; width?: number; height?: number }) => {
      const entry = pins.get(String(payload?.id))
      if (!entry || entry.win.isDestroyed()) return null
      const cur = entry.win.getBounds()
      const next = fitSize(payload.width ?? cur.width, payload.height ?? cur.height)
      entry.win.setBounds({
        x: Number.isFinite(payload.x) ? Math.round(payload.x as number) : cur.x,
        y: Number.isFinite(payload.y) ? Math.round(payload.y as number) : cur.y,
        width: next.width,
        height: next.height
      })
      return entry.win.getBounds()
    }
  )

  // 贴图复制进系统剪贴板（Electron 45 异步 ClipboardItem API）
  ipcMain.handle('pin:copy', async (_e, id: string): Promise<{ ok: boolean; message?: string }> => {
    const entry = pins.get(String(id))
    if (!entry) return { ok: false, message: '贴图不存在' }
    const decoded = decodeDataUri(entry.dataUrl)
    if (!decoded) return { ok: false, message: '贴图内容无效' }
    try {
      await clipboard.write([
        new ClipboardItem({
          [decoded.mime]: new Blob([new Uint8Array(decoded.bytes)], { type: decoded.mime })
        })
      ])
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '写入剪贴板失败' }
    }
  })

  ipcMain.handle('pin:close', (_e, id: string) => {
    closePin(String(id))
  })

  ipcMain.handle('pin:close-all', () => {
    for (const id of [...pins.keys()]) closePin(id)
  })

  ipcMain.handle('pin:list', () => {
    const out: { id: string; bounds: Electron.Rectangle }[] = []
    for (const [id, entry] of pins) {
      if (!entry.win.isDestroyed()) out.push({ id, bounds: entry.win.getBounds() })
    }
    return out
  })
}

// 笔记图片附件：内容寻址存储（sha1 前 16 位十六进制命名）+ attach:// 特权协议 + IPC。
// 同一图片无论粘贴/拖拽到哪篇笔记都只存一份；版本还原时引用同一文件，历史图片不会丢失。
import { app, clipboard, ClipboardItem, dialog, ipcMain, protocol, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Blob } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readHistory } from './ai/history'

const MAX_IMAGE = 20 * 1024 * 1024

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

export function attachmentsDir(): string {
  return path.join(app.getPath('userData'), 'attachments')
}

function ensureDir(): void {
  fs.mkdirSync(attachmentsDir(), { recursive: true })
}

/** 合法附件文件名：<16位hex>.<白名单扩展名>（防路径穿越，attach:// 协议与 GC 共用） */
export function isSafeAttachmentName(name: string): boolean {
  return /^[a-f0-9]{16}\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(name)
}

export function extFromMime(mime: string): string | null {
  const found = Object.entries(EXT_MIME).find(([, m]) => m === mime.toLowerCase())
  return found ? found[1] : null
}

export function mimeFromName(name: string): string {
  return EXT_MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/** 保存图片字节：内容寻址落盘（已存在则复用），返回附件文件名 */
export function storeImage(bytes: Buffer, ext: string): string {
  ensureDir()
  if (!EXT_MIME[ext]) throw new Error(`不支持的图片格式：${ext}`)
  if (bytes.length === 0) throw new Error('图片内容为空')
  if (bytes.length > MAX_IMAGE) throw new Error('图片超过 20MB 限制')
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16)
  const name = `${hash}${ext}`
  const dest = path.join(attachmentsDir(), name)
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, bytes)
  return name
}

/** 附件用量统计 */
export function attachmentStats(): { count: number; bytes: number } {
  ensureDir()
  let count = 0
  let bytes = 0
  for (const f of fs.readdirSync(attachmentsDir())) {
    if (!isSafeAttachmentName(f)) continue
    count += 1
    bytes += fs.statSync(path.join(attachmentsDir(), f)).size
  }
  return { count, bytes }
}

// ---- IPC ----

export function registerAttachmentsIpc(ctx: { baseUrl: string; token: string }): void {
  ensureDir()

  // 渲染层粘贴/拖拽的图片字节入库
  ipcMain.handle('attachments:save-image', (_e, payload: { bytes: Uint8Array; ext: string }) => {
    const bytes = Buffer.from(payload.bytes)
    return { name: storeImage(bytes, payload.ext) }
  })

  // 系统对话框多选图片 → 入库，返回文件名列表（取消返回 null）
  ipcMain.handle('attachments:pick-image', async (): Promise<{ name: string }[] | null> => {
    const r = await dialog.showOpenDialog({
      title: '插入图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const names: { name: string }[] = []
    for (const p of r.filePaths) {
      try {
        if (fs.statSync(p).size > MAX_IMAGE) continue
        const ext = path.extname(p).toLowerCase()
        if (!EXT_MIME[ext]) continue
        names.push({ name: storeImage(fs.readFileSync(p), ext) })
      } catch (err) {
        console.error('[attachments] 导入图片失败:', p, err)
      }
    }
    return names
  })

  // 读取附件为 data URI（HTML/PDF 导出内嵌用）
  ipcMain.handle('attachments:read-data-url', (_e, name: string): string => {
    if (!isSafeAttachmentName(name)) return ''
    const file = path.join(attachmentsDir(), name)
    if (!fs.existsSync(file)) return ''
    return `data:${mimeFromName(name)};base64,${fs.readFileSync(file).toString('base64')}`
  })

  // 复制附件图片到系统剪贴板。
  // Electron 45 的 clipboard 改为 W3C 异步 API（write(ClipboardItem[])），旧的 writeImage 已移除。
  // 渲染层 navigator.clipboard 对自定义协议图片支持不稳定，统一在这里读原文件写入。
  ipcMain.handle('attachments:copy-image', async (_e, name: string): Promise<{ ok: boolean; message?: string }> => {
    if (!isSafeAttachmentName(name)) return { ok: false, message: '无效的附件名' }
    const file = path.join(attachmentsDir(), name)
    if (!fs.existsSync(file)) return { ok: false, message: '图片不存在，可能已被清理' }
    const mime = mimeFromName(name)
    if (!mime.startsWith('image/')) return { ok: false, message: '不是图片文件' }
    try {
      const bytes = new Uint8Array(fs.readFileSync(file))
      await clipboard.write([new ClipboardItem({ [mime]: new Blob([bytes], { type: mime }) })])
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '写入剪贴板失败' }
    }
  })

  // 用量统计 + 打开目录
  ipcMain.handle('attachments:stats', (): { count: number; bytes: number } => attachmentStats())
  ipcMain.handle('attachments:open-dir', (): void => {
    ensureDir()
    void shell.openPath(attachmentsDir())
  })

  // 清理未引用附件：引用集合来自 Go 端扫描（笔记 + 全部版本内容），仅删除无引用文件
  ipcMain.handle('attachments:gc', async (): Promise<{ deleted: number; freedBytes: number }> => {
    ensureDir()
    const referenced = await fetchReferencedNames(ctx)
    // 生图历史引用的图片同样受保护：用户主动删除对应历史后，下次 GC 才会回收
    for (const item of readHistory()) {
      for (const img of item.images) referenced.add(img.name)
    }
    let deleted = 0
    let freedBytes = 0
    for (const f of fs.readdirSync(attachmentsDir())) {
      if (!isSafeAttachmentName(f) || referenced.has(f)) continue
      const file = path.join(attachmentsDir(), f)
      freedBytes += fs.statSync(file).size
      fs.rmSync(file, { force: true })
      deleted += 1
    }
    return { deleted, freedBytes }
  })
}

/** 从 Go 后端拉取被笔记与版本内容引用的附件名集合 */
async function fetchReferencedNames(ctx: { baseUrl: string; token: string }): Promise<Set<string>> {
  const res = await fetch(`${ctx.baseUrl}/api/attachments/referenced`, {
    headers: { 'X-API-Token': ctx.token }
  })
  if (!res.ok) throw new Error(`引用扫描失败: HTTP ${res.status}`)
  const body = (await res.json()) as { code: number; data: { names: string[] } }
  if (body.code !== 0) throw new Error('引用扫描失败')
  return new Set(body.data.names)
}

// ---- attach:// 协议 ----

/** attach://<name> ：仅供读取附件目录内的图片（文件名白名单校验，防穿越） */
export function registerAttachmentsProtocol(): void {
  protocol.handle('attach', (request) => {
    const url = new URL(request.url)
    // Chromium 规范化会在末尾补 "/"：attach://<name>/ ，两侧斜杠都要剥掉
    const name = decodeURIComponent(url.hostname + url.pathname).replace(/^\/+|\/+$/g, '')
    if (!isSafeAttachmentName(name)) {
      return new Response('forbidden', { status: 403 })
    }
    const file = path.join(attachmentsDir(), name)
    if (!fs.existsSync(file)) {
      return new Response('not found', { status: 404 })
    }
    const bytes = fs.readFileSync(file)
    return new Response(bytes, {
      headers: {
        'Content-Type': mimeFromName(name),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    })
  })
}

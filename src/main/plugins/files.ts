// 插件二进制文件存储：userData/plugins/files/<插件id>/。
// 与 KV（plugins/data/<id>.json）并列、与插件目录（升级会被整体替换）分离：
//   - 不随插件覆盖安装丢失
//   - 不受笔记附件 GC 影响（attachments 只清理自己目录）
//   - 位于 userData/plugins 内，随数据同步备份
// 供插件通过 window.api.plugins.files 读写（截图历史等小体量图片场景）。
import { clipboard, ClipboardItem, ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Blob } from 'node:buffer'

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
// 文件名白名单：字母数字开头，允许 . _ -，长度 ≤ 80，天然防路径穿越
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
}

let filesRoot = ''

function dirOf(pluginId: string): string {
  if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) {
    throw new Error('非法插件标识')
  }
  return path.join(filesRoot, pluginId)
}

function resolveFile(pluginId: string, name: string): string {
  if (typeof name !== 'string' || !FILE_NAME_RE.test(name)) throw new Error('非法文件名')
  const dir = dirOf(pluginId)
  const file = path.join(dir, name)
  if (path.dirname(file) !== dir) throw new Error('非法文件名')
  return file
}

interface FileMeta {
  name: string
  size: number
  mtime: string
}

function listFiles(pluginId: string): FileMeta[] {
  const dir = dirOf(pluginId)
  if (!fs.existsSync(dir)) return []
  const out: FileMeta[] = []
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    const st = fs.statSync(file)
    if (!st.isFile()) continue
    out.push({ name, size: st.size, mtime: st.mtime.toISOString() })
  }
  return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
}

function readDataUrl(pluginId: string, name: string): string {
  const file = resolveFile(pluginId, name)
  if (!fs.existsSync(file)) return ''
  const mime = EXT_MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

/** userDataPath 在 bootstrap（app ready 后）传入 */
export function registerPluginFilesIpc(userDataPath: string): void {
  filesRoot = path.join(userDataPath, 'plugins', 'files')

  ipcMain.handle('plugins:files:write', (_e, payload: { pluginId: string; name: string; bytes: Uint8Array }) => {
    const { pluginId, name, bytes } = payload ?? {}
    const file = resolveFile(pluginId, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const buf = Buffer.from(bytes)
    if (buf.length === 0) throw new Error('文件内容为空')
    fs.writeFileSync(file, buf)
    return { name, size: buf.length }
  })

  ipcMain.handle('plugins:files:list', (_e, pluginId: string) => listFiles(pluginId))

  ipcMain.handle('plugins:files:read-data-url', (_e, payload: { pluginId: string; name: string }) =>
    readDataUrl(payload?.pluginId, payload?.name)
  )

  ipcMain.handle('plugins:files:read', (_e, payload: { pluginId: string; name: string }) => {
    const file = resolveFile(payload?.pluginId, payload?.name)
    if (!fs.existsSync(file)) return null
    return new Uint8Array(fs.readFileSync(file))
  })

  ipcMain.handle(
    'plugins:files:copy-image',
    async (_e, payload: { pluginId: string; name: string }): Promise<{ ok: boolean; message?: string }> => {
      const { pluginId, name } = payload ?? {}
      const file = resolveFile(pluginId, name)
      if (!fs.existsSync(file)) return { ok: false, message: '文件不存在' }
      const mime = EXT_MIME[path.extname(name).toLowerCase()] ?? ''
      if (!mime.startsWith('image/')) return { ok: false, message: '不是图片文件' }
      try {
        const bytes = new Uint8Array(fs.readFileSync(file))
        await clipboard.write([new ClipboardItem({ [mime]: new Blob([bytes], { type: mime }) })])
        return { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : '写入剪贴板失败' }
      }
    }
  )

  ipcMain.handle('plugins:files:delete', (_e, payload: { pluginId: string; name: string }) => {
    const file = resolveFile(payload?.pluginId, payload?.name)
    if (fs.existsSync(file)) fs.rmSync(file, { force: true })
    return true
  })

  ipcMain.handle('plugins:files:clear', (_e, pluginId: string) => {
    const dir = dirOf(pluginId)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    return true
  })
}

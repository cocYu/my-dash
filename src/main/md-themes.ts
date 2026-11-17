// Typora 主题管理：用户导入的 .css 主题存放在 userData/md-themes/，
// 渲染层经 IPC 列表/读取/导入/删除，应用于预览与导出。
import { app, dialog, ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

const MAX_CSS = 512 * 1024

export interface UserThemeMeta {
  name: string
  size: number
}

function themesDir(): string {
  return path.join(app.getPath('userData'), 'md-themes')
}

function ensureDir(): void {
  fs.mkdirSync(themesDir(), { recursive: true })
}

/** 只允许目录内的纯文件名，防路径穿越 */
function safeFileName(name: string): string {
  const base = path
    .basename(String(name))
    .replace(/\.css$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
  return base ? `${base}.css` : ''
}

function list(): UserThemeMeta[] {
  ensureDir()
  return fs
    .readdirSync(themesDir())
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({
      name: f.replace(/\.css$/i, ''),
      size: fs.statSync(path.join(themesDir(), f)).size
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

function copyIn(srcPath: string): void {
  if (fs.statSync(srcPath).size > MAX_CSS) return
  const dest = path.join(themesDir(), path.basename(srcPath))
  if (path.dirname(dest) !== themesDir()) return
  fs.copyFileSync(srcPath, dest)
}

export function registerMdThemesIpc(): void {
  ipcMain.handle('md-themes:list', (): UserThemeMeta[] => list())

  ipcMain.handle('md-themes:read', (_e, name: string): string => {
    const file = path.join(themesDir(), safeFileName(name))
    if (path.dirname(file) !== themesDir() || !fs.existsSync(file)) return ''
    return fs.readFileSync(file, 'utf8')
  })

  ipcMain.handle('md-themes:import', (): UserThemeMeta[] | null => {
    ensureDir()
    // e2e 钩子：dev 模式可用 MYDASH_MD_THEME_FIXTURES 指向目录，直接复制其中 .css（绕过原生对话框）
    if (!app.isPackaged && process.env.MYDASH_MD_THEME_FIXTURES) {
      const dir = process.env.MYDASH_MD_THEME_FIXTURES
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
        copyIn(path.join(dir, f))
      }
      return list()
    }

    const r = dialog.showOpenDialogSync({
      title: '导入 Typora 主题（.css，可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Typora 主题', extensions: ['css'] }]
    })
    if (!r?.length) return null
    for (const p of r) copyIn(p)
    return list()
  })

  ipcMain.handle('md-themes:remove', (_e, name: string): UserThemeMeta[] => {
    const file = path.join(themesDir(), safeFileName(name))
    if (path.dirname(file) === themesDir() && fs.existsSync(file)) fs.unlinkSync(file)
    return list()
  })
}

// 笔记导入：弹系统对话框选择 Markdown 文件/文件夹，解析为待创建的树结构
// （渲染层拿到结果后走业务 API 落库）。
import { app, dialog, ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface MdImportFile {
  title: string
  content: string
}

export interface MdImportNode {
  /** 文件夹名（根层为所选目录名，渲染层可忽略） */
  title: string
  note?: MdImportFile
  children?: MdImportNode[]
}

export type MdImportResult =
  | { canceled: true }
  | { files: MdImportFile[] }
  | { tree: MdImportNode[] }

const MD_RE = /\.(md|markdown)$/i
const MAX_FILE = 8 * 1024 * 1024

/** 文件/目录名 → 标题：去 .md 扩展名、替换 Windows 非法字符 */
function titleFromFilename(name: string): string {
  const base = name.replace(MD_RE, '')
  return (
    base
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || '未命名笔记'
  )
}

function readMd(filePath: string): string | null {
  try {
    if (fs.statSync(filePath).size > MAX_FILE) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    if (raw.includes('\0')) return null // 二进制/损坏文件不导入
    return raw
  } catch {
    return null
  }
}

/** 递归读取目录：.md → 笔记，子目录 → 文件夹；不含任何笔记的空目录被剪掉 */
function walkDir(dir: string, title: string): MdImportNode | null {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const files = entries
    .filter((e) => e.isFile() && MD_RE.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  const children: MdImportNode[] = []
  for (const d of dirs) {
    const sub = walkDir(path.join(dir, d.name), titleFromFilename(d.name))
    if (sub) children.push(sub)
  }
  for (const f of files) {
    const content = readMd(path.join(dir, f.name))
    if (content != null) {
      children.push({ title: titleFromFilename(f.name), note: { title: titleFromFilename(f.name), content } })
    }
  }
  if (children.length === 0) return null
  return { title, children }
}

function pickFiles(): MdImportResult {
  // e2e 钩子：dev 模式可用 MYDASH_IMPORT_FIXTURE 绕过原生对话框（仅读取目录下 .md）
  if (!app.isPackaged && process.env.MYDASH_IMPORT_FIXTURE) {
    const dir = process.env.MYDASH_IMPORT_FIXTURE
    const files = (fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && MD_RE.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) as fs.Dirent[])
      .map((e) => {
        const content = readMd(path.join(dir, e.name))
        return content == null
          ? null
          : { title: titleFromFilename(e.name), content }
      })
      .filter((x): x is MdImportFile => x != null)
    return { files }
  }

  const r = dialog.showOpenDialogSync({
    title: '导入 Markdown 文件',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  })
  if (!r?.length) return { canceled: true }
  const files = r
    .map((p) => {
      const content = readMd(p)
      return content == null ? null : { title: titleFromFilename(path.basename(p)), content }
    })
    .filter((x): x is MdImportFile => x != null)
  return { files }
}

function pickFolder(): MdImportResult {
  // e2e 钩子：同上，目录模式直接递归扫描
  if (!app.isPackaged && process.env.MYDASH_IMPORT_FIXTURE) {
    const sub = walkDir(process.env.MYDASH_IMPORT_FIXTURE, '导入')
    return { tree: sub?.children ?? [] }
  }

  const r = dialog.showOpenDialogSync({
    title: '导入 Markdown 文件夹（递归，子目录转为文件夹）',
    properties: ['openDirectory']
  })
  if (!r?.length) return { canceled: true }
  const root = walkDir(r[0], titleFromFilename(path.basename(r[0])))
  return { tree: root?.children ?? [] }
}

export function registerNotesImportIpc(): void {
  ipcMain.handle('notes:import-pick', (_e, mode: 'files' | 'folder'): MdImportResult => {
    try {
      return mode === 'folder' ? pickFolder() : pickFiles()
    } catch (err) {
      console.error('[notes-import] 读取失败:', err)
      return { files: [] }
    }
  })
}

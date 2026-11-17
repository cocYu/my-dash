// 插件管理器：目录扫描、manifest 校验、启停状态、zip 导入、KV 存储、IPC 装配。
// 插件 = 一个目录：plugin.json（清单）+ main 指定的 ESM 入口。
// 数据落点：userData/plugins/（已安装）、userData/plugins/data/<id>.json（KV）。
// dev 额外扫描仓库 plugins-dev/ 目录，便于开发调试。
import { app, ipcMain, protocol, shell } from 'electron'
import AdmZip from 'adm-zip'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  main: string
  permissions?: string[]
  icon?: string
}

export interface PluginRecord {
  manifest: PluginManifest
  /** 插件目录绝对路径 */
  dir: string
  /** 来源：dev=仓库 plugins-dev（开发），user=正式安装 */
  source: 'dev' | 'user'
  enabled: boolean
  /** 扫描/校验失败原因（非空表示插件不可用） */
  error?: string
}

interface InstalledState {
  /** pluginId -> { enabled }（持久化的启停状态） */
  [id: string]: { enabled: boolean; installedAt: string }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/
const MANIFEST_NAME = 'plugin.json'

let records: PluginRecord[] = []
let installed: InstalledState = {}

function userPluginsDir(): string {
  return path.join(app.getPath('userData'), 'plugins')
}
function kvDir(): string {
  return path.join(userPluginsDir(), 'data')
}

/** 备份/还原需要用到插件目录与 KV 目录（sync/service 使用） */
export function pluginStorageDirs(): { plugins: string; kv: string } {
  return { plugins: userPluginsDir(), kv: kvDir() }
}

/** 外部变更（如数据还原）落地后强制重扫插件 */
export function refreshManager(): void {
  rescan()
}
function stateFile(): string {
  return path.join(userPluginsDir(), 'installed.json')
}
function devPluginsDir(): string {
  return path.join(app.getAppPath(), 'plugins-dev')
}

// ---------------- 状态持久化 ----------------
function loadState(): void {
  try {
    installed = JSON.parse(fs.readFileSync(stateFile(), 'utf-8'))
  } catch {
    installed = {}
  }
}

function saveState(): void {
  fs.mkdirSync(userPluginsDir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(installed, null, 2))
}

// ---------------- 扫描与校验 ----------------
function validateManifest(raw: unknown, source: string): PluginManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('plugin.json 不是对象')
  const m = raw as Record<string, unknown>
  const id = String(m.id ?? '')
  if (!ID_PATTERN.test(id)) throw new Error(`非法的插件 id: "${id}"（需匹配 ${ID_PATTERN.source}）`)
  if (typeof m.name !== 'string' || !m.name) throw new Error('缺少 name')
  if (typeof m.version !== 'string' || !m.version) throw new Error('缺少 version')
  if (typeof m.main !== 'string' || !m.main) throw new Error('缺少 main（ESM 入口）')
  const entry = path.join(source, m.main)
  if (!fs.existsSync(entry)) throw new Error(`入口文件不存在: ${m.main}`)
  return {
    id,
    name: m.name,
    version: m.version,
    description: typeof m.description === 'string' ? m.description : undefined,
    main: m.main,
    permissions: Array.isArray(m.permissions) ? m.permissions.map(String) : [],
    icon: typeof m.icon === 'string' ? m.icon : undefined
  }
}

function scanOneDir(baseDir: string, source: PluginRecord['source']): PluginRecord[] {
  const out: PluginRecord[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return out // 目录不存在：正常（用户还没装任何插件）
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = path.join(baseDir, ent.name)
    const manifestPath = path.join(dir, MANIFEST_NAME)
    if (!fs.existsSync(manifestPath)) continue // 无清单的目录（如 KV 数据目录）不是插件，静默跳过
    try {
      const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')), dir)
      out.push({
        manifest,
        dir,
        source,
        enabled: installed[manifest.id]?.enabled ?? true
      })
    } catch (err) {
      // 有清单但无效的插件不中断扫描，标记错误供管理页展示
      out.push({
        manifest: { id: ent.name, name: ent.name, version: '-', main: '' },
        dir,
        source,
        enabled: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
  return out
}

function rescan(): void {
  loadState()
  const found = [
    ...scanOneDir(devPluginsDir(), 'dev'),
    ...scanOneDir(userPluginsDir(), 'user')
  ]
  // 同 id 去重：dev 优先（开发期以仓库版本为准），管理页可感知
  const byId = new Map<string, PluginRecord>()
  for (const rec of found) {
    if (rec.error) continue // 错误记录不去重，全部保留展示
    const prev = byId.get(rec.manifest.id)
    byId.set(rec.manifest.id, rec)
    if (prev) {
      rec.enabled = prev.enabled || rec.enabled
    }
  }
  const errors = found.filter((r) => r.error)
  records = [...byId.values(), ...errors]
}

function getRecord(id: string): PluginRecord | undefined {
  return records.find((r) => !r.error && r.manifest.id === id)
}

/** 卸载已安装插件：删目录、注册状态与 KV 数据。dev 源插件在仓库内，不可卸载。 */
function uninstallPlugin(id: string): void {
  const rec = getRecord(id)
  if (!rec) throw new Error(`插件不存在: ${id}`)
  if (rec.source === 'dev') {
    throw new Error('开发中的插件位于 plugins-dev 目录，请直接从仓库移除')
  }
  fs.rmSync(rec.dir, { recursive: true, force: true })
  fs.rmSync(path.join(kvDir(), `${id}.json`), { force: true })
  kvCache.delete(id)
  delete installed[id]
  saveState()
  rescan()
}

// ---------------- zip 导入 ----------------
/** 在 zip 条目里定位 plugin.json，返回 { base, manifestText }。base 为空串表示根目录。 */
function locateManifest(zip: AdmZip): { base: string; manifestText: string } {
  const entries = zip.getEntries()
  const candidates = entries.filter((e) => !e.isDirectory && e.entryName.endsWith(MANIFEST_NAME))
  const rootEntry = candidates.find((e) => e.entryName === MANIFEST_NAME)
  const oneDeep = candidates.find((e) => /^[^/]+\/plugin\.json$/.test(e.entryName))
  const target = rootEntry ?? oneDeep
  if (!target) throw new Error('压缩包中未找到 plugin.json')
  const base = rootEntry === target ? '' : target.entryName.slice(0, -MANIFEST_NAME.length)
  return { base, manifestText: target.getData().toString('utf-8') }
}

async function importZipBuffer(data: Buffer): Promise<PluginManifest> {
  const zip = new AdmZip(data)
  const { base, manifestText } = locateManifest(zip)

  // 先快速结构化解析拿 id（完整校验在解压后做，因为要检查入口文件存在性）
  const rough = JSON.parse(manifestText) as { id?: unknown }
  const roughId = String(rough.id ?? '')
  if (!ID_PATTERN.test(roughId)) throw new Error(`非法的插件 id: "${roughId}"`)

  const target = path.join(userPluginsDir(), roughId)
  if (fs.existsSync(target)) throw new Error(`插件 ${roughId} 已存在（先卸载或改名后再导入）`)

  const staging = path.join(userPluginsDir(), `.staging-${roughId}-${Date.now()}`)
  try {
    // 防 zip slip：只取 base 子树，且每个条目解压后必须落在暂存目录内
    const resolvedStaging = path.resolve(staging)
    const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.startsWith(base))
    for (const entry of entries) {
      const dest = path.resolve(staging, entry.entryName.slice(base.length))
      if (dest !== resolvedStaging && !dest.startsWith(resolvedStaging + path.sep)) {
        throw new Error(`检测到非法路径: ${entry.entryName}`)
      }
    }

    // 解压到暂存目录，再做完整校验（含 main 入口存在性）
    fs.mkdirSync(staging, { recursive: true })
    for (const entry of entries) {
      const dest = path.resolve(staging, entry.entryName.slice(base.length))
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, entry.getData())
    }
    const manifest = validateManifest(JSON.parse(manifestText), staging)

    fs.renameSync(staging, target) // 校验通过，落位
    installed[manifest.id] = { enabled: true, installedAt: new Date().toISOString() }
    saveState()
    rescan()
    return manifest
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true }) // 失败清理
    throw err
  }
}

// ---------------- KV 存储 ----------------
const kvCache = new Map<string, Record<string, unknown>>()

function readKv(pluginId: string): Record<string, unknown> {
  const cached = kvCache.get(pluginId)
  if (cached) return cached
  let obj: Record<string, unknown> = {}
  try {
    obj = JSON.parse(fs.readFileSync(path.join(kvDir(), `${pluginId}.json`), 'utf-8'))
  } catch {
    // 无文件/损坏：从空开始
  }
  kvCache.set(pluginId, obj)
  return obj
}

function writeKv(pluginId: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(kvDir(), { recursive: true })
  const file = path.join(kvDir(), `${pluginId}.json`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, file) // 原子替换
}

// ---------------- 协议 handler ----------------
const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export function registerPluginProtocol(): void {
  protocol.handle('plugin', (request) => {
    const url = new URL(request.url)
    const rec = getRecord(url.hostname)
    if (!rec) return new Response('plugin not found', { status: 404 })

    const rel = decodeURIComponent(url.pathname).replace(/^\//, '')
    const file = path.resolve(rec.dir, rel)
    if (!file.startsWith(path.resolve(rec.dir) + path.sep)) {
      return new Response('forbidden', { status: 403 })
    }
    return fsp
      .readFile(file)
      .then(
        (buf) =>
          new Response(new Uint8Array(buf), {
            headers: {
              'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
              'Access-Control-Allow-Origin': '*' // ESM 跨源 import 必需
            }
          })
      )
      .catch(() => new Response('not found', { status: 404 }))
  })
}

// ---------------- IPC 装配 ----------------
function toSerializable(rec: PluginRecord) {
  return {
    id: rec.manifest.id,
    name: rec.manifest.name,
    version: rec.manifest.version,
    description: rec.manifest.description,
    main: rec.manifest.main,
    permissions: rec.manifest.permissions ?? [],
    source: rec.source,
    enabled: rec.enabled,
    error: rec.error
  }
}

export function registerPluginIpc(): void {
  ipcMain.handle('plugins:list', () => records.map(toSerializable))

  ipcMain.handle('plugins:set-enabled', (_e, id: string, enabled: boolean) => {
    const rec = getRecord(id)
    if (!rec) throw new Error(`插件不存在: ${id}`)
    installed[id] = installed[id] ?? { enabled, installedAt: new Date().toISOString() }
    installed[id].enabled = enabled
    saveState()
    rescan()
    return records.map(toSerializable)
  })

  ipcMain.handle('plugins:import', async (_e, data: ArrayBuffer) => {
    const manifest = await importZipBuffer(Buffer.from(data))
    return { id: manifest.id, name: manifest.name }
  })

  ipcMain.handle('plugins:uninstall', (_e, id: string) => {
    uninstallPlugin(id)
    return records.map(toSerializable)
  })

  ipcMain.handle('plugins:open-dir', async () => {
    fs.mkdirSync(userPluginsDir(), { recursive: true })
    await shell.openPath(userPluginsDir())
  })

  ipcMain.handle(
    'plugins:kv',
    (_e, payload: { pluginId: string; op: 'get' | 'set' | 'remove' | 'keys'; key?: string; value?: unknown }) => {
      const { pluginId, op, key, value } = payload
      if (!getRecord(pluginId)) throw new Error(`插件不存在: ${pluginId}`)
      const obj = readKv(pluginId)
      switch (op) {
        case 'get':
          return key && key in obj ? obj[key] : null
        case 'set':
          if (!key) throw new Error('缺少 key')
          obj[key] = value ?? null
          writeKv(pluginId, obj)
          return true
        case 'remove':
          if (key) delete obj[key]
          writeKv(pluginId, obj)
          return true
        case 'keys':
          return Object.keys(obj)
        default:
          throw new Error(`未知操作: ${op as string}`)
      }
    }
  )
}

/** 应用启动时调用一次：读状态 + 首次扫描 */
export function initPluginManager(): void {
  fs.mkdirSync(userPluginsDir(), { recursive: true })
  loadState()
  rescan()
}

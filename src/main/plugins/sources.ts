// 插件源配置：一个源 = 一份 registry.json 索引地址（可带备用地址）。
// 落点 userData/plugin-sources.json；插件市场按顺序聚合所有「启用」的源。
// 首次运行写入内置官方源；环境变量 MYDASH_TOOLS_REGISTRY（逗号分隔）可整体替换内置源。
import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface PluginSource {
  /** 源标识（稳定不变，用于「测试单个源」等操作） */
  id: string
  name: string
  /** 索引主地址（registry.json） */
  url: string
  /** 同一索引的备用地址：主地址失败时依次尝试 */
  mirrors: string[]
  enabled: boolean
  /** 内置源标记（仅展示用，用户仍可编辑/删除） */
  builtin?: boolean
}

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/
const MAX_SOURCES = 20
const MAX_MIRRORS = 5
const MAX_NAME = 40

/** 官方插件中心：主源 Gitee raw，备用 GitHub raw 与 jsDelivr。
 *  jsDelivr 放最后：它对 @main 有 12h 边缘缓存（purge 也不保证立刻生效），
 *  排在 raw 前面时可能用「旧索引」挡住后面的新索引，导致 sha256 校验失败。 */
const OFFICIAL: PluginSource[] = [
  {
    id: 'official',
    name: 'AtoZ 插件中心',
    url: 'https://gitee.com/yukai1998/my-dash-plugins/raw/main/registry.json',
    mirrors: [
      'https://raw.githubusercontent.com/cocYu/my-dash-plugins/main/registry.json',
      'https://cdn.jsdelivr.net/gh/cocYu/my-dash-plugins@main/registry.json'
    ],
    enabled: true,
    builtin: true
  }
]

let cache: PluginSource[] | null = null

function sourcesFile(): string {
  return path.join(app.getPath('userData'), 'plugin-sources.json')
}

function clone(list: PluginSource[]): PluginSource[] {
  return list.map((s) => ({ ...s, mirrors: [...s.mirrors] }))
}

/** 首次运行 / 恢复默认时使用的种子数据 */
function seed(): PluginSource[] {
  const env = (process.env.MYDASH_TOOLS_REGISTRY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (env.length) {
    return [
      {
        id: 'env',
        name: '自定义索引（环境变量）',
        url: env[0],
        mirrors: env.slice(1, 1 + MAX_MIRRORS),
        enabled: true
      }
    ]
  }
  return clone(OFFICIAL)
}

function httpUrl(raw: unknown, field: string): string {
  const url = String(raw ?? '').trim()
  if (!url) throw new Error(`${field}不能为空`)
  if (!/^https?:\/\//i.test(url)) throw new Error(`${field}需以 http(s):// 开头`)
  if (url.length > 512) throw new Error(`${field}过长`)
  return url
}

/** 校验并规范化整份配置；任何一条不合法都整体拒绝，避免半份配置落盘 */
function sanitize(input: unknown): PluginSource[] {
  if (!Array.isArray(input)) throw new Error('插件源配置格式错误：应为数组')
  if (input.length > MAX_SOURCES) throw new Error(`插件源最多 ${MAX_SOURCES} 个`)
  const seen = new Set<string>()
  return input.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`第 ${i + 1} 个插件源格式错误`)
    const r = raw as Record<string, unknown>
    const name = String(r.name ?? '').trim()
    if (!name) throw new Error(`第 ${i + 1} 个插件源缺少名称`)
    const id = String(r.id ?? '').trim()
    if (!SOURCE_ID.test(id)) throw new Error(`插件源 id 非法："${id}"（需匹配 ${SOURCE_ID.source}）`)
    if (seen.has(id)) throw new Error(`插件源 id 重复：${id}`)
    seen.add(id)
    const mirrors = Array.isArray(r.mirrors)
      ? r.mirrors.map((m, j) => httpUrl(m, `第 ${j + 1} 个备用地址`))
      : []
    if (mirrors.length > MAX_MIRRORS) throw new Error(`备用地址最多 ${MAX_MIRRORS} 个`)
    const out: PluginSource = {
      id,
      name: name.slice(0, MAX_NAME),
      url: httpUrl(r.url, '索引地址'),
      mirrors,
      enabled: r.enabled !== false
    }
    if (r.builtin === true) out.builtin = true
    return out
  })
}

function persist(list: PluginSource[]): void {
  const file = sourcesFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, sources: list }, null, 2))
  fs.renameSync(tmp, file) // 原子替换，避免写一半被杀进程
}

/** 读取插件源（首次运行或文件损坏时回落到默认源并落盘） */
export function listSources(): PluginSource[] {
  if (cache) return clone(cache)
  try {
    const parsed = JSON.parse(fs.readFileSync(sourcesFile(), 'utf-8')) as { sources?: unknown }
    cache = sanitize(parsed.sources)
  } catch (err) {
    // 文件不存在属正常；损坏时保留一份 .bak 便于排查，再用默认配置恢复
    if (fs.existsSync(sourcesFile())) {
      try {
        fs.copyFileSync(sourcesFile(), `${sourcesFile()}.bak`)
      } catch {
        /* 备份失败不阻塞 */
      }
      console.warn('[plugins] 插件源配置无法解析，已回落到默认源：', err)
    }
    cache = seed()
    persist(cache)
  }
  return clone(cache)
}

export function saveSources(input: unknown): PluginSource[] {
  cache = sanitize(input)
  persist(cache)
  return clone(cache)
}

export function resetSources(): PluginSource[] {
  cache = seed()
  persist(cache)
  return clone(cache)
}

export function registerPluginSourceIpc(): void {
  ipcMain.handle('plugins:sources:list', () => listSources())
  ipcMain.handle('plugins:sources:save', (_e, list: unknown) => saveSources(list))
  ipcMain.handle('plugins:sources:reset', () => resetSources())
}

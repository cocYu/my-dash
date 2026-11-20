#!/usr/bin/env node
/**
 * 工具仓库打包器：扫描插件目录 → 校验清单 → 打 zip → 算 sha256 → 生成 registry.json。
 *
 * 用法：
 *   node scripts/tools/build-tools.mjs \
 *     --src plugins-dev --out dist-tools \
 *     --tag tools/v0.1.0 \
 *     --github-repo cocYu/my-dash --gitee-repo yukai1998/my-dash
 *
 * 本地验证（不发布到 Release，直接用本地静态服务）：
 *   node scripts/tools/build-tools.mjs --src plugins-dev --out dist-tools \
 *     --base-url http://127.0.0.1:8099
 *
 * 参数：
 *   --src <dir>          插件根目录（每个子目录一个插件），默认 plugins-dev
 *   --out <dir>          输出目录，默认 dist-tools
 *   --tag <tag>          发布标签（工具仓库用 tools/vX.Y.Z），用于拼 Release 下载地址
 *   --github-repo <o/r>  GitHub 仓库（主下载源）
 *   --gitee-repo <o/r>   Gitee 仓库（镜像下载源）
 *   --primary <gitee|github>  首选下载源，默认 gitee（境内直连快），另一侧作镜像
 *   --base-url <url>     不使用 Release 时的下载前缀（本地/自建服务器）
 *   --only <ids>         只处理指定插件（逗号分隔）
 *   --check              只做校验，不产出文件
 *   --registry <path>    索引输出路径，默认 <out>/registry.json
 *
 * 产物：
 *   <out>/<id>-<version>.zip  每个插件一个包，plugin.json 位于包根目录
 *   <out>/registry.json          应用读取的索引（含 sha256 与镜像地址）
 *   <out>/release-notes.md       发布说明（CI 用作 Release 正文）
 *
 * 可复现：zip 内条目的时间戳被固定为常量，同样的源文件两次打包 sha256 一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', '.idea', '.vscode'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const MAX_PLUGIN_BYTES = 10 * 1024 * 1024
/** 固定 zip 内时间戳，保证同源文件产出相同 sha256（1980-01-01 是 zip 纪元零点） */
const FIXED_DATE = new Date('1980-01-01T00:00:00Z')

function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) return ''
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? '' : v
}
const hasFlag = (name) => process.argv.includes(name)

const srcDir = path.resolve(root, argValue('--src') || 'plugins-dev')
const outDir = path.resolve(root, argValue('--out') || 'dist-tools')
const tag = argValue('--tag')
const githubRepo = argValue('--github-repo')
const giteeRepo = argValue('--gitee-repo')
const baseUrl = argValue('--base-url').replace(/\/+$/, '')
/** 首选下载源：gitee（默认，境内快）| github */
const primary = (argValue('--primary') || 'gitee').toLowerCase()
const only = new Set(
  (argValue('--only') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)
const checkOnly = hasFlag('--check')
const registryPath = path.resolve(root, argValue('--registry') || path.join(path.relative(root, outDir), 'registry.json'))

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function log(message) {
  console.log(`[tools] ${message}`)
}

/** 递归收集插件文件，返回 posix 相对路径列表（排序保证打包稳定） */
function collectFiles(dir, base = dir, acc = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name)
    const st = fs.lstatSync(abs)
    if (st.isSymbolicLink()) throw new Error(`不允许符号链接：${path.relative(base, abs)}`)
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      collectFiles(abs, base, acc)
      continue
    }
    if (!st.isFile() || SKIP_FILES.has(name)) continue
    acc.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/'), size: st.size })
  }
  return acc
}

function readManifest(dir) {
  const file = path.join(dir, 'plugin.json')
  if (!fs.existsSync(file)) throw new Error('缺少 plugin.json')
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    throw new Error(`plugin.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`)
  }
  const id = String(raw.id ?? '')
  if (!ID_PATTERN.test(id)) throw new Error(`id 非法（需 ${ID_PATTERN.source}）："${id}"`)
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('缺少 name')
  const version = String(raw.version ?? '')
  if (!VERSION_PATTERN.test(version)) throw new Error(`version 需形如 1.2.3："${version}"`)
  if (typeof raw.main !== 'string' || !raw.main.trim()) throw new Error('缺少 main')
  const entry = path.join(dir, raw.main)
  if (!fs.existsSync(entry) || !fs.statSync(entry).isFile()) throw new Error(`入口文件不存在：${raw.main}`)
  return {
    id,
    name: raw.name.trim(),
    version,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : '其他',
    main: raw.main,
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : []
  }
}

function packagePlugin(manifest, files) {
  const zip = new AdmZip()
  for (const f of files) {
    const entry = zip.addFile(f.rel, fs.readFileSync(f.abs))
    // 固定时间戳（adm-zip 会同时写 dosTime 与时间字段）
    entry.header.time = FIXED_DATE
  }
  return zip.toBuffer()
}

function buildDownloadUrls(fileName) {
  const gh = githubRepo && tag ? `https://github.com/${githubRepo}/releases/download/${tag}/${fileName}` : ''
  const ge = giteeRepo && tag ? `https://gitee.com/${giteeRepo}/releases/download/${tag}/${fileName}` : ''
  if (baseUrl) {
    // 本地/自建服务器：base-url 作主地址，Release 地址留作镜像
    return { url: `${baseUrl}/${fileName}`, mirrors: [gh, ge].filter(Boolean) }
  }
  // 默认 Gitee 优先（境内直连快），GitHub 作镜像；可用 --primary github 反过来
  const order = primary === 'github' ? [gh, ge] : [ge, gh]
  const list = order.filter(Boolean)
  if (!list.length) fail('需要 --github-repo/--gitee-repo + --tag，或 --base-url 来生成下载地址')
  return { url: list[0], mirrors: list.slice(1) }
}

function main() {
  if (!fs.existsSync(srcDir)) fail(`插件目录不存在：${srcDir}`)
  const dirs = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((name) => !only.size || only.has(name))
    .sort()
  if (!dirs.length) fail(`没有找到插件（${srcDir}）`)

  if (!checkOnly) fs.mkdirSync(outDir, { recursive: true })

  const built = []
  const problems = []
  for (const name of dirs) {
    const dir = path.join(srcDir, name)
    try {
      const manifest = readManifest(dir)
      const files = collectFiles(dir)
      const total = files.reduce((n, f) => n + f.size, 0)
      if (total > MAX_PLUGIN_BYTES) {
        throw new Error(`插件体积 ${(total / 1024 / 1024).toFixed(1)}MB 超过 10MB 上限`)
      }
      if (!files.some((f) => f.rel === 'plugin.json')) throw new Error('plugin.json 未包含在打包列表')
      const fileName = `${manifest.id}-${manifest.version}.zip`
      if (checkOnly) {
        log(`✓ ${manifest.id} v${manifest.version}（${files.length} 个文件，${(total / 1024).toFixed(1)}KB）`)
        built.push({ manifest, fileName, files: files.length })
        continue
      }
      const buf = packagePlugin(manifest, files)
      fs.writeFileSync(path.join(outDir, fileName), buf)
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
      const { url, mirrors } = buildDownloadUrls(fileName)
      built.push({
        manifest,
        fileName,
        sha256,
        size: buf.length,
        url,
        mirrors,
        files: files.length
      })
      log(`✓ ${manifest.id} v${manifest.version} → ${fileName}（${(buf.length / 1024).toFixed(1)}KB，sha256 ${sha256.slice(0, 12)}…）`)
    } catch (err) {
      problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`✖ ${p}`)
    fail(`${problems.length} 个插件校验失败，已中止`)
  }
  if (checkOnly) {
    log(`校验通过：${built.length} 个插件`)
    return
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })

  const registry = built
    .map((b) => ({
      id: b.manifest.id,
      name: b.manifest.name,
      version: b.manifest.version,
      description: b.manifest.description || undefined,
      category: b.manifest.category,
      downloadUrl: b.url,
      ...(b.mirrors.length ? { mirrors: b.mirrors } : {}),
      sha256: b.sha256,
      size: b.size
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
  log(`索引已写入 ${path.relative(root, registryPath)}（${registry.length} 条）`)

  // 发布说明：CI 直接作为 Release 正文
  const lines = [
    `# 工具仓库 ${tag || '(本地构建)'}`,
    '',
    '| 工具 | 版本 | 大小 | 说明 |',
    '| --- | --- | --- | --- |',
    ...registry.map(
      (r) => `| \`${r.id}\` · ${r.name} | ${r.version} | ${(r.size / 1024).toFixed(0)} KB | ${r.description || '—'} |`
    ),
    '',
    `共 ${registry.length} 个工具。安装：AtoZ → 工具箱 → 获取工具。`
  ]
  fs.writeFileSync(path.join(outDir, 'release-notes.md'), `${lines.join('\n')}\n`)
  log(`完成：${built.length} 个工具包 → ${path.relative(root, outDir)}/`)
}

main()

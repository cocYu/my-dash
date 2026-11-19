/**
 * 三端发行构建 + 发布到 Gitee Release。
 *
 * GitHub Actions（.github/workflows/release.yml）里分两段用：
 *   build 任务：--platform windows|macos|linux --no-publish
 *   publish 任务：--platform all --publish-only（产物已下载到 MYDASH_CI_OUT）
 *
 * 本地手动构建（在对应系统上执行）：
 *   node scripts/ci/build-and-publish.mjs --platform windows
 *   node scripts/ci/build-and-publish.mjs --platform macos
 *   node scripts/ci/build-and-publish.mjs --platform linux
 *
 * 只构建不发布：追加 --no-publish
 * 版本号默认取当前 tag（release/1.2.3 -> 1.2.3），也可用 RELEASE_TAG 覆盖。
 *
 * 需要环境变量：
 *   GITEE_TOKEN        必填（发布时），Gitee 私人令牌，勾选 projects 权限
 *   GITEE_OWNER        默认 yukai1998
 *   GITEE_REPO         默认 my-dash
 *   GITEE_MAX_ASSET_MB 单个附件上限，默认 95（Gitee 普通仓库单文件 100MB）
 *   GITEE_BRANCH       创建 Release 时关联的分支，默认 main
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/ci/ 的上两级才是仓库根目录
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const platform = (argValue('--platform') || '').toLowerCase()
const shouldPublish = !args.includes('--no-publish')
const skipInstall = args.includes('--skip-install')
const dryRun = args.includes('--dry-run')
// 只重试发布（构建产物已存在时用），会跳过 npm/后端/electron-builder
const publishOnly = args.includes('--publish-only')

function argValue(name) {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

function fail(message) {
  console.error(`[ci] ${message}`)
  process.exit(1)
}

function log(message) {
  console.log(`[ci] ${message}`)
}

function run(cmd, cmdArgs, options = {}) {
  log(`$ ${cmd} ${cmdArgs.join(' ')}`)
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/i.test(cmd),
    ...options
  })
  if (result.error || result.status !== 0) {
    fail(`命令失败：${cmd} ${cmdArgs.join(' ')}`)
  }
}

function git(gitArgs) {
  const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) return ''
  return (result.stdout || '').trim()
}

// ---- 平台与目标 ----

const PLATFORMS = {
  windows: {
    electronFlag: '--win',
    backendOs: 'windows',
    backendArch: 'x64',
    artifactPattern: /\.exe$/i
  },
  linux: {
    electronFlag: '--linux',
    backendOs: 'linux',
    backendArch: 'x64',
    artifactPattern: /\.(AppImage|deb)$/i
  },
  macos: {
    electronFlag: '--mac',
    backendOs: 'darwin',
    backendArch: 'universal',
    artifactPattern: /\.(dmg|zip)$/i
  },
  // 汇总发布：只用于 --publish-only，把三端产物放在同一个目录里一起上传
  all: {
    artifactPattern: /\.(exe|dmg|zip|AppImage|deb)$/i,
    publishOnly: true
  }
}

if (!PLATFORMS[platform]) {
  fail('缺少或无效的 --platform，可选 windows / macos / linux')
}
const target = PLATFORMS[platform]

if (target.publishOnly && !publishOnly) {
  fail('--platform all 只能配合 --publish-only 使用（不执行构建，只汇总上传已有产物）')
}

// ---- 版本 ----

function resolveVersion() {
  let tag = process.env.RELEASE_TAG || process.env.GITEE_TAG || ''
  if (!tag) {
    git(['fetch', '--tags', '--force', '--depth=1'])
    tag = git(['describe', '--tags', '--exact-match', 'HEAD'])
  }
  if (!tag) fail('无法确定 tag：请在 tag 触发的流水线中运行，或设置 RELEASE_TAG=release/x.y.z')
  if (!tag.startsWith('release/')) fail(`tag 必须以 release/ 开头，当前为 ${tag}`)

  const version = tag.slice('release/'.length).replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`版本号不合法：${version}（示例：release/0.2.0 或 release/0.2.0-beta.1）`)
  }
  return { tag, version }
}

const { tag, version } = resolveVersion()
log(`平台=${platform} tag=${tag} version=${version}`)

// ---- 构建 ----

function setPackageVersion() {
  // npm version 会改写 package.json（不提交、不打 tag），让产物名带上版本号
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'version',
    version,
    '--no-git-tag-version',
    '--allow-same-version'
  ])
}

function buildBackend() {
  if (target.backendArch !== 'universal') {
    run(process.execPath, [
      'scripts/build-backend.mjs',
      'release',
      '--os',
      target.backendOs,
      '--arch',
      target.backendArch
    ])
    return
  }

  // macOS：分别编译 x64 / arm64，再用 lipo 合成通用二进制，供两种架构的 dmg 共用
  const binDir = path.join(root, 'backend', 'bin', 'mac')
  const tmp = path.join(binDir, '.universal')
  fs.mkdirSync(tmp, { recursive: true })

  for (const arch of ['x64', 'arm64']) {
    run(process.execPath, ['scripts/build-backend.mjs', 'release', '--os', 'darwin', '--arch', arch])
    fs.copyFileSync(path.join(binDir, 'backend'), path.join(tmp, `backend-${arch}`))
  }

  run('lipo', [
    '-create',
    path.join(tmp, 'backend-x64'),
    path.join(tmp, 'backend-arm64'),
    '-output',
    path.join(binDir, 'backend')
  ])
  fs.rmSync(tmp, { recursive: true, force: true })
}

function buildFrontend() {
  // CI 是干净检出，out/ 不存在；必须显式构建，否则 electron-builder 打包出空 asar
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  run(npx, ['--no-install', 'electron-vite', 'build'])
}

function buildApp() {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  // 只传平台参数，目标与架构交给 electron-builder.yml
  // （命令行里写 `--mac dmg zip` 会忽略配置中的 arch 列表，导致只出当前架构）
  const electronArgs = [target.electronFlag, '--publish', 'never']
  // 本地验证时可用 MYDASH_CI_OUT 指定输出目录，避免覆盖正式 dist
  const outDir = process.env.MYDASH_CI_OUT
  if (outDir) electronArgs.push(`-c.directories.output=${outDir}`)
  run(npx, ['--no-install', 'electron-builder', ...electronArgs])
}

function installDeps() {
  if (skipInstall) {
    log('已指定 --skip-install，跳过依赖安装')
    return
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  if (fs.existsSync(path.join(root, 'package-lock.json'))) {
    // 构建机可能设置了 NODE_ENV=production，显式带上 devDependencies（electron-builder 在 devDeps）
    run(npm, ['ci', '--include=dev', '--no-audit', '--no-fund'])
  } else {
    run(npm, ['install', '--include=dev', '--no-audit', '--no-fund'])
  }
}

function distDir() {
  // 用 resolve 而不是 join：CI 里给相对目录（dist-publish），本地测试也支持绝对路径
  return path.resolve(root, process.env.MYDASH_CI_OUT || 'dist')
}

// ---- 产物与分卷 ----

function collectArtifacts() {
  const dir = distDir()
  if (!fs.existsSync(dir)) fail(`未找到产物目录：${dir}`)
  return fs
    .readdirSync(dir)
    .filter((name) => target.artifactPattern.test(name))
    .filter((name) => !/\.blockmap$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort()
}

/** 超过单附件上限时按上限切分，返回实际要上传的文件列表 */
function splitIfNeeded(file, limitBytes) {
  const size = fs.statSync(file).size
  if (size <= limitBytes) return [file]

  const fd = fs.openSync(file, 'r')
  const parts = []
  try {
    let index = 1
    let position = 0
    while (position < size) {
      const length = Math.min(limitBytes, size - position)
      const buffer = Buffer.allocUnsafe(length)
      fs.readSync(fd, buffer, 0, length, position)
      const partPath = `${file}.part${index}`
      fs.writeFileSync(partPath, buffer)
      parts.push(partPath)
      position += length
      index += 1
    }
  } finally {
    fs.closeSync(fd)
  }
  log(`附件超过 ${Math.round(limitBytes / 1024 / 1024)}MB，已分卷：${path.basename(file)} -> ${parts.length} 卷`)
  return parts
}

// ---- Gitee Release ----

// 私有化/测试时可覆盖 API 地址
const API = process.env.GITEE_API_BASE || 'https://gitee.com/api/v5'
const owner = process.env.GITEE_OWNER || 'yukai1998'
const repo = process.env.GITEE_REPO || 'my-dash'
const token = process.env.GITEE_TOKEN || ''
const maxAssetBytes = Number(process.env.GITEE_MAX_ASSET_MB || 95) * 1024 * 1024

function releaseBody() {
  const message = process.env.GITEE_COMMIT_MESSAGE || ''
  return [
    `## AtoZ ${version}`,
    '',
    message ? `> ${message}` : '',
    '',
    '### 下载说明',
    `- Windows：\`AtoZ-${version}-win-x64-setup.exe\``,
    `- macOS：\`AtoZ-${version}-mac-x64.dmg\` / \`AtoZ-${version}-mac-arm64.dmg\``,
    `- Linux：\`AtoZ-${version}-linux-x86_64.AppImage\` / \`AtoZ-${version}-linux-amd64.deb\``,
    '',
    '### 分卷附件',
    '受 Gitee 单附件 100MB 限制，超过上限的文件会拆成 `.part1`、`.part2` 分卷。',
    '全部下载后合并（顺序不能乱）：',
    '',
    '- Windows（cmd）：`copy /b 文件名.part1 + 文件名.part2 文件名`',
    '- macOS / Linux：`cat 文件名.part* > 文件名`',
    '',
    '合并后 Windows 安装包需要与原名一致（以 .exe 结尾）才能运行。'
  ]
    .join('\n')
    .trim()
}

async function apiFetch(pathname, init = {}) {
  const url = `${API}${pathname}`
  const res = await fetch(url, init)
  return res
}

async function findRelease() {
  const res = await apiFetch(
    `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}?access_token=${encodeURIComponent(token)}`
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`查询 Release 失败：HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function createRelease() {
  const res = await apiFetch(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      tag_name: tag,
      name: `AtoZ ${version}`,
      body: releaseBody(),
      target_commitish: process.env.GITEE_BRANCH || 'main',
      prerelease: version.includes('-')
    })
  })
  if (res.ok) return res.json()

  const text = await res.text()
  // 并发/重复执行时可能已被其他平台创建，再查一次
  const existing = await findRelease()
  if (existing) return existing
  throw new Error(`创建 Release 失败：HTTP ${res.status} ${text}`)
}

async function ensureRelease() {
  return (await findRelease()) || (await createRelease())
}

function existingAssetNames(release) {
  const assets = Array.isArray(release.assets) ? release.assets : []
  return new Set(assets.map((a) => a.name || a.attach_file_name).filter(Boolean))
}

async function uploadAsset(releaseId, filePath) {
  const name = path.basename(filePath)
  const buffer = fs.readFileSync(filePath)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const form = new FormData()
      form.append('access_token', token)
      form.append('file', new Blob([buffer]), name)
      const res = await fetch(`${API}/repos/${owner}/${repo}/releases/${releaseId}/attach_files`, {
        method: 'POST',
        body: form
      })
      if (res.ok) {
        log(`已上传 ${name}（${(buffer.length / 1024 / 1024).toFixed(1)}MB）`)
        return
      }
      const text = await res.text()
      if (res.status === 400 && /已存在|exist/i.test(text)) {
        log(`跳过已存在的附件 ${name}`)
        return
      }
      throw new Error(`HTTP ${res.status} ${text}`)
    } catch (err) {
      if (attempt === 3) throw err
      log(`上传 ${name} 失败（第 ${attempt} 次），重试…`)
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
}

async function publish(files) {
  if (!shouldPublish) {
    log('已指定 --no-publish，跳过发布')
    return
  }

  if (dryRun) {
    log(`[dry-run] 目标 Release：${owner}/${repo} @ ${tag}`)
    for (const file of files) {
      const size = fs.statSync(file).size
      const parts = Math.max(1, Math.ceil(size / maxAssetBytes))
      log(`[dry-run] ${path.basename(file)} ${(size / 1024 / 1024).toFixed(1)}MB -> ${parts} 个附件`)
    }
    return
  }

  if (!token) fail('缺少 GITEE_TOKEN，无法发布（可加 --no-publish 只构建）')

  const release = await ensureRelease()
  log(`Release: ${release.html_url || `${tag} (#${release.id})`}`)

  const existing = existingAssetNames(release)
  for (const file of files) {
    for (const part of splitIfNeeded(file, maxAssetBytes)) {
      const name = path.basename(part)
      if (existing.has(name)) {
        log(`附件已存在，跳过 ${name}`)
        continue
      }
      await uploadAsset(release.id, part)
    }
  }
  log(`发布完成：https://gitee.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tag)}`)
}

// ---- 主流程 ----

if (publishOnly) {
  log('已指定 --publish-only，跳过全部构建步骤')
} else {
  installDeps()
  setPackageVersion()
  buildBackend()
  buildFrontend()
  buildApp()
}

const artifacts = collectArtifacts()
if (artifacts.length === 0) fail('没有找到可发布的产物')
log(`产物：${artifacts.map((f) => path.basename(f)).join(', ')}`)

await publish(artifacts)
log('全部完成')

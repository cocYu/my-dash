/**
 * 编译 Go 后端：
 *   node scripts/build-backend.mjs dev      -> backend/bin/backend-dev[.exe]
 *   node scripts/build-backend.mjs release  -> backend/bin/backend[.exe]（-trimpath -ldflags "-s -w"）
 *
 * 交叉编译（CI 用）：
 *   node scripts/build-backend.mjs release --os windows --arch x64
 *   --os 支持 windows / darwin / linux；--arch 支持 x64 / arm64 / ia32
 *   未传时沿用当前系统与架构。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] === 'release' ? 'release' : 'dev'

function argValue(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

const OS_ALIASES = {
  win32: 'windows',
  windows: 'windows',
  win: 'windows',
  darwin: 'darwin',
  mac: 'darwin',
  macos: 'darwin',
  linux: 'linux'
}
const ARCH_ALIASES = {
  x64: 'amd64',
  amd64: 'amd64',
  arm64: 'arm64',
  ia32: '386',
  x86: '386'
}

const targetOs = OS_ALIASES[argValue('--os') ?? process.env.MYDASH_TARGET_OS ?? process.platform] ?? 'linux'
const targetArch = ARCH_ALIASES[argValue('--arch') ?? process.env.MYDASH_TARGET_ARCH ?? process.arch] ?? 'amd64'
const ext = targetOs === 'windows' ? '.exe' : ''
// release 按 electron-builder 的 ${os} 宏分目录（win/mac/linux），避免多平台二进制混进同一个包；dev 固定在本机 bin 根目录
const releaseDir = { windows: 'win', darwin: 'mac', linux: 'linux' }[targetOs]
const outFile = mode === 'release' ? `backend${ext}` : `backend-dev${ext}`
const outPath =
  mode === 'release'
    ? path.join(root, 'backend', 'bin', releaseDir, outFile)
    : path.join(root, 'backend', 'bin', outFile)

mkdirSync(path.dirname(outPath), { recursive: true })

const args = ['build', '-trimpath']
if (mode === 'release') {
  args.push('-ldflags', '-s -w')
}
args.push('-o', outPath, '.')

console.log(`[backend] go build ${targetOs}/${targetArch} -> ${outPath}`)
const result = spawnSync('go', args, {
  cwd: path.join(root, 'backend'),
  stdio: 'inherit',
  env: {
    ...process.env,
    // SQLite 使用 modernc.org/sqlite（纯 Go），可安全关闭 CGO 做交叉编译
    CGO_ENABLED: '0',
    GOOS: targetOs,
    GOARCH: targetArch
  }
})
if (result.error || result.status !== 0) {
  console.error('[backend] Go 编译失败')
  process.exit(result.status ?? 1)
}
console.log(`[backend] 编译完成: ${outPath}`)

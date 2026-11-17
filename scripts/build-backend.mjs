/**
 * 编译 Go 后端：
 *   node scripts/build-backend.mjs dev      -> backend/bin/backend-dev.exe
 *   node scripts/build-backend.mjs release  -> backend/bin/backend.exe（-trimpath -ldflags "-s -w"）
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] === 'release' ? 'release' : 'dev'
const outFile = mode === 'release' ? 'backend.exe' : 'backend-dev.exe'
const outPath = path.join(root, 'backend', 'bin', outFile)

mkdirSync(path.dirname(outPath), { recursive: true })

const args = ['build', '-trimpath']
if (mode === 'release') {
  args.push('-ldflags', '-s -w')
}
args.push('-o', outPath, '.')

console.log(`[backend] go ${args.join(' ')}`)
const result = spawnSync('go', args, {
  cwd: path.join(root, 'backend'),
  stdio: 'inherit'
})
if (result.error || result.status !== 0) {
  console.error('[backend] Go 编译失败')
  process.exit(result.status ?? 1)
}
console.log(`[backend] 编译完成: ${outPath}`)

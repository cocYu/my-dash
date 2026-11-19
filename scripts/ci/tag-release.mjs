/**
 * 打发行 tag 并推送到两个远程：
 *   npm run release:tag -- 0.0.2
 *
 * 流程：校验版本与工作区 → 创建注释 tag release/v0.0.2
 *      → 先推 Gitee（origin，Release 建在这个 tag 上）
 *      → 再推 GitHub（github，触发 .github/workflows/release.yml 三端构建）
 *
 * 顺序很重要：Gitee 上先有 tag，发布脚本创建 Release 时才不会在错误的位置补 tag。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function git(args, options = {}) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', ...options })
}

function fail(message) {
  console.error(`[tag] ${message}`)
  process.exit(1)
}

function log(message) {
  console.log(`[tag] ${message}`)
}

const raw = (process.argv[2] || '').trim()
if (!raw) fail('用法：npm run release:tag -- 0.0.2')

const version = raw.replace(/^v/, '')
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`版本号不合法：${raw}（示例：0.0.2 或 0.0.2-beta.1）`)
}
const tag = `release/v${version}`

// 工作区有未提交改动时，tag 指向的提交会缺少这些改动，先拦下来
const dirty = git(['status', '--porcelain']).stdout.trim()
if (dirty) fail(`工作区有未提交改动，请先提交：\n${dirty}`)

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
if (branch !== 'main') log(`当前分支是 ${branch}（不是 main），tag 仍会打在 ${branch} 的 HEAD 上`)

if (git(['tag', '-l', tag]).stdout.trim() === tag) {
  fail(`tag ${tag} 已存在；要重打先删掉：git tag -d ${tag} && git push origin :refs/tags/${tag}`)
}

log(`创建 ${tag} @ ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()}`)
if (git(['tag', '-a', tag, '-m', `AtoZ ${version}`]).status !== 0) fail('创建 tag 失败')

const remotes = git(['remote']).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
const hasGithub = remotes.includes('github')

log('推送 Gitee（origin）…')
if (git(['push', 'origin', tag], { stdio: 'inherit' }).status !== 0) {
  fail(`推送 origin 失败；tag 已建在本地，排查后重试：git push origin ${tag}`)
}

if (hasGithub) {
  log('推送 GitHub（github）以触发构建…')
  if (git(['push', 'github', tag], { stdio: 'inherit' }).status !== 0) {
    fail(`推送 github 失败；排查后重试：git push github ${tag}`)
  }
  log(`已触发构建，进度：https://github.com/<你的账号>/my-dash/actions`)
} else {
  log('未配置 github 远程，跳过触发构建。添加方式：')
  log('  git remote add github git@github.com:<你的账号>/my-dash.git')
  log(`  git push github ${tag}`)
}

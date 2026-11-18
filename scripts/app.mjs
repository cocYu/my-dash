/**
 * AtoZ 应用启停工具（Windows）：
 *   node scripts/app.mjs start    启动 dev（后台独立运行，日志写入 output/dev.log）
 *   node scripts/app.mjs stop     停止应用与全部相关进程（含托盘驻留/孤儿）
 *   node scripts/app.mjs restart  重启（先 stop 再 start）
 *   node scripts/app.mjs status   查看运行状态
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, openSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logFile = path.join(root, 'output', 'dev.log')
const action = process.argv[2] ?? 'status'

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf-8' })
}

function tasklist(image) {
  return run('tasklist', ['/FI', `IMAGENAME eq ${image}`]).stdout ?? ''
}

function wait(seconds) {
  spawnSync('timeout', ['/t', String(seconds), '/nobreak'], { shell: true, stdio: 'ignore' })
}

/** 杀掉监听指定端口的进程树 */
function killPort(port) {
  const out = run('netstat', ['-ano']).stdout ?? ''
  const pids = new Set()
  for (const line of out.split('\n')) {
    if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
      const pid = line.trim().split(/\s+/).pop()
      if (pid && /^\d+$/.test(pid)) pids.add(pid)
    }
  }
  for (const pid of pids) run('taskkill', ['/PID', pid, '/T', '/F'])
  return pids.size
}

function allStopped() {
  const electron = tasklist('electron.exe')
  const backend = tasklist('backend-dev.exe') + tasklist('backend.exe')
  return !/electron\.exe/.test(electron) && !/backend(-dev)?\.exe/.test(backend)
}

function stop() {
  // 应用本体（electron.exe = dev；AtoZ.exe = 打包版），强制杀确保托盘驻留也退出
  run('taskkill', ['/IM', 'electron.exe', '/F'])
  run('taskkill', ['/IM', 'AtoZ.exe', '/F'])
  // Go 后端
  run('taskkill', ['/IM', 'backend-dev.exe', '/F'])
  run('taskkill', ['/IM', 'backend.exe', '/F'])
  // Vite dev server（按端口清理）
  const killed = killPort(5173)
  // 轮询等待进程退出（句柄/看门狗收尾）
  const deadline = Date.now() + 6000
  while (Date.now() < deadline && !allStopped()) wait(1)
  console.log(`[app] 已停止（端口 5173 清理 ${killed} 个进程）`)
}

function isRunning() {
  return (
    /electron\.exe/.test(tasklist('electron.exe')) &&
    /backend(-dev)?\.exe/.test(tasklist('backend-dev.exe') + tasklist('backend.exe'))
  )
}

function start() {
  if (isRunning()) {
    console.log('[app] 应用已在运行，如需重启请用: node scripts/app.mjs restart')
    return
  }
  mkdirSync(path.dirname(logFile), { recursive: true })
  if (existsSync(logFile)) {
    try {
      rmSync(logFile)
    } catch {
      // 被占用则追加写入
    }
  }

  // 先同步编译 Go 后端（有缓存，很快）
  console.log('[app] 编译 Go 后端...')
  const build = spawnSync(process.execPath, ['scripts/build-backend.mjs', 'dev'], {
    cwd: root,
    stdio: 'inherit'
  })
  if (build.status !== 0) {
    console.error('[app] 后端编译失败，中止启动')
    return
  }

  const out = openSync(logFile, 'a')
  // 直接以 node 运行 electron-vite（绕过 cmd/npm 的 stdio 包装）；
  // 分离进程组 + 隐藏控制台：本脚本退出后应用继续独立运行，输出落入日志文件
  const child = spawn(
    process.execPath,
    ['node_modules/electron-vite/dist/cli.js', 'dev'],
    {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, MYDASH_DEBUG_PORT: '9222' }
    }
  )
  child.unref()
  console.log(`[app] 正在启动（PID ${child.pid}），日志: output/dev.log`)
  console.log('[app] 就绪通常需要 8~15 秒，可用 status 查看')
}

function status() {
  const electron = /electron\.exe/.test(tasklist('electron.exe'))
  const packaged = /AtoZ\.exe/.test(tasklist('AtoZ.exe'))
  const backendDev = /backend-dev\.exe/.test(tasklist('backend-dev.exe'))
  const backendRelease = /backend\.exe/.test(tasklist('backend.exe'))
  const vite = (run('netstat', ['-ano']).stdout ?? '').includes(':5173 ')
  console.log(`[app] dev 前端:   ${electron ? '运行中' : '未运行'}`)
  console.log(`[app] Go 后端:    ${backendDev ? '运行中(dev)' : backendRelease ? '运行中(release)' : '未运行'}`)
  console.log(`[app] vite:5173:  ${vite ? '监听中' : '未监听'}`)
  if (packaged) console.log('[app] 打包版:     运行中（AtoZ.exe）')
}

if (action === 'stop') stop()
else if (action === 'start') start()
else if (action === 'restart') {
  stop()
  start()
} else status()

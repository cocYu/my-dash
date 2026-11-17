import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { get } from 'node:http'
import path from 'node:path'

let backendProcess: ChildProcess | null = null
let lastStartOptions: BackendStartOptions | null = null

export interface BackendStartOptions {
  port: number
  dbPath: string
  token: string
}

/** 最近一次后端启动参数（数据还原后用同一配置重启） */
export function getLastStartOptions(): BackendStartOptions | null {
  return lastStartOptions
}

/** dev 模式取编译产物 backend-dev.exe，打包后取安装资源里的 backend.exe */
export function resolveBackendExe(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'backend.exe')
  }
  return path.join(app.getAppPath(), 'backend', 'bin', 'backend-dev.exe')
}

/**
 * 启动 Go 后端子进程并等待健康检查通过。
 * stdin 保持打开：后端以此检测父进程退出（stdin EOF 即自杀），防止孤儿进程。
 */
export function startBackend(opts: BackendStartOptions): Promise<void> {
  const exe = resolveBackendExe()
  console.log(`[backend] 启动: ${exe}`)
  lastStartOptions = opts

  const child = spawn(
    exe,
    ['-port', String(opts.port), '-db', opts.dbPath, '-token', opts.token],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }
  )
  backendProcess = child

  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[backend] ${chunk}`)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[backend] ${chunk}`)
  })
  child.on('exit', (code) => {
    console.log(`[backend] 进程退出，code=${code}`)
    if (backendProcess === child) backendProcess = null
  })

  return waitForHealth(opts.port, opts.token, 15000)
}

function healthOnce(port: number, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/health',
        headers: { 'X-API-Token': token },
        timeout: 2000
      },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

async function waitForHealth(port: number, token: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await healthOnce(port, token)) return
    if (!backendProcess) {
      throw new Error('后端进程在健康检查通过前已退出，请查看主进程日志')
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`后端健康检查超时（${timeoutMs}ms）`)
}

/** 停止后端：先 kill，再关闭 stdin 触发后端的看门狗退出逻辑兜底 */
export function stopBackend(): void {
  const child = backendProcess
  if (!child) return
  backendProcess = null
  try {
    child.kill()
  } catch {
    // 进程可能已退出
  }
  try {
    child.stdin?.end()
  } catch {
    // 同上
  }
}

// 定时同步调度器：主进程常驻，每分钟检查到期并执行；错过（关机等）启动后补跑。
import { readConfig, type SyncConfig } from './config'

let timer: NodeJS.Timeout | null = null

function isDue(cfg: SyncConfig): boolean {
  const s = cfg.schedule
  if (!s?.enabled) return false
  const now = Date.now()
  const last = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0

  if (s.mode === 'interval') {
    const intervalMs = Math.max(1, s.intervalHours) * 3600_000
    return now - last >= intervalMs
  }

  // daily：今天的目标时刻已过，且上次运行早于该时刻
  const [h, m] = (s.dailyTime || '03:00').split(':').map(Number)
  const todayAt = new Date()
  todayAt.setHours(h || 0, m || 0, 0, 0)
  return now >= todayAt.getTime() && last < todayAt.getTime()
}

export function startScheduler(run: () => Promise<unknown>): void {
  if (timer) clearInterval(timer)
  const tick = (): void => {
    try {
      const cfg = readConfig()
      if (!isDue(cfg)) return
      console.log('[sync] 定时同步触发')
      run().catch((err) => console.error('[sync] 定时同步失败:', err instanceof Error ? err.message : err))
    } catch (err) {
      console.error('[sync] 调度检查失败:', err)
    }
  }
  setTimeout(tick, 5_000) // 启动后先检查一次（补跑错过的同步）
  timer = setInterval(tick, 60_000)
}

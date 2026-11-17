// 数据同步服务：备份打包（DB 快照 + 插件）→ 云上传/下载 → 还原 → 历史记录。
import { app } from 'electron'
import AdmZip from 'adm-zip'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { attachmentsDir } from '../attachments'
import { cloudDelete, cloudDownload, cloudList, cloudUpload } from './cloud'
import { readConfig, syncDir, writeConfig, type SyncConfig } from './config'
import { getLastStartOptions, startBackend, stopBackend } from '../backend'
import { pluginStorageDirs, refreshManager } from '../plugins/manager'
import type { RemoteBackupRecord, SyncHistoryRecord as HistoryRecord } from '../../types/sync'

export type { SyncHistoryRecord as HistoryRecord } from '../../types/sync'

export interface SyncContext {
  baseUrl: string
  token: string
  dbPath: string
}

const HISTORY_MAX = 50

function historyFile(): string {
  return path.join(syncDir(), 'history.json')
}

export function getHistory(): HistoryRecord[] {
  try {
    const list = JSON.parse(fs.readFileSync(historyFile(), 'utf-8')) as HistoryRecord[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function pushHistory(rec: HistoryRecord): void {
  const list = getHistory()
  list.unshift(rec)
  fs.mkdirSync(syncDir(), { recursive: true })
  fs.writeFileSync(historyFile(), JSON.stringify(list.slice(0, HISTORY_MAX), null, 2))
}

function tmpDir(): string {
  return path.join(syncDir(), 'tmp')
}

/** 拉取云端实际存在的备份列表（用已保存的配置；换新设备后由此发现可还原的备份） */
export function listRemoteBackups(): Promise<RemoteBackupRecord[]> {
  return cloudList(readConfig())
}

function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `mydash-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.zip`
}

/** 从 Go 后端拉取一致性数据库快照 */
async function downloadDbSnapshot(ctx: SyncContext, destFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = http.get(
      `${ctx.baseUrl}/api/admin/db/snapshot`,
      { headers: { 'X-API-Token': ctx.token }, timeout: 15000 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`数据库快照下载失败: HTTP ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            fs.writeFileSync(destFile, Buffer.concat(chunks))
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        res.on('error', reject)
      }
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('数据库快照下载超时'))
    })
    req.on('error', reject)
  })
}

/** 打包备份 zip：DB 快照 + 插件目录/KV/注册状态 + 笔记图片附件 + manifest */
async function createBackupZip(ctx: SyncContext): Promise<{ file: string; size: number }> {
  fs.mkdirSync(tmpDir(), { recursive: true })
  const name = backupFileName()
  const file = path.join(tmpDir(), name)

  const dbTmp = path.join(tmpDir(), `db-${Date.now()}.db`)
  await downloadDbSnapshot(ctx, dbTmp)

  try {
    const zip = new AdmZip()
    zip.addLocalFile(dbTmp, 'data', 'mydash.db')
    const { plugins } = pluginStorageDirs()
    if (fs.existsSync(plugins)) {
      zip.addLocalFolder(plugins, 'plugins')
    }
    const attachDir = attachmentsDir()
    if (fs.existsSync(attachDir)) {
      zip.addLocalFolder(attachDir, 'attachments')
    }
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          appVersion: app.getVersion(),
          createdAt: new Date().toISOString(),
          dbFile: 'data/mydash.db'
        }),
        'utf-8'
      )
    )
    zip.writeZip(file)
  } finally {
    fs.rmSync(dbTmp, { force: true })
  }
  return { file, size: fs.statSync(file).size }
}

/** 打包并上传到云端（手动或定时触发共用） */
export async function runSync(ctx: SyncContext, trigger: 'manual' | 'scheduled'): Promise<HistoryRecord> {
  const started = Date.now()
  const cfg: SyncConfig = readConfig()
  cfg.lastRunAt = new Date().toISOString()
  writeConfig(cfg)

  const rec: HistoryRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    trigger,
    direction: 'backup',
    target: cfg.target,
    status: 'success'
  }
  try {
    const { file, size } = await createBackupZip(ctx)
    const remoteFile = `${(cfg.remotePath || '/mydash-backup').replace(/\/+$/, '')}/${path.basename(file)}`
    await cloudUpload(cfg, remoteFile, file)

    // 保留最近 keepLast 份：清理更早的成功备份
    const keep = Math.max(1, cfg.keepLast ?? 10)
    const older = getHistory().filter(
      (h) => h.direction === 'backup' && h.status === 'success' && h.target === cfg.target && h.remoteFile && !h.purged
    )
    for (const old of older.slice(keep - 1)) {
      await cloudDelete(cfg, old.remoteFile!).catch(() => undefined)
      old.purged = true
    }
    fs.writeFileSync(historyFile(), JSON.stringify(getHistory(), null, 2))

    rec.remoteFile = remoteFile
    rec.size = size
    rec.durationMs = Date.now() - started
    cfg.lastSuccessAt = new Date().toISOString()
    writeConfig(cfg)
    pushHistory(rec)
    return rec
  } catch (err) {
    rec.status = 'failed'
    rec.error = err instanceof Error ? err.message : String(err)
    rec.durationMs = Date.now() - started
    pushHistory(rec)
    throw err
  }
}

/** 从历史记录（远端备份文件）还原：停后端 → 替换 DB 与插件 → 重启后端 */
export async function restoreFromRecord(ctx: SyncContext, remoteFile: string): Promise<HistoryRecord> {
  const started = Date.now()
  const cfg: SyncConfig = readConfig()
  const rec: HistoryRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    trigger: 'manual',
    direction: 'restore',
    target: cfg.target,
    remoteFile,
    status: 'success'
  }

  fs.mkdirSync(tmpDir(), { recursive: true })
  const tmpZip = path.join(tmpDir(), `restore-${Date.now()}.zip`)
  try {
    await cloudDownload(cfg, remoteFile, tmpZip)
    const zip = new AdmZip(tmpZip)
    if (!zip.getEntry('manifest.json')) throw new Error('备份包缺少 manifest.json，不是有效的 myDash 备份')
    const dbEntry = zip.getEntry('data/mydash.db')
    if (!dbEntry) throw new Error('备份包缺少数据库文件')

    // 1. 停后端，释放 SQLite 句柄
    stopBackend()
    await new Promise((r) => setTimeout(r, 500))

    // 2. 替换数据库（清掉 WAL/SHM 残留）
    fs.rmSync(ctx.dbPath, { force: true })
    fs.rmSync(`${ctx.dbPath}-wal`, { force: true })
    fs.rmSync(`${ctx.dbPath}-shm`, { force: true })
    fs.writeFileSync(ctx.dbPath, dbEntry.getData())

    // 3. 覆盖插件子树（备份内的文件覆盖现有；备份外已装插件保留）
    const { plugins } = pluginStorageDirs()
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('plugins/')) continue
      const dest = path.join(plugins, entry.entryName.slice('plugins/'.length))
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, entry.getData())
    }
    refreshManager()

    // 3b. 重建图片附件（DB 已整体替换，附件以备份内为准：先清空再铺入，防止残留引用外文件）
    const attachDir = attachmentsDir()
    fs.rmSync(attachDir, { force: true, recursive: true })
    fs.mkdirSync(attachDir, { recursive: true })
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('attachments/')) continue
      const dest = path.join(attachDir, entry.entryName.slice('attachments/'.length))
      fs.writeFileSync(dest, entry.getData())
    }

    // 4. 重启后端（复用原端口/token/dbPath，渲染层连接不变）
    const opts = getLastStartOptions()
    if (!opts) throw new Error('后端启动参数缺失，无法重启后端')
    await startBackend(opts)

    rec.durationMs = Date.now() - started
    pushHistory(rec)
    return rec
  } catch (err) {
    rec.status = 'failed'
    rec.error = err instanceof Error ? err.message : String(err)
    rec.durationMs = Date.now() - started
    pushHistory(rec)
    throw err
  } finally {
    fs.rmSync(tmpZip, { force: true })
  }
}

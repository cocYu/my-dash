// 同步配置：userData/sync/config.json 读写。
// 密码/密钥等敏感字段用 Electron safeStorage 加密（enc: 前缀 base64），不可用时退化为明文。
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SyncConfig } from '../../types/sync'

export type { SyncConfig, WebDavConfig, S3Config, SyncSchedule } from '../../types/sync'

export function syncDir(): string {
  return path.join(app.getPath('userData'), 'sync')
}
function configFile(): string {
  return path.join(syncDir(), 'config.json')
}

export function defaultConfig(): SyncConfig {
  return {
    target: 'webdav',
    remotePath: '/mydash-backup',
    keepLast: 10,
    webdav: { url: '', username: '', password: '' },
    s3: { endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '', pathStyle: true },
    schedule: { enabled: false, mode: 'interval', intervalHours: 12, dailyTime: '03:00' }
  }
}

/** 敏感字段名（保存时加密、读取时解密） */
const SECRET_KEYS = ['webdav.password', 's3.secretAccessKey'] as const

function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) return plain
  return 'enc:' + safeStorage.encryptString(plain).toString('base64')
}

function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith('enc:')) return stored
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
  } catch {
    return ''
  }
}

function encryptAt(cfg: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(cfg)
  for (const key of SECRET_KEYS) {
    const [section, field] = key.split('.')
    const sec = out[section] as Record<string, unknown> | undefined
    if (sec && typeof sec[field] === 'string') sec[field] = encryptSecret(sec[field] as string)
  }
  return out
}

function decryptAt(cfg: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(cfg)
  for (const key of SECRET_KEYS) {
    const [section, field] = key.split('.')
    const sec = out[section] as Record<string, unknown> | undefined
    if (sec && typeof sec[field] === 'string') sec[field] = decryptSecret(sec[field] as string)
  }
  return out
}

export function readConfig(): SyncConfig {
  const def = defaultConfig() as unknown as Record<string, unknown>
  let stored: Record<string, unknown> = {}
  try {
    stored = JSON.parse(fs.readFileSync(configFile(), 'utf-8'))
  } catch {
    return defaultConfig()
  }
  const merged = { ...def, ...stored, decryptAt: undefined }
  delete merged.decryptAt
  const cfg = decryptAt(merged) as unknown as SyncConfig
  // 兜底：缺失的嵌套段用默认值补齐
  cfg.webdav = { ...defaultConfig().webdav, ...(stored.webdav ?? {}) }
  cfg.s3 = { ...defaultConfig().s3, ...(stored.s3 ?? {}) }
  cfg.schedule = { ...defaultConfig().schedule, ...(stored.schedule ?? {}) }
  return cfg
}

export function writeConfig(cfg: SyncConfig): void {
  fs.mkdirSync(syncDir(), { recursive: true })
  const tmp = `${configFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(JSON.parse(JSON.stringify(encryptAt(cfg as unknown as Record<string, unknown>))), null, 2))
  fs.renameSync(tmp, configFile())
}

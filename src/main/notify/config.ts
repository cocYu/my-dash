// 通知配置：userData/notify/config.json 读写。
// webhook/密钥/SMTP 密码等敏感字段用 Electron safeStorage 加密（enc: 前缀 base64），不可用时退化为明文。
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { NotifyConfig } from '../../types/notify'

export type { NotifyConfig } from '../../types/notify'

export function notifyDir(): string {
  return path.join(app.getPath('userData'), 'notify')
}
function configFile(): string {
  return path.join(notifyDir(), 'config.json')
}

export function defaultNotifyConfig(): NotifyConfig {
  return {
    enabled: true,
    notifyOnSoon: true,
    notifyOnOverdue: true,
    system: { enabled: true },
    wecom: { enabled: false, webhook: '' },
    feishu: { enabled: false, webhook: '', secret: '' },
    dingtalk: { enabled: false, webhook: '', secret: '' },
    email: { enabled: false, host: '', port: 465, secure: true, username: '', password: '', from: '', to: '' }
  }
}

/** 敏感字段（section.field）：保存时加密、读取时解密 */
const SECRET_KEYS = [
  'wecom.webhook',
  'feishu.webhook',
  'feishu.secret',
  'dingtalk.webhook',
  'dingtalk.secret',
  'email.password'
] as const

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

export function readNotifyConfig(): NotifyConfig {
  let stored: Record<string, unknown> = {}
  try {
    stored = JSON.parse(fs.readFileSync(configFile(), 'utf-8'))
  } catch {
    return defaultNotifyConfig()
  }
  // 先用默认值补齐缺失段，再整体解密——顺序不能反，否则 enc: 加密串会原样透出
  const merged = { ...defaultNotifyConfig(), ...stored }
  return decryptAt(merged) as unknown as NotifyConfig
}

export function writeNotifyConfig(cfg: NotifyConfig): void {
  fs.mkdirSync(notifyDir(), { recursive: true })
  const tmp = `${configFile()}.tmp`
  fs.writeFileSync(
    tmp,
    JSON.stringify(JSON.parse(JSON.stringify(encryptAt(cfg as unknown as Record<string, unknown>))), null, 2)
  )
  fs.renameSync(tmp, configFile())
}

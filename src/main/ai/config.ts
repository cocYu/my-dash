// 供应商配置：userData/ai/providers.json 读写。
// apiKey 用 Electron safeStorage 加密（enc: 前缀 base64），不可用时退化为明文。
// 云端备份用明文导出（与数据库快照同一信任级别），还原时用本机 safeStorage 重新加密。
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AiProvider } from '../../types/ai'

export function aiDir(): string {
  return path.join(app.getPath('userData'), 'ai')
}
function configFile(): string {
  return path.join(aiDir(), 'providers.json')
}

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

/** 读原始配置（apiKey 已解密，仅供主进程内部调用网关使用） */
export function readProviders(): AiProvider[] {
  try {
    const list = JSON.parse(fs.readFileSync(configFile(), 'utf-8'))
    if (!Array.isArray(list)) return []
    return list.map((p: AiProvider) => ({ ...p, apiKey: decryptSecret(p.apiKey ?? '') }))
  } catch {
    return []
  }
}

/** 落盘（apiKey 加密） */
export function writeProviders(list: AiProvider[]): void {
  fs.mkdirSync(aiDir(), { recursive: true })
  const out = list.map((p) => ({ ...p, apiKey: encryptSecret(p.apiKey ?? '') }))
  const tmp = `${configFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2))
  fs.renameSync(tmp, configFile())
}

/** 渲染层视图：apiKey 脱敏为空串，带 hasApiKey 标记 */
export function providersForRenderer(): AiProvider[] {
  return readProviders().map((p) => ({
    ...p,
    apiKey: '',
    hasApiKey: Boolean(p.apiKey)
  }))
}

/**
 * 保存渲染层提交的配置。
 * 输入框留空且服务端已有密钥时保留原密钥（避免脱敏占位覆盖真实 key）。
 */
export function saveProvidersFromRenderer(list: AiProvider[]): AiProvider[] {
  const old = readProviders()
  const oldMap = new Map(old.map((p) => [p.id, p]))
  const merged = list.map((p) => {
    const prev = oldMap.get(p.id)
    const key = p.apiKey?.trim() ? p.apiKey : prev && p.hasApiKey ? prev.apiKey : ''
    return { ...p, apiKey: key }
  })
  writeProviders(merged)
  return providersForRenderer()
}

/** 云端备份导出：apiKey 明文（与 DB 快照同一信任级别） */
export function providersForBackup(): AiProvider[] {
  return readProviders()
}

/** 云端还原：写入备份中的明文密钥，由本机 safeStorage 重新加密 */
export function writeProvidersFromBackup(list: AiProvider[]): void {
  if (!Array.isArray(list)) return
  writeProviders(list)
}

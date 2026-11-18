// 生图历史：userData/ai/image-history.json。
// 只存元数据（提示词/时间/尺寸/模型/附件文件名），图片本体在附件库内容寻址存储，
// 因此随云同步的 attachments/ 目录一起上云，无额外图片副本。
import fs from 'node:fs'
import path from 'node:path'
import { aiDir } from './config'
import type { AiImageHistoryItem } from '../../types/ai'

const MAX_ITEMS = 200

function historyFile(): string {
  return path.join(aiDir(), 'image-history.json')
}

/** 读取历史，异常/损坏文件按空列表处理 */
export function readHistory(): AiImageHistoryItem[] {
  try {
    const list = JSON.parse(fs.readFileSync(historyFile(), 'utf-8'))
    if (!Array.isArray(list)) return []
    return list.filter((x): x is AiImageHistoryItem => Boolean(x && typeof x.id === 'string' && Array.isArray(x.images)))
  } catch {
    return []
  }
}

/** 写入完整列表（供云端还原使用） */
export function writeHistory(list: AiImageHistoryItem[]): void {
  if (!Array.isArray(list)) return
  fs.mkdirSync(aiDir(), { recursive: true })
  const tmp = `${historyFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, MAX_ITEMS), null, 2))
  fs.renameSync(tmp, historyFile())
}

/** 生成成功后追加一条（最新在前，超出上限自动裁剪） */
export function appendHistory(item: AiImageHistoryItem): AiImageHistoryItem[] {
  const list = [item, ...readHistory()].slice(0, MAX_ITEMS)
  writeHistory(list)
  return list
}

export function deleteHistory(id: string): AiImageHistoryItem[] {
  const list = readHistory().filter((x) => x.id !== id)
  writeHistory(list)
  return list
}

export function clearHistory(): void {
  writeHistory([])
}

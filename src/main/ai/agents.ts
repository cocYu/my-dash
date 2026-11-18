// 自定义 AI 助手（Agent）配置：userData/ai/agents.json。
// 与 providers.json 同目录、同原子写方式；可随云备份同步。
import fs from 'node:fs'
import path from 'node:path'
import { aiDir } from './config'
import type { AiAgent } from '../../types/agent'

function agentsFile(): string {
  return path.join(aiDir(), 'agents.json')
}

/** 兼容历史配置：数组与标量字段补齐默认值，避免旧数据引发运行时异常 */
function normalize(x: AiAgent): AiAgent {
  return {
    ...x,
    emoji: x.emoji || '🤖',
    description: x.description ?? '',
    systemPrompt: x.systemPrompt ?? '',
    temperature: typeof x.temperature === 'number' ? x.temperature : 0.7,
    maxTokens: typeof x.maxTokens === 'number' && x.maxTokens > 0 ? x.maxTokens : 4096,
    reasoningEffort: x.reasoningEffort ?? 'off',
    tools: Array.isArray(x.tools) ? x.tools : [],
    knowledgeFolderIds: Array.isArray(x.knowledgeFolderIds) ? x.knowledgeFolderIds : [],
    quickPrompts: Array.isArray(x.quickPrompts) ? x.quickPrompts : []
  }
}

export function readAgents(): AiAgent[] {
  try {
    const list = JSON.parse(fs.readFileSync(agentsFile(), 'utf-8'))
    if (!Array.isArray(list)) return []
    return list
      .filter((x): x is AiAgent => Boolean(x && typeof x.id === 'string' && typeof x.name === 'string'))
      .map(normalize)
  } catch {
    return []
  }
}

function writeAgents(list: AiAgent[]): void {
  fs.mkdirSync(aiDir(), { recursive: true })
  const tmp = `${agentsFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, agentsFile())
}

/** 新建或更新（按 id upsert），返回最新列表 */
export function saveAgent(agent: AiAgent): AiAgent[] {
  const list = readAgents()
  const idx = list.findIndex((x) => x.id === agent.id)
  if (idx >= 0) list[idx] = agent
  else list.unshift(agent)
  writeAgents(list)
  return list
}

export function removeAgent(id: string): AiAgent[] {
  const list = readAgents().filter((x) => x.id !== id)
  writeAgents(list)
  return list
}

/** 云端备份 / 还原 */
export function agentsForBackup(): AiAgent[] {
  return readAgents()
}

export function writeAgentsFromBackup(list: AiAgent[]): void {
  if (Array.isArray(list)) writeAgents(list)
}

// AI 工作台 IPC：供应商 CRUD / 拉取模型 / 统一对话 / 生图 / 生图历史 / 提示词增强。
import { ipcMain } from 'electron'
import type { AiChatRequest, AiImageHistoryItem, AiImageRequest, AiPromptEnhanceRequest, AiProvider, AiUsageQuery } from '../../types/ai'
import { providersForRenderer, readProviders, saveProvidersFromRenderer, writeProviders } from './config'
import { chatOnce, fetchModels, testProvider } from './gateway'
import { generateImage } from './image'
import { appendHistory, clearHistory, deleteHistory, readHistory } from './history'
import { appendUsage, lastCallAt, queryUsage } from './usage'
import { fetchQuota } from './quota'

function findProvider(id: string): AiProvider {
  const p = readProviders().find((x) => x.id === id)
  if (!p) throw new Error('供应商不存在，请刷新后重试')
  return p
}

const ENHANCE_SYSTEM_PROMPT = `你是一位专业的 AI 绘画提示词优化专家。用户会给你一段绘画描述，请在不改变核心创意的前提下，把它扩写成更具体、更适合 AI 生图模型的提示词。
要求：
- 保留用户原本的主体、场景和意图，不要凭空替换主题
- 适当补充画面细节：主体特征、环境、光线、色彩、构图、镜头视角、艺术风格、画质词
- 输出一段连贯的提示词，不要分点、不要解释、不要加引号或 Markdown 标记
- 使用与用户输入相同的语言
只输出优化后的提示词本身。`

/** 清理模型输出中常见的 ```代码块``` 包裹与首尾成对引号 */
function cleanEnhanced(text: string): string {
  let s = text.trim()
  const fence = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i.exec(s)
  if (fence) s = fence[1].trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”'))) {
    s = s.slice(1, -1).trim()
  }
  return s
}

export function registerAiIpc(): void {
  ipcMain.handle('ai:providers:list', () => providersForRenderer())

  ipcMain.handle('ai:providers:save', (_e, list: AiProvider[]) => saveProvidersFromRenderer(list))

  ipcMain.handle('ai:providers:fetch-models', async (_e, id: string) => {
    const p = findProvider(id)
    const models = await fetchModels(p)
    // 拉取成功后回写模型缓存与时间戳（保留加密的 apiKey）
    const all = readProviders()
    const idx = all.findIndex((x) => x.id === id)
    if (idx >= 0) {
      all[idx] = { ...all[idx], models, modelsFetchedAt: new Date().toISOString() }
      // 直接写原始列表（apiKey 此时已是明文，writeProviders 会加密）
      writeProviders(all)
    }
    return models
  })

  ipcMain.handle('ai:providers:test', async (_e, id: string) => testProvider(findProvider(id)))

  ipcMain.handle('ai:chat', async (_e, req: AiChatRequest) => {
    if (!req.model) throw new Error('请选择模型')
    if (!req.messages?.length) throw new Error('消息不能为空')
    return chatOnce(findProvider(req.providerId), req)
  })

  ipcMain.handle('ai:image:generate', async (_e, req: AiImageRequest) => {
    if (!req.model) throw new Error('请选择生图模型')
    if (!req.prompt?.trim()) throw new Error('请输入提示词')
    const provider = findProvider(req.providerId)
    const results = await generateImage(provider, req)
    try {
      appendUsage({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        providerId: provider.id,
        providerName: provider.name,
        model: req.model,
        kind: 'image',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        at: new Date().toISOString()
      })
    } catch (err) {
      console.error('[ai] 记录生图用量失败:', err)
    }
    // 写历史只存元数据，图片本体已在附件库；历史写入失败不应让生图主流程报错
    const item: AiImageHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: req.prompt.trim(),
      model: req.model,
      providerId: provider.id,
      providerName: provider.name,
      mode: req.mode,
      ...(req.size ? { size: req.size } : {}),
      ...(req.quality ? { quality: req.quality } : {}),
      createdAt: new Date().toISOString(),
      images: results.map((r) => ({ name: r.name, ...(r.width && r.height ? { width: r.width, height: r.height } : {}) }))
    }
    try {
      appendHistory(item)
    } catch (err) {
      console.error('[ai] 写生图历史失败:', err)
    }
    return results
  })

  ipcMain.handle('ai:history:list', () => readHistory())
  ipcMain.handle('ai:history:delete', (_e, id: string) => deleteHistory(id))
  ipcMain.handle('ai:history:clear', () => {
    clearHistory()
    return readHistory()
  })

  ipcMain.handle('ai:quota', async (_e, id: string) => fetchQuota(findProvider(id)))

  ipcMain.handle('ai:last-call', (_e, id: string) => lastCallAt(id))

  ipcMain.handle('ai:usage', (_e, query: AiUsageQuery) =>
    queryUsage(query && typeof query === 'object' ? query : {})
  )

  ipcMain.handle('ai:prompt:enhance', async (_e, req: AiPromptEnhanceRequest) => {
    if (!req.providerId) throw new Error('请选择用于提示词增强的供应商')
    if (!req.model) throw new Error('请选择用于提示词增强的模型')
    if (!req.prompt?.trim()) throw new Error('请输入原始提示词')
    const provider = findProvider(req.providerId)
    const resp = await chatOnce(provider, {
      providerId: provider.id,
      model: req.model,
      messages: [
        { role: 'system', content: ENHANCE_SYSTEM_PROMPT },
        { role: 'user', content: req.prompt.trim() }
      ],
      temperature: 0.7,
      maxTokens: 1024
    })
    const text = cleanEnhanced(resp.text)
    if (!text) throw new Error('供应商未返回有效的增强结果')
    return text
  })
}

// AI 工作台 IPC：供应商 CRUD / 拉取模型 / 对话 / 生图 / 历史 / 提示词增强 / 自定义 Agent。
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AiChatRequest, AiImageRequest, AiPromptEnhanceRequest, AiProvider, AiUsageQuery } from '../../types/ai'
import type { AiAgent, AiSessionPatch, AiStreamRequest, AiStreamResult, AiToolConfirmRequest, AiToolStep } from '../../types/agent'
import { providersForRenderer, readProviders, saveProvidersFromRenderer, writeProviders } from './config'
import { chatOnce, fetchModels, testProvider } from './gateway'
import { generateImageAndRecord } from './image'
import { appendHistory, clearHistory, deleteHistory, readHistory } from './history'
import { appendUsage, lastCallAt, queryUsage } from './usage'
import { fetchQuota } from './quota'
import { readAgents, removeAgent, saveAgent } from './agents'
import { appendMessage, createSession, deleteSession, deleteSessionsByAgent, listSessions, readMessages, readSession, renameSession, searchSessions, updateSession } from './sessions'
import { runAgentLoop } from './agent-loop'
import { prepareContext, type PreparedContext } from './context'
import { defaultReadTools, toolCatalog, toolsForAgent, type ToolConfirmInput, type ToolContext } from './tools'

/** 正在进行的流式请求：requestId → 中止控制器 */
const activeStreams = new Map<string, AbortController>()

/** 等待用户确认的写操作：requestId → 决议函数 */
const pendingConfirms = new Map<string, (approved: boolean) => void>()

/** 确认超时：5 分钟无响应按拒绝处理 */
const CONFIRM_TIMEOUT = 5 * 60 * 1000

/** 把写操作确认请求发给渲染层并等待结果；用户停止生成或超时都算拒绝 */
function requestToolConfirm(sender: WebContents, req: ToolConfirmInput, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || sender.isDestroyed()) return Promise.resolve(false)

  const requestId = randomUUID()
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (approved: boolean): void => {
      if (settled) return
      settled = true
      pendingConfirms.delete(requestId)
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(approved)
    }
    const timer = setTimeout(() => finish(false), CONFIRM_TIMEOUT)
    const onAbort = (): void => finish(false)
    signal.addEventListener('abort', onAbort)

    pendingConfirms.set(requestId, finish)
    const payload: AiToolConfirmRequest = { requestId, ...req }
    sender.send('ai:tool:confirm', payload)
  })
}

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

export function registerAiIpc(toolCtx: ToolContext): void {
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
    // 生图 + 用量 + 历史统一在 image.ts 内完成（Agent 工具走同一入口）
    return generateImageAndRecord(provider, req)
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

  // ---- 自定义 Agent ----
  ipcMain.handle('ai:agents:list', () => readAgents())

  ipcMain.handle('ai:agents:save', (_e, agent: AiAgent) => {
    if (!agent?.id) throw new Error('Agent 缺少 ID')
    if (!agent.name?.trim()) throw new Error('请填写助手名称')
    if (!agent.providerId) throw new Error('请选择供应商')
    if (!agent.model?.trim()) throw new Error('请选择模型')
    // 工具白名单只保留注册表里存在的名字，避免历史配置带来脏数据
    const known = new Set(toolCatalog().map((t) => t.name))
    const tools = Array.isArray(agent.tools) ? agent.tools.filter((n) => known.has(n)) : []
    return saveAgent({
      ...agent,
      name: agent.name.trim(),
      model: agent.model.trim(),
      tools,
      updatedAt: new Date().toISOString()
    })
  })

  ipcMain.handle('ai:agents:remove', (_e, id: string) => {
    const list = removeAgent(id)
    // 助手的会话正文单独存文件，随助手一起清理
    deleteSessionsByAgent(id)
    return list
  })

  // 工具目录：编辑页勾选，defaults 为新建助手的默认只读工具
  ipcMain.handle('ai:tools:list', () => ({ tools: toolCatalog(), defaults: defaultReadTools() }))

  // 渲染层回传写操作确认结果
  ipcMain.handle('ai:tool:confirm-response', (_e, requestId: string, approved: boolean) => {
    const finish = pendingConfirms.get(requestId)
    if (finish) finish(Boolean(approved))
    return true
  })

  // ---- 会话 ----
  ipcMain.handle('ai:sessions:list', (_e, agentId?: string) => listSessions(agentId))
  ipcMain.handle('ai:sessions:create', (_e, agentId: string) => createSession(agentId))
  ipcMain.handle('ai:sessions:delete', (_e, id: string) => {
    deleteSession(id)
    return true
  })
  ipcMain.handle('ai:sessions:rename', (_e, id: string, title: string) => renameSession(id, title))
  ipcMain.handle('ai:sessions:update', (_e, id: string, patch: AiSessionPatch) => {
    if (!id) return null
    const safe = patch && typeof patch === 'object' ? patch : {}
    return updateSession(id, safe) ?? null
  })
  ipcMain.handle('ai:sessions:messages', (_e, id: string) => readMessages(id))
  ipcMain.handle('ai:sessions:search', (_e, query: string, agentId?: string) =>
    searchSessions(typeof query === 'string' ? query : '', agentId)
  )

  // ---- 流式对话 ----
  ipcMain.handle(
    'ai:chat:stream',
    async (event: IpcMainInvokeEvent, req: AiStreamRequest): Promise<AiStreamResult> => {
      if (!req?.requestId) return { ok: false, message: '缺少请求 ID' }
      if (!req.sessionId) return { ok: false, message: '缺少会话 ID' }
      if (!req.messages?.length) return { ok: false, message: '消息不能为空' }

      const agent = readAgents().find((a) => a.id === req.agentId)
      if (!agent) return { ok: false, message: '助手不存在，请刷新后重试' }

      // 会话可覆盖供应商 / 模型 / 思考强度，未设置时沿用 Agent 配置
      const session = readSession(req.sessionId)
      const effectiveProviderId = session?.providerId || agent.providerId
      const effectiveModel = (session?.model || agent.model || '').trim()
      const effectiveEffort = session?.reasoningEffort ?? agent.reasoningEffort ?? 'off'

      let provider: AiProvider
      try {
        provider = findProvider(effectiveProviderId)
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : '供应商不可用' }
      }

      const controller = new AbortController()
      activeStreams.set(req.requestId, controller)
      const send = (payload: Record<string, unknown>): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai:stream:event', { requestId: req.requestId, ...payload })
        }
      }

      // 用户消息先落盘：即使生成失败也保留输入，便于重试
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
      if (lastUser) {
        try {
          appendMessage(req.sessionId, {
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'user',
            content: lastUser.content,
            createdAt: new Date().toISOString()
          })
        } catch (err) {
          console.error('[ai] 保存用户消息失败:', err)
        }
      }

      // 上下文以会话落盘消息为准（渲染层只传最近若干条），并按模型窗口做压缩
      const history = readMessages(req.sessionId)
      let prepared: PreparedContext = {
        messages: req.messages,
        summary: '',
        summarizedCount: 0,
        compressed: false
      }
      if (history.length) {
        try {
          prepared = await prepareContext({
            provider,
            agent,
            session: session ?? {},
            history,
            model: effectiveModel
          })
        } catch (err) {
          console.error('[ai] 上下文准备失败，回退到最近消息:', err)
        }
      }
      if (prepared.compressed) {
        try {
          updateSession(req.sessionId, {
            summary: prepared.summary,
            summarizedCount: prepared.summarizedCount,
            summaryAt: new Date().toISOString()
          })
        } catch (err) {
          console.error('[ai] 保存上下文摘要失败:', err)
        }
        if (prepared.notice) send({ type: 'notice', message: prepared.notice })
      }

      // 三协议（chat / responses / messages）都走同一个 Agent 循环，协议差异在网关层消化
      const tools = toolsForAgent(agent)

      let full = ''
      let steps: AiToolStep[] = []
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }

      try {
        const result = await runAgentLoop({
          provider,
          agent,
          model: effectiveModel,
          reasoningEffort: effectiveEffort,
          contextSummary: prepared.summary,
          messages: prepared.messages,
          tools,
          // 写操作确认：把请求推给渲染层弹窗，等用户点允许/拒绝
          ctx: {
            ...toolCtx,
            // 生图等工具需要助手级配置与解密后的供应商密钥
            agent,
            getProviders: readProviders,
            confirm: (confirmReq) => requestToolConfirm(event.sender, confirmReq, controller.signal)
          },
          signal: controller.signal,
          callbacks: {
            onText: (delta) => send({ type: 'text', delta }),
            onToolStep: (step) => send({ type: 'tool', step })
          }
        })
        full = result.text
        steps = result.steps
        if (result.usage) usage = result.usage

        if (full.trim()) {
          try {
            appendMessage(req.sessionId, {
              id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: full,
              createdAt: new Date().toISOString(),
              ...(steps.length ? { steps } : {})
            })
          } catch (err) {
            console.error('[ai] 保存助手消息失败:', err)
          }
        }
        try {
          appendUsage({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            providerId: provider.id,
            providerName: provider.name,
            model: agent.model,
            kind: 'chat',
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            at: new Date().toISOString()
          })
        } catch {
          /* 统计失败不影响对话 */
        }

        send({ type: 'done' })
        return { ok: true, text: full }
      } catch (err) {
        const message = err instanceof Error ? err.message : '生成失败'
        send({ type: 'error', message })
        return { ok: false, message, text: full }
      } finally {
        activeStreams.delete(req.requestId)
      }
    }
  )

  ipcMain.handle('ai:chat:abort', (_e, requestId: string) => {
    const controller = activeStreams.get(requestId)
    if (!controller) return false
    controller.abort()
    return true
  })
}

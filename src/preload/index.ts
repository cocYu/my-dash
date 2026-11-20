import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AiAgent,
  AiSessionMessage,
  AiSessionMeta,
  AiSessionPatch,
  AiSessionSearchHit,
  AiStreamEventPayload,
  AiStreamRequest,
  AiStreamResult,
  AiToolConfirmRequest,
  AiToolInfo
} from '../types/agent'
import type {
  AiChatRequest,
  AiChatResponse,
  AiHistoryImage,
  AiImageHistoryItem,
  AiImageRequest,
  AiImageResult,
  AiModel,
  AiPromptEnhanceRequest,
  AiProvider,
  AiQuotaInfo,
  AiUsageQuery,
  AiUsageSummary
} from '../types/ai'
import type { TransferFile, TransferStatus } from '../types/file-transfer'

export type {
  AiChatMessage,
  AiChatRequest,
  AiChatResponse,
  AiHistoryImage,
  AiImageHistoryItem,
  AiImageMode,
  AiImageRequest,
  AiImageResult,
  AiModel,
  AiPromptEnhanceRequest,
  AiProtocol,
  AiProvider,
  AiQuotaInfo,
  AiUsageQuery,
  AiUsageRecord,
  AiUsageSummary,
  AiVendorPreset
} from '../types/ai'

export type {
  AiAgent,
  AiReasoningEffort,
  AiSessionMessage,
  AiSessionMeta,
  AiSessionPatch,
  AiSessionSearchHit,
  AiStreamEvent,
  AiStreamEventPayload,
  AiStreamRequest,
  AiStreamResult,
  AiToolConfirmRequest,
  AiToolInfo,
  AiToolLevel,
  AiToolStep
} from '../types/agent'
export type { TransferFile, TransferStatus } from '../types/file-transfer'
export { AI_PRESETS } from '../types/ai'

export interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  main: string
  permissions: string[]
  source: 'dev' | 'user'
  enabled: boolean
  error?: string
}

/** 插件源（插件市场索引地址），落盘 userData/plugin-sources.json */
export interface PluginSourceConfig {
  id: string
  name: string
  url: string
  mirrors: string[]
  enabled: boolean
  builtin?: boolean
}

export interface RemoteRegistryEntryInfo {
  id: string
  name: string
  version: string
  description?: string
  category?: string
  downloadUrl: string
  mirrors?: string[]
  sha256?: string
  size?: number
}

/** 单个源的拉取状态（失败带 error，不影响其它源） */
export interface RemoteSourceStatus {
  sourceId: string
  sourceName: string
  sourceUrl: string
  ok: boolean
  error?: string
  entries: RemoteRegistryEntryInfo[]
}

/** 聚合后的市场条目：同 id 已按版本去重 */
export interface RemoteMarketEntry extends RemoteRegistryEntryInfo {
  sourceId: string
  sourceName: string
  sources: string[]
}

export interface RemoteListResponse {
  results: RemoteSourceStatus[]
  entries: RemoteMarketEntry[]
}

/** 导入 Markdown 的结果：用户取消 / 文件列表 / 目录树（含嵌套文件夹） */
export interface MdImportFile {
  title: string
  content: string
}
export interface MdImportNode {
  title: string
  note?: MdImportFile
  children?: MdImportNode[]
}
export type MdImportResult =
  | { canceled: true }
  | { files: MdImportFile[] }
  | { tree: MdImportNode[] }

const api = {
  /** 获取 Go 后端的访问配置（baseUrl + 本会话随机 token）与运行时信息 */
  getBackendConfig: (): Promise<{
    baseUrl: string
    token: string
    electronVersion: string
    appVersion: string
    userDataPath: string
  }> => ipcRenderer.invoke('backend:get-config'),
  /** 托盘"新建笔记"等主进程触发的快捷操作；返回取消监听函数 */
  onQuickCreate: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('notes:quick-create', listener)
    return () => ipcRenderer.removeListener('notes:quick-create', listener)
  },
  notesImport: {
    /** 弹系统对话框选择 Markdown 文件 / 文件夹（递归），返回待创建结构 */
    pick: (mode: 'files' | 'folder'): Promise<MdImportResult> =>
      ipcRenderer.invoke('notes:import-pick', mode)
  },
  mdThemes: {
    /** 用户导入的 Typora 主题（userData/md-themes/*.css） */
    list: (): Promise<{ name: string; size: number }[]> => ipcRenderer.invoke('md-themes:list'),
    read: (name: string): Promise<string> => ipcRenderer.invoke('md-themes:read', name),
    /** 弹对话框导入 .css；用户取消返回 null */
    importThemes: (): Promise<{ name: string; size: number }[] | null> =>
      ipcRenderer.invoke('md-themes:import'),
    remove: (name: string): Promise<{ name: string; size: number }[]> =>
      ipcRenderer.invoke('md-themes:remove', name)
  },
  attachments: {
    /** 图片字节入库（内容寻址），返回附件名（attach://<name>） */
    saveImage: (bytes: Uint8Array, ext: string): Promise<{ name: string }> =>
      ipcRenderer.invoke('attachments:save-image', { bytes, ext }),
    /** 系统对话框选图入库；取消返回 null */
    pickImage: (): Promise<{ name: string }[] | null> => ipcRenderer.invoke('attachments:pick-image'),
    /** 读取附件为 data URI（导出内嵌用） */
    readDataUrl: (name: string): Promise<string> => ipcRenderer.invoke('attachments:read-data-url', name),
    /** 复制附件图片到系统剪贴板 */
    copyImage: (name: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('attachments:copy-image', name),
    stats: (): Promise<{ count: number; bytes: number }> => ipcRenderer.invoke('attachments:stats'),
    openDir: (): Promise<void> => ipcRenderer.invoke('attachments:open-dir'),
    /** 清理未被任何笔记/版本引用的附件 */
    gc: (): Promise<{ deleted: number; freedBytes: number }> => ipcRenderer.invoke('attachments:gc')
  },
  /** 工具箱「文件互传」：局域网临时 HTTP 服务 */
  fileTransfer: {
    start: (): Promise<TransferStatus> => ipcRenderer.invoke('file-transfer:start'),
    stop: (): Promise<TransferStatus> => ipcRenderer.invoke('file-transfer:stop'),
    status: (): Promise<TransferStatus> => ipcRenderer.invoke('file-transfer:status'),
    list: (): Promise<TransferFile[]> => ipcRenderer.invoke('file-transfer:list'),
    remove: (name: string): Promise<TransferFile[]> => ipcRenderer.invoke('file-transfer:delete', name),
    clear: (): Promise<TransferFile[]> => ipcRenderer.invoke('file-transfer:clear'),
    openDir: (): Promise<void> => ipcRenderer.invoke('file-transfer:open-dir'),
    /** 选择自定义存放目录（弹系统对话框），返回最新状态 */
    chooseDir: (): Promise<{ ok: boolean; message?: string; status: TransferStatus }> =>
      ipcRenderer.invoke('file-transfer:choose-dir'),
    /** 恢复默认目录（userData/file-transfer） */
    resetDir: (): Promise<TransferStatus> => ipcRenderer.invoke('file-transfer:reset-dir'),
    /** 弹系统对话框选择文件，复制进互传目录（主动分享给对方） */
    addFiles: (): Promise<{ added: string[]; files: TransferFile[] }> =>
      ipcRenderer.invoke('file-transfer:add-files'),
    /** 拖拽入窗：传入文件真实路径，复制进互传目录 */
    addPaths: (paths: string[]): Promise<{ added: string[]; files: TransferFile[] }> =>
      ipcRenderer.invoke('file-transfer:add-paths', paths),
    /** 取拖拽 File 的真实路径（Electron 32+ 已移除 File.path） */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    /** 把收到的文件另存到用户指定位置 */
    saveAs: (name: string): Promise<{ ok: boolean; path?: string; message?: string }> =>
      ipcRenderer.invoke('file-transfer:save-as', name),
    /** 订阅文件列表变化（对端上传/删除），返回取消订阅函数 */
    onChange: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('file-transfer:changed', listener)
      return () => ipcRenderer.removeListener('file-transfer:changed', listener)
    }
  },
  plugins: {
    list: (): Promise<PluginInfo[]> => ipcRenderer.invoke('plugins:list'),
    setEnabled: (id: string, enabled: boolean): Promise<PluginInfo[]> =>
      ipcRenderer.invoke('plugins:set-enabled', id, enabled),
    /** data 为 .zip 文件内容 */
    importZip: (data: ArrayBuffer): Promise<{ id: string; name: string }> =>
      ipcRenderer.invoke('plugins:import', data),
    openDir: (): Promise<void> => ipcRenderer.invoke('plugins:open-dir'),
    /** 插件命名空间 KV：主进程按插件 ID 落 JSON 文件 */
    kv: (
      pluginId: string,
      op: 'get' | 'set' | 'remove' | 'keys',
      key?: string,
      value?: unknown
    ): Promise<unknown> => ipcRenderer.invoke('plugins:kv', { pluginId, op, key, value }),
    uninstall: (id: string): Promise<unknown> => ipcRenderer.invoke('plugins:uninstall', id),
    /** 插件市场索引：默认聚合全部启用的插件源；url / sourceIds 用于临时地址与单源自检 */
    remoteList: (opts?: { url?: string; sourceIds?: string[] }): Promise<RemoteListResponse> =>
      ipcRenderer.invoke('plugins:remote-list', opts),
    /** 远程下载安装（主地址失败自动切镜像，可选 sha256 校验，覆盖升级） */
    installRemote: (payload: { url: string; mirrors?: string[]; sha256?: string }): Promise<unknown> =>
      ipcRenderer.invoke('plugins:install-remote', payload),
    /** 插件源配置（多源，可增删改与启停） */
    sources: {
      list: (): Promise<PluginSourceConfig[]> => ipcRenderer.invoke('plugins:sources:list'),
      save: (list: PluginSourceConfig[]): Promise<PluginSourceConfig[]> =>
        ipcRenderer.invoke('plugins:sources:save', list),
      reset: (): Promise<PluginSourceConfig[]> => ipcRenderer.invoke('plugins:sources:reset')
    }
  },
  sync: {
    getConfig: (): Promise<unknown> => ipcRenderer.invoke('sync:get-config'),
    saveConfig: (cfg: unknown): Promise<void> => ipcRenderer.invoke('sync:save-config', cfg),
    testConnection: (cfg: unknown): Promise<void> => ipcRenderer.invoke('sync:test-connection', cfg),
    run: (): Promise<unknown> => ipcRenderer.invoke('sync:run'),
    restore: (remoteFile: string): Promise<unknown> => ipcRenderer.invoke('sync:restore', remoteFile),
    getHistory: (): Promise<unknown[]> => ipcRenderer.invoke('sync:history'),
    /** 列举云端实际存在的备份（换新设备时拉取可还原的备份列表） */
    listRemote: (): Promise<unknown[]> => ipcRenderer.invoke('sync:list-remote')
  },
  notify: {
    getConfig: (): Promise<unknown> => ipcRenderer.invoke('notify:get-config'),
    saveConfig: (cfg: unknown): Promise<void> => ipcRenderer.invoke('notify:save-config', cfg),
    /** 用表单当前值向指定渠道发一条测试消息（不要求先保存） */
    testChannel: (id: string, cfg: unknown): Promise<void> => ipcRenderer.invoke('notify:test-channel', id, cfg),
    /** 手动触发一轮提醒检查（调试 / e2e 用，免去等待周期 tick） */
    runCheck: (): Promise<{ channels: number; events: number }> => ipcRenderer.invoke('notify:run-check')
  },
  settings: {
    getLoginItem: (): Promise<{ openAtLogin: boolean }> =>
      ipcRenderer.invoke('settings:get-login-item'),
    setLoginItem: (open: boolean): Promise<void> =>
      ipcRenderer.invoke('settings:set-login-item', open)
  },
  /** 系统交互：仅允许 http/https 外链交给默认浏览器 */
  shell: {
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url)
  },
  /** AI 工作台：供应商配置 / 统一网关 / 生图 / 历史 / 提示词增强 */
  ai: {
    providers: {
      list: (): Promise<AiProvider[]> => ipcRenderer.invoke('ai:providers:list'),
      save: (list: AiProvider[]): Promise<AiProvider[]> => ipcRenderer.invoke('ai:providers:save', list),
      fetchModels: (id: string): Promise<AiModel[]> => ipcRenderer.invoke('ai:providers:fetch-models', id),
      test: (id: string): Promise<{ models: number }> => ipcRenderer.invoke('ai:providers:test', id)
    },
    chat: (req: AiChatRequest): Promise<AiChatResponse> => ipcRenderer.invoke('ai:chat', req),
    generateImage: (req: AiImageRequest): Promise<AiImageResult[]> =>
      ipcRenderer.invoke('ai:image:generate', req),
    history: {
      list: (): Promise<AiImageHistoryItem[]> => ipcRenderer.invoke('ai:history:list'),
      delete: (id: string): Promise<AiImageHistoryItem[]> => ipcRenderer.invoke('ai:history:delete', id),
      clear: (): Promise<AiImageHistoryItem[]> => ipcRenderer.invoke('ai:history:clear')
    },
    /** 用指定供应商模型优化提示词，返回增强后的纯文本 */
    enhancePrompt: (req: AiPromptEnhanceRequest): Promise<string> =>
      ipcRenderer.invoke('ai:prompt:enhance', req),
    /** 查询供应商额度（OpenAI Billing / new-api 兼容） */
    quota: (id: string): Promise<AiQuotaInfo> => ipcRenderer.invoke('ai:quota', id),
    /** 某供应商最近一次调用时间 ISO，无记录返回 null */
    lastCall: (id: string): Promise<string | null> => ipcRenderer.invoke('ai:last-call', id),
    /** 按日期 / 日期范围查询 token 消耗 */
    usage: (query: AiUsageQuery): Promise<AiUsageSummary> => ipcRenderer.invoke('ai:usage', query),

    // ---- 自定义 Agent ----
    agents: {
      list: (): Promise<AiAgent[]> => ipcRenderer.invoke('ai:agents:list'),
      save: (agent: AiAgent): Promise<AiAgent[]> => ipcRenderer.invoke('ai:agents:save', agent),
      remove: (id: string): Promise<AiAgent[]> => ipcRenderer.invoke('ai:agents:remove', id)
    },
    /** 工具目录 + 新建助手默认启用的只读工具 */
    tools: {
      list: (): Promise<{ tools: AiToolInfo[]; defaults: string[] }> =>
        ipcRenderer.invoke('ai:tools:list')
    },
    sessions: {
      list: (agentId?: string): Promise<AiSessionMeta[]> => ipcRenderer.invoke('ai:sessions:list', agentId),
      create: (agentId: string): Promise<AiSessionMeta> => ipcRenderer.invoke('ai:sessions:create', agentId),
      delete: (id: string): Promise<boolean> => ipcRenderer.invoke('ai:sessions:delete', id),
      rename: (id: string, title: string): Promise<AiSessionMeta[]> =>
        ipcRenderer.invoke('ai:sessions:rename', id, title),
      /** 更新会话级设置（模型 / 思考强度覆盖）与上下文摘要 */
      update: (id: string, patch: AiSessionPatch): Promise<AiSessionMeta | null> =>
        ipcRenderer.invoke('ai:sessions:update', id, patch),
      messages: (id: string): Promise<AiSessionMessage[]> => ipcRenderer.invoke('ai:sessions:messages', id),
      /** 在会话消息正文中搜索关键词，按会话聚合返回命中片段 */
      search: (query: string, agentId?: string): Promise<AiSessionSearchHit[]> =>
        ipcRenderer.invoke('ai:sessions:search', query, agentId)
    },
    /** 发起流式对话；文本增量经 onStreamEvent 推送 */
    streamChat: (req: AiStreamRequest): Promise<AiStreamResult> => ipcRenderer.invoke('ai:chat:stream', req),
    abortStream: (requestId: string): Promise<boolean> => ipcRenderer.invoke('ai:chat:abort', requestId),
    /** 订阅流事件，返回取消订阅函数 */
    onStreamEvent: (cb: (payload: AiStreamEventPayload) => void): (() => void) => {
      const listener = (_e: unknown, payload: AiStreamEventPayload): void => cb(payload)
      ipcRenderer.on('ai:stream:event', listener)
      return () => ipcRenderer.removeListener('ai:stream:event', listener)
    },
    /** 写操作确认：回传用户选择（允许 / 拒绝） */
    confirmTool: (requestId: string, approved: boolean): Promise<boolean> =>
      ipcRenderer.invoke('ai:tool:confirm-response', requestId, approved),
    /** 订阅写操作确认请求，返回取消订阅函数 */
    onToolConfirm: (cb: (req: AiToolConfirmRequest) => void): (() => void) => {
      const listener = (_e: unknown, payload: AiToolConfirmRequest): void => cb(payload)
      ipcRenderer.on('ai:tool:confirm', listener)
      return () => ipcRenderer.removeListener('ai:tool:confirm', listener)
    }
  },
  exporter: {
    /** 文本类导出（Markdown / HTML）：弹保存对话框并写文件 */
    saveText: (payload: {
      defaultName: string
      filterName: string
      ext: string
      data: string
    }): Promise<{ saved: boolean; filePath?: string }> =>
      ipcRenderer.invoke('export:save-text', payload),
    /** PDF 导出：隐藏窗口渲染 HTML 后 printToPDF */
    savePdf: (payload: { defaultName: string; html: string }): Promise<{ saved: boolean; filePath?: string }> =>
      ipcRenderer.invoke('export:save-pdf', payload)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

declare global {
  interface Window {
    api: Api
  }
}

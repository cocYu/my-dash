import { contextBridge, ipcRenderer } from 'electron'

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
    stats: (): Promise<{ count: number; bytes: number }> => ipcRenderer.invoke('attachments:stats'),
    openDir: (): Promise<void> => ipcRenderer.invoke('attachments:open-dir'),
    /** 清理未被任何笔记/版本引用的附件 */
    gc: (): Promise<{ deleted: number; freedBytes: number }> => ipcRenderer.invoke('attachments:gc')
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
    /** 远程工具索引（不传 url 用仓库内置地址） */
    remoteList: (url?: string): Promise<unknown> => ipcRenderer.invoke('plugins:remote-list', url),
    /** 远程下载安装（可选 sha256 校验，覆盖升级） */
    installRemote: (payload: { url: string; sha256?: string }): Promise<unknown> =>
      ipcRenderer.invoke('plugins:install-remote', payload)
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
  settings: {
    getLoginItem: (): Promise<{ openAtLogin: boolean }> =>
      ipcRenderer.invoke('settings:get-login-item'),
    setLoginItem: (open: boolean): Promise<void> =>
      ipcRenderer.invoke('settings:set-login-item', open)
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

// 插件全局快捷键：globalShortcut 封装。插件（screenshot-tool 等）经 window.api.shortcuts
// 注册系统级快捷键，触发后由主进程直接执行对应动作（如启动区域截图遮罩），
// 不依赖主窗是否聚焦。生命周期：应用退出统一注销；插件禁用/卸载时由 manager 调
// releasePluginShortcuts 清理；重载/升级无需处理——快捷键只记插件 id，遮罩页每次从磁盘加载。
import { globalShortcut, ipcMain } from 'electron'
import { beginRegionCapture } from './capture'

export interface ShortcutEntry {
  pluginId: string
  action: 'capture-region'
  accelerator: string
}

/** 菜单栏保留加速键（src/main/menu.ts），全局快捷键不允许占用 */
const RESERVED = new Set(['CmdOrCtrl+Shift+S', 'CmdOrCtrl+Shift+H', 'CmdOrCtrl+Shift+Q'])

/** 加速键归一化：CommandOrControl 与 CmdOrCtrl 等价，统一比较与存储 */
function normAccelerator(acc: string): string {
  return acc.trim().replace(/^CommandOrControl/i, 'CmdOrCtrl')
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

/** pluginId → 已注册快捷键（每插件至多一条，重复注册覆盖） */
const registered = new Map<string, ShortcutEntry>()

function unregisterEntry(entry: ShortcutEntry): void {
  try {
    globalShortcut.unregister(entry.accelerator)
  } catch {
    /* 加速键已失效则忽略 */
  }
}

/** 插件禁用/卸载时清理其全局快捷键（manager.ts 调用） */
export function releasePluginShortcuts(pluginId: string): void {
  const entry = registered.get(pluginId)
  if (!entry) return
  unregisterEntry(entry)
  registered.delete(pluginId)
}

/** 应用退出前统一注销 */
export function releaseAllShortcuts(): void {
  for (const entry of registered.values()) unregisterEntry(entry)
  registered.clear()
}

export function registerShortcutsIpc(): void {
  ipcMain.handle(
    'shortcuts:register',
    (_e, payload: { pluginId: string; action: string; accelerator: string }): { ok: boolean; error?: string } => {
      const { pluginId } = payload ?? {}
      const accelerator = normAccelerator(typeof payload?.accelerator === 'string' ? payload.accelerator : '')
      if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) throw new Error('非法插件标识')
      if (payload?.action !== 'capture-region') throw new Error('不支持的动作类型')
      if (!accelerator) throw new Error('快捷键不能为空')
      if (RESERVED.has(accelerator)) {
        return { ok: false, error: `「${accelerator}」为应用保留快捷键，请换一个组合` }
      }
      // 覆盖注册：清掉本插件旧键；同键被其他插件占用时后注册者抢占
      for (const [pid, entry] of [...registered]) {
        if (pid === pluginId || entry.accelerator === accelerator) releasePluginShortcuts(pid)
      }
      let ok = false
      try {
        ok = globalShortcut.register(accelerator, () => {
          beginRegionCapture(pluginId).catch((err) => {
            console.error(`[shortcuts] 触发 ${pluginId} 区域截图失败:`, err)
          })
        })
      } catch {
        ok = false
      }
      if (!ok) return { ok: false, error: '快捷键注册失败（可能已被其他应用占用）' }
      registered.set(pluginId, { pluginId, action: 'capture-region', accelerator })
      return { ok: true }
    }
  )

  ipcMain.handle('shortcuts:unregister', (_e, pluginId: string) => {
    releasePluginShortcuts(String(pluginId))
    return { ok: true }
  })

  ipcMain.handle('shortcuts:list', (): ShortcutEntry[] => [...registered.values()])
}

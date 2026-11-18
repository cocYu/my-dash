import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { startBackend, stopBackend } from './backend'
import { registerAttachmentsIpc, registerAttachmentsProtocol } from './attachments'
import { registerAiIpc } from './ai/ipc'
import { registerExporterIpc } from './exporter'
import { createAppMenu } from './menu'
import { registerMdThemesIpc } from './md-themes'
import { registerNotesImportIpc } from './notes-import'
import { createTray, destroyTray, updateTrayMenu } from './tray'
import { initPluginManager, registerPluginIpc, registerPluginProtocol } from './plugins/manager'
import { buildTestMessage, sendToChannel } from './notify/channels'
import { readNotifyConfig, writeNotifyConfig } from './notify/config'
import type { NotifyChannelId } from '../types/notify'
import { runNotifyCheck, startNotifyScheduler, type NotifyContext } from './notify/scheduler'
import * as cloud from './sync/cloud'
import { readConfig, writeConfig } from './sync/config'
import { startScheduler } from './sync/scheduler'
import { getHistory, listRemoteBackups, restoreFromRecord, runSync, type SyncContext } from './sync/service'
// 副作用导入：plugin:// 协议特权声明必须在 app ready 前执行
import './protocol-scheme'

// 数据目录固定沿用 mydash：应用显示名改为 AtoZ 后，Electron 默认会把 userData 切到
// %APPDATA%/AtoZ，导致现有数据库/附件/AI 配置（都在 %APPDATA%/mydash）读不到。
// 显示名与数据目录解耦，老用户升级后数据无缝。必须在任何 getPath('userData') 之前执行。
app.setPath('userData', path.join(app.getPath('appData'), 'mydash'))

let mainWindow: BrowserWindow | null = null
let backendBaseUrl = ''
// 关窗到托盘：X 触发的 close 被拦截为 hide；before-quit（Cmd+Q/托盘退出/菜单退出）放行
let isQuitting = false

// 可选：设置 MYDASH_DEBUG_PORT 后可用 DevTools 协议（如 Playwright）连接窗口做自动化验证。
// appendSwitch 必须在 app ready 之前调用；同时激活 UIA 无障碍桥，便于原生自动化（computer-use）观察
const debugPort = process.env.MYDASH_DEBUG_PORT
if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
  app.commandLine.appendSwitch('force-renderer-accessibility')
}

// Windows 桌面通知（系统通知渠道）需要与 appId 一致的 AppUserModelId；dev 下用进程路径
app.setAppUserModelId(app.isPackaged ? 'com.mydash.desktop' : process.execPath)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例在运行，避免两个进程争抢同一个 SQLite 库
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(bootstrap)

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    isQuitting = true
  })
  app.on('will-quit', () => {
    destroyTray()
    stopBackend()
  })
}

async function bootstrap(): Promise<void> {
  const port = await getFreePort()
  const token = randomBytes(32).toString('hex')
  const dbPath = path.join(app.getPath('userData'), 'mydash.db')
  console.log(`[main] 端口=${port} 数据库=${dbPath}`)

  try {
    await startBackend({ port, dbPath, token })
  } catch (err) {
    dialog.showErrorBox('后端服务启动失败', String(err))
    app.quit()
    return
  }

  backendBaseUrl = `http://127.0.0.1:${port}`
  ipcMain.handle('backend:get-config', () => ({
    baseUrl: backendBaseUrl,
    token,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion(),
    userDataPath: app.getPath('userData')
  }))

  // 设置页：开机自启（与托盘 checkbox 共用同一状态源，变更后同步托盘菜单）
  ipcMain.handle('settings:get-login-item', () => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin
  }))
  ipcMain.handle('settings:set-login-item', (_e, open: boolean) => {
    app.setLoginItemSettings({ openAtLogin: open })
    updateTrayMenu(() => mainWindow)
  })

  // Markdown 渲染结果里的外链：只放行 http/https，交系统浏览器打开，绝不在应用内导航
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  // 数据同步
  const syncContext: SyncContext = { baseUrl: backendBaseUrl, token, dbPath }
  ipcMain.handle('sync:get-config', () => readConfig())
  ipcMain.handle('sync:save-config', (_e, cfg) => {
    writeConfig(cfg)
  })
  ipcMain.handle('sync:test-connection', (_e, cfg) => cloud.cloudTest(cfg))
  ipcMain.handle('sync:run', () => runSync(syncContext, 'manual'))
  ipcMain.handle('sync:restore', (_e, remoteFile: string) => restoreFromRecord(syncContext, remoteFile))
  ipcMain.handle('sync:history', () => getHistory())
  ipcMain.handle('sync:list-remote', () => listRemoteBackups())
  startScheduler(() => runSync(syncContext, 'scheduled'))

  // 待办超时通知（配置在设置页「通知提醒」）
  const notifyContext: NotifyContext = { baseUrl: backendBaseUrl, token }
  ipcMain.handle('notify:get-config', () => readNotifyConfig())
  ipcMain.handle('notify:save-config', (_e, cfg) => {
    writeNotifyConfig(cfg)
  })
  ipcMain.handle('notify:test-channel', (_e, id: NotifyChannelId, cfg) => sendToChannel(id, cfg, buildTestMessage(id)))
  ipcMain.handle('notify:run-check', () => runNotifyCheck(notifyContext))
  startNotifyScheduler(notifyContext)
  registerExporterIpc()
  registerNotesImportIpc()
  registerMdThemesIpc()
  registerAttachmentsIpc({ baseUrl: backendBaseUrl, token })
  registerAttachmentsProtocol()
  // AI 工作台（供应商配置加密落盘，网关层兼容 chat/responses/messages）
  // 工具层需要直连本机后端，传入 baseUrl 与访问令牌
  registerAiIpc({ baseUrl: backendBaseUrl, token })

  createWindow()
  createAppMenu(() => mainWindow)
  createTray(() => mainWindow)

  // 插件系统：协议 handler + IPC + 首次扫描
  registerPluginProtocol()
  initPluginManager()
  registerPluginIpc()
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    title: 'AtoZ',
    // 开发期窗口/任务栏图标；打包后由 exe 内嵌图标接管
    icon: path.join(app.getAppPath(), 'resources', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 点 X：隐藏到托盘而非退出（before-quit 已置 isQuitting 时放行）
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('show', () => updateTrayMenu(() => mainWindow))
  mainWindow.on('hide', () => updateTrayMenu(() => mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 兜底：任何试图在应用内打开的外链都转到系统浏览器，避免整页被导航走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'] ?? ''
    if (devUrl && url.startsWith(devUrl)) return
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { startBackend, stopBackend } from './backend'
import { registerAttachmentsIpc, registerAttachmentsProtocol } from './attachments'
import { registerExporterIpc } from './exporter'
import { createAppMenu } from './menu'
import { registerMdThemesIpc } from './md-themes'
import { registerNotesImportIpc } from './notes-import'
import { createTray, destroyTray, updateTrayMenu } from './tray'
import { initPluginManager, registerPluginIpc, registerPluginProtocol } from './plugins/manager'
import * as cloud from './sync/cloud'
import { readConfig, writeConfig } from './sync/config'
import { startScheduler } from './sync/scheduler'
import { getHistory, listRemoteBackups, restoreFromRecord, runSync, type SyncContext } from './sync/service'
// 副作用导入：plugin:// 协议特权声明必须在 app ready 前执行
import './protocol-scheme'

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
  registerExporterIpc()
  registerNotesImportIpc()
  registerMdThemesIpc()
  registerAttachmentsIpc({ baseUrl: backendBaseUrl, token })
  registerAttachmentsProtocol()

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
    title: 'myDash',
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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

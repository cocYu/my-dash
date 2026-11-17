// Package tray: 系统托盘。
// 平台差异（详见 README 行为矩阵）：
//   - 图标：win=tray.ico(16/24/32) / mac=trayTemplate.png(+@2x，黑+alpha 自动适配深浅色) / linux=tray.png(22px)
//   - 点击：win 左键 toggle 窗口；mac 靠 setContextMenu 默认弹菜单（菜单栏惯例）；
//           linux 的 AppIndicator 不投递 click 事件，右键菜单是唯一可靠入口
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import path from 'node:path'
import { showAbout, showMainWindow } from './menu'

let tray: Tray | null = null

export function resolveIconsDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'icons')
  return path.join(app.getAppPath(), 'resources', 'icons')
}

function loadTrayIcon(): Electron.NativeImage {
  const dir = resolveIconsDir()
  switch (process.platform) {
    case 'darwin':
      return nativeImage.createFromPath(path.join(dir, 'trayTemplate.png'))
    case 'win32':
      return nativeImage.createFromPath(path.join(dir, 'tray.ico'))
    default:
      return nativeImage.createFromPath(path.join(dir, 'tray.png'))
  }
}

function isWindowUp(win: BrowserWindow | null): boolean {
  return !!win && win.isVisible() && !win.isMinimized()
}

function toggleMainWindow(win: BrowserWindow | null): void {
  if (!win) return
  if (isWindowUp(win)) {
    win.hide()
  } else {
    showMainWindow(win)
  }
}

/** 托盘"新建笔记"：唤醒窗口并通知渲染层打开新增弹窗 */
function quickCreateNote(win: BrowserWindow | null): void {
  if (!win) return
  showMainWindow(win)
  win.webContents.send('notes:quick-create')
}

/** 重建托盘菜单（窗口 show/hide 与自启切换时调用，保证文案与勾选态最新） */
export function updateTrayMenu(getWindow: () => BrowserWindow | null): void {
  if (!tray) return
  const win = getWindow()
  const menu = Menu.buildFromTemplate([
    {
      label: isWindowUp(win) ? '隐藏主窗口' : '显示主窗口',
      click: () => toggleMainWindow(getWindow())
    },
    { label: '新建笔记', click: () => quickCreateNote(getWindow()) },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked })
      }
    },
    { label: '关于 myDash', click: () => void showAbout() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

export function createTray(getWindow: () => BrowserWindow | null): void {
  tray = new Tray(loadTrayIcon())
  tray.setToolTip('myDash')
  updateTrayMenu(getWindow)
  console.log(`[main] 托盘已创建，图标目录: ${resolveIconsDir()}`)

  // 仅 Windows 左键单击 toggle 窗口；mac 弹菜单依赖 setContextMenu；linux 无 click 事件
  if (process.platform === 'win32') {
    tray.on('click', () => toggleMainWindow(getWindow()))
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

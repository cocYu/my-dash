// Package menu: 应用菜单（macOS 屏幕顶部 / Windows+Linux 窗口内 Alt 唤出）。
import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/** 显示并聚焦主窗口（托盘/菜单/second-instance 共用） */
export function showMainWindow(win: BrowserWindow | null): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 关于对话框（Windows/Linux 与托盘共用；macOS 走系统关于面板） */
export async function showAbout(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: '关于 myDash',
    message: `myDash v${app.getVersion()}`,
    detail:
      'Electron + Go + SQLite 桌面应用骨架\n' +
      `Electron ${process.versions.electron} · Node ${process.versions.node}\n` +
      `数据目录：${app.getPath('userData')}`,
    buttons: ['好'],
    noLink: true
  })
}

export function createAppMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin'

  if (isMac) {
    // macOS 菜单栏必须含 appMenu（否则 Cmd+Q 失效）与 editMenu（否则输入框 Cmd+C/V 失效）
    app.setAboutPanelOptions({
      applicationName: app.getName(),
      applicationVersion: app.getVersion(),
      credits: 'Electron + Go + SQLite 桌面应用骨架'
    })
    const template: MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      { role: 'help', submenu: [{ label: '关于 myDash', role: 'about' }] }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    return
  }

  // Windows / Linux：精简菜单，窗口上 autoHideMenuBar 默认隐藏，按 Alt 唤出
  const aboutItem: MenuItemConstructorOptions = {
    label: '关于 myDash',
    click: () => void showAbout()
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件(&F)',
      submenu: [
        {
          label: '显示主窗口',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => showMainWindow(getWindow())
        },
        { label: '隐藏到托盘', accelerator: 'CmdOrCtrl+Shift+H', click: () => getWindow()?.hide() },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    { role: 'editMenu', label: '编辑(&E)' },
    { role: 'viewMenu', label: '视图(&V)' },
    { label: '帮助(&H)', submenu: [aboutItem] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

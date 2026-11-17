// 导出：保存文本文件与 PDF（经系统保存对话框）。
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'

export function registerExporterIpc(): void {
  // 文本类导出（Markdown / HTML）
  ipcMain.handle(
    'export:save-text',
    async (_e, payload: { defaultName: string; filterName: string; ext: string; data: string }) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: payload.defaultName,
        filters: [{ name: payload.filterName, extensions: [payload.ext] }]
      })
      if (canceled || !filePath) return { saved: false }
      await fsp.writeFile(filePath, payload.data, 'utf-8')
      return { saved: true, filePath }
    }
  )

  // PDF：隐藏窗口渲染 HTML 后 printToPDF
  ipcMain.handle(
    'export:save-pdf',
    async (_e, payload: { defaultName: string; html: string }) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: payload.defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { saved: false }

      const tmp = path.join(app.getPath('temp'), `mydash-export-${Date.now()}.html`)
      await fsp.writeFile(tmp, payload.html, 'utf-8')
      const bw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        await bw.loadFile(tmp)
        const pdf = await bw.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.6, bottom: 0.6, left: 0.5, right: 0.5 },
          // 由 h1–h6 生成 PDF 书签大纲（WPS/Acrobat 左侧书签栏可见）与带标签（可访问性）PDF
          generateDocumentOutline: true,
          generateTaggedPDF: true
        })
        await fsp.writeFile(filePath, pdf)
      } finally {
        bw.destroy()
      }
      return { saved: true, filePath }
    }
  )
}

/** 文件互传：局域网内起临时 HTTP 服务，对端浏览器扫码即可上传/下载。
 *
 * 设计取舍：
 * - 上传走 PUT 原始流（不用 multipart），零依赖、无解析失败风险；对端页面用 XHR 带进度。
 * - 访问码放在 URL 的 ?k= 里，页面内所有请求自动携带；同网段其他人没有码进不来。
 * - 先写 .part 再改名为正式文件，列表与下载永不出现半截文件。
 * - 服务只在用户手动启动后运行，退出应用时自动关闭。
 */
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import QRCode from 'qrcode'
import type { TransferFile, TransferStatus } from '../types/file-transfer'

/** 单文件上限：1GB */
const MAX_FILE = 1024 * 1024 * 1024
const PART_SUFFIX = '.part'

let server: http.Server | null = null
let port = 0
let token = ''
let qrDataUrl = ''

/** 用户自定义目录；空串表示用默认的 userData/file-transfer */
let customDir = ''
let customDirLoaded = false

function configFile(): string {
  return path.join(app.getPath('userData'), 'file-transfer-config.json')
}

function loadCustomDir(): string {
  if (customDirLoaded) return customDir
  customDirLoaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf-8')) as { dir?: unknown }
    if (typeof raw?.dir === 'string' && path.isAbsolute(raw.dir.trim())) {
      customDir = raw.dir.trim()
    }
  } catch {
    /* 无配置或损坏：用默认目录 */
  }
  return customDir
}

function saveCustomDir(dir: string): void {
  customDir = dir
  customDirLoaded = true
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true })
    fs.writeFileSync(configFile(), JSON.stringify({ dir }, null, 2), 'utf-8')
  } catch (err) {
    console.error('[file-transfer] 保存目录配置失败:', err)
  }
}

function defaultDir(): string {
  return path.join(app.getPath('userData'), 'file-transfer')
}

/** 当前生效的互传目录：自定义优先，否则默认 */
function transferDir(): string {
  const dir = loadCustomDir() || defaultDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 目录可写性校验：建目录 + 写探针文件再删，失败即不可用 */
function ensureWritable(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  const probe = path.join(dir, `.write-check-${Date.now()}`)
  fs.writeFileSync(probe, 'ok')
  fs.unlinkSync(probe)
}

/** 去掉路径与控制字符，只保留一个安全文件名 */
function safeName(raw: string): string {
  const normalized = raw.replace(/\\/g, '/')
  const base = path.basename(normalized)
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  const trimmed = cleaned.slice(0, 160)
  return trimmed || `file-${Date.now()}`
}

/** 重名自动加 (1)(2)，避免覆盖已收文件 */
function uniqueName(name: string): string {
  const dir = transferDir()
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = name
  let i = 1
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${i})${ext}`
    i++
  }
  return candidate
}

function listFiles(): TransferFile[] {
  const dir = transferDir()
  const out: TransferFile[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith(PART_SUFFIX)) continue
    const full = path.join(dir, entry.name)
    try {
      const st = fs.statSync(full)
      out.push({ name: entry.name, size: st.size, modifiedAt: st.mtime.toISOString() })
    } catch {
      /* 文件在扫描期间被删除，忽略 */
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

/** 局域网 IPv4 地址，常见私有网段优先 */
function lanAddresses(): string[] {
  const all: string[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (info.address.startsWith('169.254.')) continue
      all.push(info.address)
    }
    void name
  }
  const isPrivate = (ip: string): boolean =>
    ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  const priv = all.filter(isPrivate).sort()
  const rest = all.filter((ip) => !isPrivate(ip)).sort()
  return [...priv, ...rest]
}

function buildUrls(): string[] {
  if (!port || !token) return []
  return lanAddresses().map((ip) => `http://${ip}:${port}/?k=${token}`)
}

function status(): TransferStatus {
  return {
    running: Boolean(server),
    port: server ? port : 0,
    token: server ? token : '',
    urls: buildUrls(),
    qrDataUrl,
    dir: transferDir(),
    defaultDir: defaultDir(),
    customDir: loadCustomDir(),
    fileCount: listFiles().length
  }
}

function notifyRenderer(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('file-transfer:changed')
  }
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(text)
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
}

function handleUpload(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_FILE) {
    sendJson(res, 413, { error: '文件超过 1GB 上限' })
    req.resume()
    return
  }

  const rawName = url.searchParams.get('name') ?? ''
  if (!rawName) {
    sendJson(res, 400, { error: '缺少文件名' })
    req.resume()
    return
  }

  const finalName = uniqueName(safeName(rawName))
  const dir = transferDir()
  const partPath = path.join(dir, `${finalName}${PART_SUFFIX}`)
  const finalPath = path.join(dir, finalName)
  const ws = fs.createWriteStream(partPath)

  let received = 0
  let aborted = false
  let replied = false

  const fail = (code: number, message: string): void => {
    if (replied) return
    replied = true
    aborted = true
    ws.destroy()
    fs.promises.unlink(partPath).catch(() => undefined)
    if (!res.headersSent) sendJson(res, code, { error: message })
    else res.end()
  }

  req.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (received > MAX_FILE) {
      fail(413, '文件超过 1GB 上限')
      req.destroy()
    }
  })

  req.on('aborted', () => fail(400, '上传被中断'))
  req.on('error', () => fail(400, '上传出错'))
  ws.on('error', () => fail(500, '写入文件失败'))

  ws.on('finish', () => {
    if (replied) return
    if (received === 0) {
      replied = true
      fs.promises.unlink(partPath).catch(() => undefined)
      sendJson(res, 400, { error: '文件内容为空' })
      return
    }
    try {
      fs.renameSync(partPath, finalPath)
    } catch {
      replied = true
      fs.promises.unlink(partPath).catch(() => undefined)
      sendJson(res, 500, { error: '保存文件失败' })
      return
    }
    replied = true
    sendJson(res, 200, { name: finalName, size: received })
    notifyRenderer()
  })

  req.pipe(ws)
}

function handleDownload(req: http.IncomingMessage, res: http.ServerResponse, name: string): void {
  const dir = transferDir()
  const target = path.join(dir, safeName(name))
  // 防路径穿越：解析后必须仍在互传目录内
  if (path.dirname(path.resolve(target)) !== path.resolve(dir)) {
    sendJson(res, 400, { error: '非法文件名' })
    return
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendJson(res, 404, { error: '文件不存在' })
    return
  }
  const stat = fs.statSync(target)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(stat.size),
    // RFC 5987：中文文件名必须走 filename*
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`
  })
  const rs = fs.createReadStream(target)
  rs.on('error', () => res.end())
  rs.pipe(res)
  void req
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const key = url.searchParams.get('k') ?? String(req.headers['x-transfer-token'] ?? '')
  if (key !== token) {
    sendJson(res, 403, { error: '访问码无效，请重新扫码' })
    return
  }

  const pathname = url.pathname

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    sendHtml(res, pageHtml())
    return
  }

  if (req.method === 'GET' && pathname === '/api/files') {
    sendJson(res, 200, { files: listFiles() })
    return
  }

  if (req.method === 'PUT' && pathname === '/upload') {
    handleUpload(req, res, url)
    return
  }

  if (pathname.startsWith('/f/')) {
    const name = decodeURIComponent(pathname.slice(3))
    if (req.method === 'GET' || req.method === 'HEAD') {
      handleDownload(req, res, name)
      return
    }
    if (req.method === 'DELETE') {
      const target = path.join(transferDir(), safeName(name))
      try {
        fs.unlinkSync(target)
        notifyRenderer()
        sendJson(res, 200, { ok: true })
      } catch {
        sendJson(res, 404, { error: '文件不存在' })
      }
      return
    }
  }

  sendJson(res, 404, { error: 'not found' })
}

async function start(): Promise<TransferStatus> {
  if (server && port) return status()

  token = randomBytes(8).toString('hex')
  const instance = http.createServer((req, res) => {
    try {
      handleRequest(req, res)
    } catch (err) {
      console.error('[file-transfer] 请求处理失败:', err)
      if (!res.headersSent) sendJson(res, 500, { error: '服务内部错误' })
      else res.end()
    }
  })

  await new Promise<void>((resolve, reject) => {
    instance.once('error', reject)
    instance.listen(0, '0.0.0.0', () => {
      instance.removeListener('error', reject)
      port = (instance.address() as AddressInfo).port
      server = instance
      resolve()
    })
  })

  const firstUrl = buildUrls()[0]
  qrDataUrl = firstUrl ? await QRCode.toDataURL(firstUrl, { margin: 1, width: 240 }) : ''
  notifyRenderer()
  return status()
}

async function stop(): Promise<TransferStatus> {
  const instance = server
  server = null
  port = 0
  qrDataUrl = ''
  if (instance) {
    await new Promise<void>((resolve) => instance.close(() => resolve()))
  }
  notifyRenderer()
  return status()
}

/** 把本地文件复制进互传目录（源文件不动），返回新增的文件名 */
async function addPathsToShare(sources: string[]): Promise<string[]> {
  const dir = transferDir()
  const resolvedDir = path.resolve(dir)
  const added: string[] = []
  for (const src of sources) {
    try {
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
      // 已经在互传目录里的文件跳过：避免 copyFile 到自身
      if (path.dirname(path.resolve(src)) === resolvedDir) continue
      const name = uniqueName(safeName(path.basename(src)))
      await fs.promises.copyFile(src, path.join(dir, name))
      added.push(name)
    } catch (err) {
      console.error('[file-transfer] 添加文件失败:', src, err)
    }
  }
  if (added.length) notifyRenderer()
  return added
}

export function registerFileTransferIpc(): void {
  ipcMain.handle('file-transfer:start', () => start())
  ipcMain.handle('file-transfer:stop', () => stop())
  ipcMain.handle('file-transfer:status', () => status())
  ipcMain.handle('file-transfer:list', () => listFiles())
  ipcMain.handle('file-transfer:delete', (_e, name: string) => {
    const target = path.join(transferDir(), safeName(name))
    if (path.dirname(path.resolve(target)) === path.resolve(transferDir()) && fs.existsSync(target)) {
      fs.unlinkSync(target)
    }
    return listFiles()
  })
  ipcMain.handle('file-transfer:clear', () => {
    const dir = transferDir()
    for (const file of listFiles()) {
      try {
        fs.unlinkSync(path.join(dir, file.name))
      } catch {
        /* 单个删除失败不影响其余 */
      }
    }
    return listFiles()
  })
  ipcMain.handle('file-transfer:open-dir', async () => {
    await shell.openPath(transferDir())
  })

  // 自定义存放目录：选目录 → 校验可写 → 落配置，运行中立即生效（旧文件留在原处）
  ipcMain.handle('file-transfer:choose-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择互传文件存放目录',
      buttonLabel: '使用此目录',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return { ok: false, status: status() }

    const chosen = path.resolve(result.filePaths[0])
    if (chosen === path.resolve(defaultDir())) {
      saveCustomDir('')
      notifyRenderer()
      return { ok: true, status: status() }
    }
    try {
      ensureWritable(chosen)
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? `该目录不可写：${err.message}` : '该目录不可写',
        status: status()
      }
    }
    saveCustomDir(chosen)
    notifyRenderer()
    return { ok: true, status: status() }
  })

  ipcMain.handle('file-transfer:reset-dir', () => {
    saveCustomDir('')
    notifyRenderer()
    return status()
  })

  // 主动分享：选本地文件复制进互传目录，对端页面立即可见
  ipcMain.handle('file-transfer:add-files', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择要分享给其他设备的文件',
      buttonLabel: '放入互传',
      properties: ['openFile', 'multiSelections']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return { added: [], files: listFiles() }
    const added = await addPathsToShare(result.filePaths)
    return { added, files: listFiles() }
  })

  // 拖拽入窗：渲染层用 webUtils 取到真实路径后转交
  ipcMain.handle('file-transfer:add-paths', async (_e, sources: string[]) => {
    if (!Array.isArray(sources)) return { added: [], files: listFiles() }
    const added = await addPathsToShare(sources.filter((s): s is string => typeof s === 'string'))
    return { added, files: listFiles() }
  })
  // 把收到的文件另存到用户指定位置（换机/归档用）
  ipcMain.handle('file-transfer:save-as', async (event, name: string) => {
    const dir = transferDir()
    const source = path.join(dir, safeName(name))
    if (!fs.existsSync(source)) return { ok: false, message: '文件不存在，可能已被删除' }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: path.basename(source) })
      : await dialog.showSaveDialog({ defaultPath: path.basename(source) })
    if (result.canceled || !result.filePath) return { ok: false }
    try {
      await fs.promises.copyFile(source, result.filePath)
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '保存失败' }
    }
  })

  app.on('will-quit', () => {
    server?.close()
    server = null
  })
}

/** 对端页面：移动端优先，无外部资源，单文件内联 */
function pageHtml(): string {
  return PAGE_HTML
}

const PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f6f8">
<title>AtoZ 文件互传</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; padding: 16px 14px 40px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    background: #f5f6f8; color: #1f2329; line-height: 1.5;
  }
  .head { display: flex; align-items: center; gap: 10px; margin: 4px 2px 16px; }
  .logo {
    width: 34px; height: 34px; border-radius: 9px; flex: none;
    background: linear-gradient(135deg, #5b8def, #7c5cff);
    color: #fff; font-weight: 700; font-size: 15px;
    display: flex; align-items: center; justify-content: center;
  }
  .head h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .head p { margin: 1px 0 0; font-size: 12px; color: #8a9099; }
  .card {
    background: #fff; border-radius: 14px; padding: 16px;
    box-shadow: 0 1px 3px rgba(20,30,50,.06); margin-bottom: 14px;
  }
  .drop {
    border: 1.5px dashed #c9d2e0; border-radius: 12px; padding: 26px 14px;
    text-align: center; transition: border-color .15s, background .15s;
  }
  .drop.active { border-color: #5b8def; background: #f2f6ff; }
  .drop .icon { font-size: 30px; line-height: 1; }
  .drop .t { margin-top: 8px; font-size: 14px; font-weight: 500; }
  .drop .s { margin-top: 4px; font-size: 12px; color: #8a9099; }
  .pick {
    display: block; width: 100%; margin-top: 14px; padding: 12px;
    border: 0; border-radius: 10px; background: #3b6ef0; color: #fff;
    font-size: 15px; font-weight: 500;
  }
  .pick:active { background: #2f5ad0; }
  .pick[disabled] { background: #a9b6cf; }
  .bar { height: 6px; border-radius: 3px; background: #e8ecf3; overflow: hidden; margin-top: 12px; display: none; }
  .bar.on { display: block; }
  .bar i { display: block; height: 100%; width: 0; background: #3b6ef0; transition: width .12s; }
  .bar-tip { margin-top: 6px; font-size: 12px; color: #8a9099; display: none; }
  .bar-tip.on { display: block; }
  .sec-title { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 8px; }
  .sec-title h2 { font-size: 13px; margin: 0; color: #5a626e; font-weight: 600; }
  .sec-title button {
    border: 0; background: none; color: #3b6ef0; font-size: 12px; padding: 2px 4px;
  }
  .empty { text-align: center; color: #a0a7b2; font-size: 13px; padding: 22px 0; }
  .file {
    display: flex; align-items: center; gap: 10px; padding: 10px 2px;
    border-bottom: 1px solid #f0f2f6;
  }
  .file:last-child { border-bottom: 0; }
  .file .ext {
    width: 34px; height: 34px; border-radius: 8px; flex: none;
    background: #eef2fa; color: #5b6f96; font-size: 11px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    text-transform: uppercase; overflow: hidden;
  }
  .file .meta { flex: 1; min-width: 0; }
  .file .name { font-size: 13.5px; word-break: break-all; }
  .file .sub { font-size: 11.5px; color: #9aa1ad; margin-top: 2px; }
  .file a {
    flex: none; text-decoration: none; color: #3b6ef0; font-size: 12px;
    border: 1px solid #cfdcf7; border-radius: 8px; padding: 6px 10px;
  }
  .foot { text-align: center; font-size: 11.5px; color: #a8aeb8; margin-top: 18px; line-height: 1.7; }
  .toast {
    position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(10px);
    background: rgba(28,34,44,.92); color: #fff; font-size: 13px;
    padding: 9px 16px; border-radius: 20px; opacity: 0; pointer-events: none;
    transition: opacity .2s, transform .2s; max-width: 82vw; text-align: center;
  }
  .toast.on { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
  <div class="head">
    <div class="logo">AZ</div>
    <div>
      <h1>AtoZ 文件互传</h1>
      <p>同一局域网 · 上传后电脑端即可看到</p>
    </div>
  </div>

  <div class="card">
    <div class="drop" id="drop">
      <div class="icon">📤</div>
      <div class="t">把文件拖到这里</div>
      <div class="s">或点下面的按钮选择（单文件最大 1GB）</div>
    </div>
    <button class="pick" id="pick">选择文件上传</button>
    <input type="file" id="input" multiple hidden>
    <div class="bar" id="bar"><i id="barFill"></i></div>
    <div class="bar-tip" id="barTip"></div>
  </div>

  <div class="sec-title">
    <h2>电脑上的文件</h2>
    <button id="refresh">刷新</button>
  </div>
  <div class="card" id="list"><div class="empty">加载中…</div></div>

  <div class="foot">
    关闭电脑端工具或退出应用后，本页面立即失效<br>请勿把此链接分享给局域网外的人
  </div>

  <div class="toast" id="toast"></div>

  <script>
  (function () {
    var k = new URLSearchParams(location.search).get('k') || '';
    var input = document.getElementById('input');
    var pick = document.getElementById('pick');
    var drop = document.getElementById('drop');
    var bar = document.getElementById('bar');
    var barFill = document.getElementById('barFill');
    var barTip = document.getElementById('barTip');
    var listBox = document.getElementById('list');
    var toastEl = document.getElementById('toast');
    var uploading = false;

    function q(path) {
      return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(k);
    }

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.className = 'toast on';
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(function () { toastEl.className = 'toast'; }, 2200);
    }

    function size(n) {
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
      return (n / 1073741824).toFixed(2) + ' GB';
    }

    function ext(name) {
      var i = name.lastIndexOf('.');
      return i > 0 ? name.slice(i + 1).slice(0, 4) : 'file';
    }

    function time(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var p = function (n) { return n < 10 ? '0' + n : String(n); };
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function render(files) {
      while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
      if (!files || !files.length) {
        var e = document.createElement('div');
        e.className = 'empty';
        e.textContent = '还没有文件';
        listBox.appendChild(e);
        return;
      }
      files.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'file';

        var icon = document.createElement('div');
        icon.className = 'ext';
        icon.textContent = ext(f.name);

        var meta = document.createElement('div');
        meta.className = 'meta';
        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = f.name;
        var sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = size(f.size) + ' · ' + time(f.modifiedAt);
        meta.appendChild(name);
        meta.appendChild(sub);

        var link = document.createElement('a');
        link.textContent = '下载';
        link.setAttribute('href', q('/f/' + encodeURIComponent(f.name)));
        link.setAttribute('download', f.name);

        row.appendChild(icon);
        row.appendChild(meta);
        row.appendChild(link);
        listBox.appendChild(row);
      });
    }

    function load() {
      fetch(q('/api/files'), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { render(d.files); })
        .catch(function (err) {
          while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
          var e = document.createElement('div');
          e.className = 'empty';
          e.textContent = '读取失败：' + err.message + '（请重新扫码）';
          listBox.appendChild(e);
        });
    }

    function uploadOne(file) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', q('/upload') + '&name=' + encodeURIComponent(file.name));
        xhr.upload.onprogress = function (e) {
          if (!e.lengthComputable) return;
          var pct = Math.round((e.loaded / e.total) * 100);
          barFill.style.width = pct + '%';
          barTip.textContent = '上传中 ' + pct + '% · ' + size(e.loaded) + ' / ' + size(e.total);
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            var msg = 'HTTP ' + xhr.status;
            try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) { /* 忽略解析失败 */ }
            reject(new Error(msg));
          }
        };
        xhr.onerror = function () { reject(new Error('网络中断')); };
        xhr.send(file);
      });
    }

    function upload(files) {
      if (uploading) return;
      var arr = Array.prototype.slice.call(files || []);
      if (!arr.length) return;
      uploading = true;
      pick.disabled = true;
      pick.textContent = '上传中…';
      bar.className = 'bar on';
      barTip.className = 'bar-tip on';
      barFill.style.width = '0';
      var done = 0;
      var failed = 0;

      var chain = Promise.resolve();
      arr.forEach(function (f) {
        chain = chain.then(function () {
          barFill.style.width = '0';
          barTip.textContent = '正在上传 ' + f.name;
          return uploadOne(f).then(function () { done++; }, function (err) {
            failed++;
            toast(f.name + ' 上传失败：' + err.message);
          });
        });
      });

      chain.then(function () {
        uploading = false;
        pick.disabled = false;
        pick.textContent = '选择文件上传';
        bar.className = 'bar';
        barTip.className = 'bar-tip';
        barFill.style.width = '0';
        input.value = '';
        load();
        if (done) toast('已上传 ' + done + ' 个文件');
        if (failed && !done) toast('上传失败，请重试');
      });
    }

    pick.addEventListener('click', function () { if (!uploading) input.click(); });
    input.addEventListener('change', function () { upload(input.files); });
    document.getElementById('refresh').addEventListener('click', load);

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.add('active');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.remove('active');
      });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) upload(e.dataTransfer.files);
    });

    load();
    setInterval(load, 5000);
  })();
  </script>
</body>
</html>`

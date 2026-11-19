<!-- 文件互传：本机起临时 HTTP 服务，同局域网手机/电脑浏览器扫码即可上传下载。
     服务在主进程常驻，切换工具不中断；只有显式停止或退出应用才关闭。 -->
<template>
  <div
    class="ft"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div v-if="dragOver" class="drop-mask">松手即可放入互传</div>

    <!-- 运行状态与访问方式 -->
    <div class="glass block">
      <div class="block-head">
        <div class="head-left">
          <span class="block-title">局域网互传</span>
          <el-tag v-if="status.running" type="success" effect="plain" size="small">运行中</el-tag>
          <el-tag v-else type="info" effect="plain" size="small">未启动</el-tag>
        </div>
        <div class="head-right">
          <el-button v-if="!status.running" type="primary" size="small" :loading="starting" @click="start">
            启动互传
          </el-button>
          <el-button v-else size="small" :loading="stopping" @click="stop">停止</el-button>
        </div>
      </div>

      <div v-if="!status.running" class="intro">
        <p>启动后，同一 WiFi 下的手机或同事电脑用浏览器扫码：他们可以把文件传给你，也可以下载你放进「互传文件」里的内容。</p>
        <ul>
          <li>文件直接落到本机，不经过任何云服务</li>
          <li>地址带一次性访问码，同网段其他人没有码进不来</li>
          <li>首次启动 Windows 可能弹防火墙授权，请选「专用网络」允许</li>
        </ul>
      </div>

      <div v-else class="access">
        <div class="qr-wrap">
          <img v-if="status.qrDataUrl" :src="status.qrDataUrl" class="qr" alt="扫码访问" />
          <div v-else class="qr-fallback">二维码生成失败<br />请手动输入右侧地址</div>
          <div class="qr-tip">手机扫码打开</div>
        </div>
        <div class="urls">
          <div v-for="url in status.urls" :key="url" class="url-row">
            <code class="url">{{ url }}</code>
            <el-button link type="primary" size="small" @click="copy(url)">复制</el-button>
          </div>
          <div v-if="!status.urls.length" class="url-empty">
            没有检测到局域网地址，请确认已连接 WiFi 或有线网络
          </div>
          <div class="url-note">
            端口 {{ status.port }} · 访问码 <code>{{ status.token }}</code>
          </div>
        </div>
      </div>
    </div>

    <!-- 互传文件：既能收对方上传的，也能把自己选中的文件分享出去 -->
    <div class="glass block">
      <div class="block-head">
        <span class="block-title">互传文件 <span class="count">{{ files.length }}</span></span>
        <div class="head-right">
          <el-button type="primary" size="small" :loading="adding" @click="addFiles">添加文件</el-button>
          <el-button size="small" @click="openDir">打开目录</el-button>
          <el-button size="small" :disabled="!files.length" @click="refresh">刷新</el-button>
          <el-button size="small" type="danger" plain :disabled="!files.length" @click="clearAll">清空</el-button>
        </div>
      </div>

      <div v-if="!files.length" class="empty">
        还没有文件。<br />
        点「添加文件」把自己要分享的文件放进来，或让其他设备上传后出现在这里。
      </div>

      <div v-else class="file-list">
        <div v-for="file in files" :key="file.name" class="file-row">
          <div class="file-icon">{{ extOf(file.name) }}</div>
          <div class="file-meta">
            <div class="file-name" :title="file.name">{{ file.name }}</div>
            <div class="file-sub">{{ formatSize(file.size) }} · {{ formatTime(file.modifiedAt) }}</div>
          </div>
          <div class="file-ops">
            <el-button link type="primary" size="small" @click="saveAs(file.name)">另存为</el-button>
            <el-button link type="danger" size="small" @click="removeOne(file.name)">删除</el-button>
          </div>
        </div>
      </div>

      <div class="dir-line">
        <span class="dir-label">存放目录</span>
        <code class="dir-path" :title="status.dir">{{ status.dir }}</code>
        <div class="dir-ops">
          <el-button link type="primary" size="small" @click="chooseDir">更改</el-button>
          <el-button v-if="status.customDir" link size="small" @click="resetDir">恢复默认</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { TransferFile, TransferStatus } from '../../../../../types/file-transfer'

const status = ref<TransferStatus>({
  running: false,
  port: 0,
  token: '',
  urls: [],
  qrDataUrl: '',
  dir: '',
  defaultDir: '',
  customDir: '',
  fileCount: 0
})
const files = ref<TransferFile[]>([])
const starting = ref(false)
const stopping = ref(false)
const adding = ref(false)
const dragOver = ref(false)

let unsubscribe: (() => void) | null = null

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1, i + 5).toUpperCase() : 'FILE'
}

async function refresh(): Promise<void> {
  try {
    const [s, list] = await Promise.all([
      window.api.fileTransfer.status(),
      window.api.fileTransfer.list()
    ])
    status.value = s
    files.value = list
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '读取互传状态失败')
  }
}

async function start(): Promise<void> {
  starting.value = true
  try {
    status.value = await window.api.fileTransfer.start()
    files.value = await window.api.fileTransfer.list()
    ElMessage.success('互传已启动，用手机扫码即可')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '启动失败')
  } finally {
    starting.value = false
  }
}

async function stop(): Promise<void> {
  stopping.value = true
  try {
    status.value = await window.api.fileTransfer.stop()
    ElMessage.info('互传已停止，原有链接立即失效')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '停止失败')
  } finally {
    stopping.value = false
  }
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('地址已复制')
  } catch {
    ElMessage.info(text)
  }
}

async function openDir(): Promise<void> {
  await window.api.fileTransfer.openDir()
}

/** 选择自定义存放目录；切换后不迁移旧文件 */
async function chooseDir(): Promise<void> {
  try {
    const result = await window.api.fileTransfer.chooseDir()
    status.value = result.status
    files.value = await window.api.fileTransfer.list()
    if (result.ok) ElMessage.success('存放目录已更新，原目录里的文件不会自动迁移')
    else if (result.message) ElMessage.error(result.message)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '更改目录失败')
  }
}

async function resetDir(): Promise<void> {
  try {
    status.value = await window.api.fileTransfer.resetDir()
    files.value = await window.api.fileTransfer.list()
    ElMessage.success('已恢复默认目录')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '恢复默认失败')
  }
}

/** 主动分享：系统对话框选文件 → 复制进互传目录 → 对端页面刷新可见 */
async function addFiles(): Promise<void> {
  adding.value = true
  try {
    const { added, files: next } = await window.api.fileTransfer.addFiles()
    files.value = next
    if (added.length) ElMessage.success(`已放入 ${added.length} 个文件，对方刷新页面即可下载`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加文件失败')
  } finally {
    adding.value = false
  }
}

function onDragOver(): void {
  dragOver.value = true
}

function onDragLeave(e: DragEvent): void {
  const related = e.relatedTarget as Node | null
  const root = e.currentTarget as HTMLElement
  // 拖过子元素时 relatedTarget 仍在容器内，不能误清遮罩
  if (related && root.contains(related)) return
  dragOver.value = false
}

async function onDrop(e: DragEvent): Promise<void> {
  dragOver.value = false
  const dropped = Array.from(e.dataTransfer?.files ?? [])
  if (!dropped.length) return
  const paths = dropped
    .map((file) => {
      try {
        return window.api.fileTransfer.pathForFile(file)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  if (!paths.length) {
    ElMessage.warning('没有取到文件路径，请改用「添加文件」')
    return
  }
  adding.value = true
  try {
    const { added, files: next } = await window.api.fileTransfer.addPaths(paths)
    files.value = next
    if (added.length) ElMessage.success(`已放入 ${added.length} 个文件，对方刷新页面即可下载`)
    else ElMessage.info('这些文件已经在互传目录里了')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加文件失败')
  } finally {
    adding.value = false
  }
}

async function saveAs(name: string): Promise<void> {
  const result = await window.api.fileTransfer.saveAs(name)
  if (result.ok && result.path) ElMessage.success(`已保存到 ${result.path}`)
  else if (!result.ok && result.message) ElMessage.error(result.message)
}

async function removeOne(name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除「${name}」？文件会从互传目录中移除。`, '删除文件', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  files.value = await window.api.fileTransfer.remove(name)
  ElMessage.success('已删除')
}

async function clearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm(`清空互传目录里的 ${files.value.length} 个文件？此操作不可恢复。`, '清空文件', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  files.value = await window.api.fileTransfer.clear()
  ElMessage.success('已清空')
}

onMounted(async () => {
  await refresh()
  // 对端上传/删除后主进程推送事件，列表即时更新
  unsubscribe = window.api.fileTransfer.onChange(() => {
    void refresh()
  })
})

// 工具箱用 keep-alive 缓存组件：切回时不重新挂载，需要主动同步一次
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  void refresh()
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<style scoped>
.ft {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drop-mask {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--el-color-primary);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--ink-1);
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
}

.block {
  padding: 14px 16px;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-1);
}

.count {
  margin-left: 4px;
  font-weight: 400;
  color: var(--ink-3);
}

.intro {
  margin-top: 10px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--ink-2);
}

.intro p {
  margin: 0 0 6px;
}

.intro ul {
  margin: 0;
  padding-left: 18px;
  color: var(--ink-3);
}

.access {
  display: flex;
  gap: 18px;
  margin-top: 14px;
  align-items: flex-start;
}

.qr-wrap {
  flex: none;
  width: 148px;
  text-align: center;
}

.qr {
  width: 148px;
  height: 148px;
  border-radius: 10px;
  background: #fff;
  padding: 6px;
  display: block;
}

.qr-fallback {
  width: 148px;
  height: 148px;
  border: 1px dashed var(--divider);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.7;
}

.qr-tip {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ink-3);
}

.urls {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.url-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.url {
  flex: 1;
  min-width: 0;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--fill-subtle);
  border: 1px solid var(--divider);
  font-size: 12px;
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-empty {
  font-size: 12px;
  color: var(--el-color-warning);
}

.url-note {
  font-size: 11.5px;
  color: var(--ink-3);
}

.url-note code,
.dir-line code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11.5px;
}

.empty {
  margin-top: 12px;
  padding: 26px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--ink-3);
  border: 1px dashed var(--divider);
  border-radius: var(--radius-sm);
}

.file-list {
  margin-top: 10px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 2px;
  border-bottom: 1px solid var(--divider);
}

.file-row:last-child {
  border-bottom: 0;
}

.file-icon {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--ink-1);
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.file-meta {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 13px;
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ink-3);
}

.file-ops {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

.dir-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--divider);
  font-size: 11.5px;
  color: var(--ink-3);
}

.dir-label {
  flex: none;
}

.dir-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-ops {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>

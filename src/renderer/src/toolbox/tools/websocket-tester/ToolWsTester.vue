<!-- WebSocket 测试：渲染层原生 WebSocket 直连（WS 无同源策略，不受 CORS 限制）。
     切走页面（deactivated）主动断开，防后台连接泄漏；销毁时兜底清理 -->
<template>
  <div class="ws">
    <div class="conn-row">
      <el-input v-model="url" placeholder="ws://127.0.0.1:9999/echo" class="url-input" :disabled="connected" @keydown.enter="connect" />
      <el-button v-if="!connected" type="primary" :loading="connecting" @click="connect">连接</el-button>
      <el-button v-else type="warning" @click="disconnect">断开</el-button>
      <el-tag :type="statusType" size="small" effect="plain">{{ statusText }}</el-tag>
      <el-button size="small" text @click="messages = []" :disabled="!messages.length">清空记录</el-button>
    </div>

    <div ref="timeline" class="timeline glass">
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.dir">
        <span class="time">{{ m.time }}</span>
        <span class="dir">{{ dirText(m.dir) }}</span>
        <span class="text">{{ m.text }}</span>
      </div>
      <div v-if="!messages.length" class="placeholder">未连接。输入 ws:// 或 wss:// 地址点击「连接」。</div>
    </div>

    <div class="send-row">
      <el-input
        v-model="outgoing"
        placeholder="要发送的消息…"
        :disabled="!connected"
        @keydown.enter="send"
      />
      <el-button type="primary" :disabled="!connected || !outgoing" @click="send">发送</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-websocket-tester' })
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue'
import { ElMessage } from 'element-plus'

interface WsMessage {
  time: string
  dir: 'out' | 'in' | 'sys'
  text: string
}

const dirLabel: Record<WsMessage['dir'], string> = { out: '↑ 发送', in: '↓ 接收', sys: '• 系统' }

function dirText(dir: WsMessage['dir']): string {
  return dirLabel[dir]
}

const url = ref('ws://echo.websocket.events')
const status = ref<'idle' | 'connecting' | 'open' | 'closed'>('idle')
const connecting = computed(() => status.value === 'connecting')
const connected = computed(() => status.value === 'open')
const statusType = computed(() =>
  status.value === 'open' ? 'success' : status.value === 'connecting' ? 'warning' : 'info'
)
const statusText = computed(
  () => ({ idle: '未连接', connecting: '连接中…', open: '已连接', closed: '已断开' })[status.value]
)

const outgoing = ref('')
const messages = ref<WsMessage[]>([])
const timeline = ref<HTMLElement | null>(null)
let socket: WebSocket | null = null

function nowLabel(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function push(dir: WsMessage['dir'], text: string): void {
  messages.value.push({ time: nowLabel(), dir, text })
  // 大量消息时只保留最近 500 条，防内存膨胀
  if (messages.value.length > 500) messages.value.splice(0, messages.value.length - 500)
  void nextTick(() => {
    const el = timeline.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function connect(): void {
  const target = url.value.trim()
  if (!/^wss?:\/\//.test(target)) {
    ElMessage.warning('地址需以 ws:// 或 wss:// 开头')
    return
  }
  disconnect(true)
  status.value = 'connecting'
  push('sys', `连接 ${target} …`)
  try {
    socket = new WebSocket(target)
  } catch (err) {
    status.value = 'closed'
    push('sys', `连接创建失败: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  socket.onopen = () => {
    status.value = 'open'
    push('sys', '连接已建立')
  }
  socket.onmessage = (ev) => {
    push('in', typeof ev.data === 'string' ? ev.data : `[二进制 ${String(ev.data).length} 字节]`)
  }
  socket.onerror = () => {
    push('sys', '连接错误')
  }
  socket.onclose = (ev) => {
    status.value = 'closed'
    push('sys', `连接关闭 (code=${ev.code}${ev.reason ? `, ${ev.reason}` : ''})`)
  }
}

function disconnect(silent = false): void {
  if (socket) {
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    socket.onopen = null
    try {
      socket.close()
    } catch {
      // 已处于关闭状态
    }
    socket = null
  }
  status.value = 'closed'
  if (!silent) push('sys', '已主动断开')
}

function send(): void {
  const text = outgoing.value
  if (!socket || status.value !== 'open' || !text) return
  socket.send(text)
  push('out', text)
  outgoing.value = ''
}

// keep-alive 切走即断开，防后台连接泄漏；回来自动恢复到未连接态（重连由用户操作）
onDeactivated(() => {
  if (socket) {
    disconnect(true)
    push('sys', '页面切到后台，连接已自动断开')
  }
})
onActivated(() => {
  status.value = socket ? status.value : status.value === 'open' ? 'closed' : status.value
})
onBeforeUnmount(() => disconnect(true))
</script>

<style scoped>
.ws {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}

.conn-row,
.send-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.url-input {
  flex: 1;
}

.timeline {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  font-size: 12.5px;
}

.msg {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--divider);
  word-break: break-all;
}

.msg .time {
  color: var(--ink-3);
  flex-shrink: 0;
}

.msg .dir {
  flex-shrink: 0;
  font-weight: 600;
}

.msg.out .dir {
  color: var(--accent);
}

.msg.in .dir {
  color: var(--el-color-success);
}

.msg.sys .dir {
  color: var(--ink-3);
}

.placeholder {
  color: var(--ink-3);
  text-align: center;
  margin-top: 40px;
}
</style>

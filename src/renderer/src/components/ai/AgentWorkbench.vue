<template>
  <div class="agent-wb">
    <!-- 左：助手与会话 -->
    <aside class="agent-side glass">
      <div class="side-head">
        <span class="side-title">AI 助手</span>
        <el-button size="small" text title="新建助手" @click="openEditor(null)">
          <el-icon><Plus /></el-icon>
        </el-button>
      </div>
      <div class="agent-list">
        <div
          v-for="a in agents"
          :key="a.id"
          class="agent-item"
          :class="{ active: a.id === activeAgentId }"
          @click="selectAgent(a.id)"
        >
          <span class="agent-emoji">{{ a.emoji }}</span>
          <div class="agent-info">
            <div class="agent-name">{{ a.name }}</div>
            <div class="agent-desc">{{ a.description || a.model }}</div>
          </div>
          <el-dropdown trigger="click" @command="(cmd: string) => onAgentCommand(cmd, a)" @click.stop>
            <el-icon class="agent-more"><MoreFilled /></el-icon>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="remove" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-if="!agents.length" class="side-empty">
          还没有助手<br />点右上角 ＋ 新建
        </div>
      </div>

      <div class="side-head session-head">
        <span class="side-title">对话记录</span>
        <el-button size="small" text :disabled="!activeAgentId" @click="newSession()">新建</el-button>
      </div>
      <div class="session-search">
        <el-input
          v-model="sessionQuery"
          size="small"
          clearable
          :prefix-icon="Search"
          placeholder="搜索对话内容"
        />
      </div>

      <!-- 有搜索词时展示跨会话命中；否则展示当前助手的会话列表 -->
      <div v-if="sessionQuery.trim()" class="session-list">
        <div
          v-for="h in searchHits"
          :key="h.sessionId"
          class="session-item hit-item"
          :class="{ active: h.sessionId === activeSessionId }"
          @click="openSession(h.sessionId)"
        >
          <el-icon class="session-icon"><Search /></el-icon>
          <div class="hit-body">
            <div class="hit-title" :title="h.title">{{ h.title }}</div>
            <div class="hit-snippet">
              <span class="hit-role">{{ h.role === 'user' ? '我' : 'AI' }}</span>{{ h.snippet }}
            </div>
          </div>
          <span v-if="h.hits > 1" class="hit-count">{{ h.hits }}</span>
        </div>
        <div v-if="searching" class="side-empty small">搜索中…</div>
        <div v-else-if="!searchHits.length" class="side-empty small">没有匹配的对话</div>
      </div>

      <div v-else class="session-list">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === activeSessionId }"
          @click="openSession(s.id)"
        >
          <el-icon class="session-icon"><ChatLineRound /></el-icon>
          <span class="session-title" :title="s.title">{{ s.title }}</span>
          <el-icon class="session-edit" title="重命名" @click.stop="renameSession(s)"><EditPen /></el-icon>
          <el-icon class="session-del" title="删除对话" @click.stop="removeSession(s.id)"><Delete /></el-icon>
        </div>
        <div v-if="!sessions.length" class="side-empty small">暂无对话</div>
      </div>
    </aside>

    <!-- 右：对话 -->
    <section class="chat-panel glass">
      <template v-if="activeAgent">
        <header class="chat-head">
          <div class="chat-title">
            <span class="chat-emoji">{{ activeAgent.emoji }}</span>
            <div class="chat-name-wrap">
              <div class="chat-name">{{ activeAgent.name }}</div>
              <div class="chat-sub">
                {{ providerName(overrideProviderId || activeAgent.providerId) }}
                <span v-if="activeAgent.tools.length">· {{ activeAgent.tools.length }} 个工具</span>
              </div>
            </div>
          </div>
          <div class="chat-actions">
            <el-select
              v-model="modelPicker"
              size="small"
              class="sel-model"
              filterable
              placeholder="选择模型"
              @change="onModelChange"
            >
              <el-option-group v-for="p in providersWithModels" :key="p.id" :label="p.name">
                <el-option
                  v-for="m in visibleModelsOf(p)"
                  :key="`${p.id}::${m.id}`"
                  :value="`${p.id}::${m.id}`"
                  :label="m.name || m.id"
                />
              </el-option-group>
            </el-select>
            <el-select v-model="effortValue" size="small" class="sel-effort" @change="onEffortChange">
              <el-option value="off" label="默认思考" />
              <el-option value="low" label="思考·低" />
              <el-option value="medium" label="思考·中" />
              <el-option value="high" label="思考·高" />
            </el-select>
            <el-button size="small" @click="newSession()">新对话</el-button>
          </div>
        </header>

        <div ref="scrollRef" class="chat-body">
          <div v-if="!messages.length && !streaming" class="chat-empty">
            <div class="empty-emoji">{{ activeAgent.emoji }}</div>
            <div class="empty-title">{{ activeAgent.description || '有什么可以帮你？' }}</div>
            <div v-if="activeAgent.quickPrompts.length" class="quick-list">
              <el-button
                v-for="(q, i) in activeAgent.quickPrompts"
                :key="i"
                size="small"
                plain
                @click="send(q)"
              >{{ q }}</el-button>
            </div>
          </div>

          <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <div class="msg-avatar">{{ m.role === 'user' ? '我' : activeAgent.emoji }}</div>
            <div class="msg-body">
              <AgentToolSteps v-if="m.steps?.length" :steps="m.steps" />
              <div class="msg-bubble" :class="{ 'md-bubble': m.role === 'assistant' }">
                <ChatMarkdown v-if="m.role === 'assistant'" :content="m.content" />
                <template v-else>{{ m.content }}</template>
              </div>
            </div>
          </div>

          <div v-if="streaming" class="msg assistant">
            <div class="msg-avatar">{{ activeAgent.emoji }}</div>
            <div class="msg-body">
              <AgentToolSteps v-if="liveSteps.length" :steps="liveSteps" />
              <div class="msg-bubble streaming md-bubble">
                <ChatMarkdown v-if="streamingText" :content="streamingText" />
                <span v-else class="thinking">思考中…<span class="cursor">▍</span></span>
              </div>
            </div>
          </div>

          <div v-if="streamNotice" class="chat-notice">
            <el-icon><InfoFilled /></el-icon>
            <span>{{ streamNotice }}</span>
          </div>

          <div v-if="streamError" class="chat-error">
            <el-icon><WarningFilled /></el-icon>
            <span>{{ streamError }}</span>
          </div>
        </div>

        <footer class="chat-input">
          <el-input
            v-model="draft"
            type="textarea"
            :rows="3"
            resize="none"
            placeholder="输入消息…（Ctrl + Enter 发送）"
            @keydown="onKeydown"
          />
          <div class="input-actions">
            <span class="input-tip">Enter 换行 · Ctrl + Enter 发送</span>
            <el-button v-if="streaming" size="small" type="danger" plain @click="stop">停止</el-button>
            <el-button
              size="small"
              type="primary"
              :disabled="!draft.trim() || streaming"
              @click="send()"
            >发送</el-button>
          </div>
        </footer>
      </template>

      <div v-else class="chat-placeholder">
        <el-empty description="创建或选择一个 AI 助手开始对话" :image-size="80">
          <el-button type="primary" @click="openEditor(null)">新建助手</el-button>
        </el-empty>
      </div>
    </section>

    <AgentEditorDialog v-model:visible="editorVisible" :agent="editingAgent" @saved="onAgentSaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ChatLineRound, Delete, EditPen, InfoFilled, MoreFilled, Plus, Search, WarningFilled } from '@element-plus/icons-vue'
import type { AiAgent, AiReasoningEffort, AiSessionMessage, AiSessionMeta, AiSessionSearchHit, AiStreamRequest, AiToolConfirmRequest, AiToolStep } from '../../../../types/agent'
import type { AiModel, AiProvider } from '../../../../types/ai'
import { useAiProviders } from '../../ai/store'
import { toPlain } from '../../ai/plain'
import AgentEditorDialog from './AgentEditorDialog.vue'
import AgentToolSteps from './AgentToolSteps.vue'
import ChatMarkdown from './ChatMarkdown.vue'

const { providers, ensureLoaded } = useAiProviders()

const agents = ref<AiAgent[]>([])
const activeAgentId = ref('')
const sessions = ref<AiSessionMeta[]>([])
const activeSessionId = ref('')
const messages = ref<AiSessionMessage[]>([])
const draft = ref('')
const streaming = ref(false)
const streamingText = ref('')
const liveSteps = ref<AiToolStep[]>([])
const streamError = ref('')
const streamNotice = ref('')
const currentRequestId = ref('')
const scrollRef = ref<HTMLElement>()

// 会话搜索：输入防抖 250ms，切换助手时清空
const sessionQuery = ref('')
const searchHits = ref<AiSessionSearchHit[]>([])
const searching = ref(false)
let searchTimer = 0
let searchSeq = 0

// 会话级设置：模型与思考强度可覆盖 Agent 默认值，变更即写回会话
const overrideProviderId = ref('')
const overrideModel = ref('')
const effortValue = ref<AiReasoningEffort>('off')
const settingsDirty = ref(false)

const modelPicker = computed({
  get: () => (overrideProviderId.value && overrideModel.value ? `${overrideProviderId.value}::${overrideModel.value}` : ''),
  set: (v: string) => {
    const [pid, ...rest] = v.split('::')
    overrideProviderId.value = pid ?? ''
    overrideModel.value = rest.join('::')
  }
})

/** 只列出启用且有可见模型的供应商 */
const providersWithModels = computed(() =>
  providers.value.filter((p) => p.enabled && visibleModelsOf(p).length > 0)
)

function visibleModelsOf(p: AiProvider): AiModel[] {
  if (!Array.isArray(p.visibleModelIds)) return p.models
  const ids = new Set(p.visibleModelIds)
  return p.models.filter((m) => ids.has(m.id))
}

const editorVisible = ref(false)
const editingAgent = ref<AiAgent | null>(null)

const activeAgent = computed(() => agents.value.find((a) => a.id === activeAgentId.value))

let offToolConfirm: (() => void) | null = null

onMounted(async () => {
  await Promise.all([ensureLoaded(), loadAgents()])
  offToolConfirm = window.api.ai.onToolConfirm((req) => {
    void handleToolConfirm(req)
  })
})

onBeforeUnmount(() => {
  offToolConfirm?.()
  offToolConfirm = null
  window.clearTimeout(searchTimer)
  if (currentRequestId.value) void window.api.ai.abortStream(currentRequestId.value)
})

/** 输入防抖后搜索当前助手的会话正文；序号保证过期响应不覆盖新结果 */
watch(sessionQuery, (v) => {
  window.clearTimeout(searchTimer)
  const q = v.trim()
  if (!q) {
    searchHits.value = []
    searching.value = false
    return
  }
  if (!activeAgentId.value) return
  searching.value = true
  searchTimer = window.setTimeout(() => {
    void runSessionSearch(q)
  }, 250)
})

async function runSessionSearch(q: string): Promise<void> {
  const agentId = activeAgentId.value
  const seq = ++searchSeq
  try {
    const hits = await window.api.ai.sessions.search(q, agentId)
    if (seq !== searchSeq || sessionQuery.value.trim() !== q) return
    searchHits.value = hits
  } catch {
    if (seq === searchSeq) searchHits.value = []
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

/** 写操作确认：用 VNode 渲染，模型产出的文本一律当纯文本，不解析 HTML */
// 串行队列：ElMessageBox 是单例，连续两次确认若并行弹出会复用实例导致结果串位
let confirmQueue: Promise<void> = Promise.resolve()

function handleToolConfirm(req: AiToolConfirmRequest): Promise<void> {
  confirmQueue = confirmQueue.then(() => showToolConfirm(req)).catch(() => undefined)
  return confirmQueue
}

async function showToolConfirm(req: AiToolConfirmRequest): Promise<void> {
  const message = h('div', { style: 'font-size:13px;line-height:1.7' }, [
    h('p', { style: 'margin:0 0 8px;word-break:break-word' }, req.summary),
    req.detail
      ? h(
          'pre',
          {
            style:
              'margin:0;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;' +
              'font-size:12px;line-height:1.6;padding:8px 10px;border-radius:6px;background:rgba(127,127,127,.1)'
          },
          req.detail
        )
      : null
  ])

  const danger = req.level === 'destructive'
  try {
    await ElMessageBox.confirm(message, `${req.label} · 需要你确认`, {
      confirmButtonText: danger ? '确认删除' : req.level === 'paid' ? '确认生成' : '允许',
      cancelButtonText: '拒绝',
      type: danger ? 'error' : 'warning'
    })
    await window.api.ai.confirmTool(req.requestId, true)
  } catch {
    await window.api.ai.confirmTool(req.requestId, false)
  }
  // 等上一只弹窗的关闭动画走完，再放行下一次确认
  await new Promise((resolve) => setTimeout(resolve, 180))
}

async function loadAgents(): Promise<void> {
  try {
    agents.value = await window.api.ai.agents.list()
    if (!activeAgentId.value && agents.value.length) await selectAgent(agents.value[0].id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载助手失败')
  }
}

async function selectAgent(id: string): Promise<void> {
  if (streaming.value) await stop()
  activeAgentId.value = id
  activeSessionId.value = ''
  messages.value = []
  streamError.value = ''
  streamNotice.value = ''
  liveSteps.value = []
  sessionQuery.value = ''
  searchHits.value = []
  applyAgentDefaults()
  try {
    sessions.value = await window.api.ai.sessions.list(id)
  } catch {
    sessions.value = []
  }
}

/** 回到 Agent 的默认模型与思考强度 */
function applyAgentDefaults(): void {
  const a = activeAgent.value
  overrideProviderId.value = a?.providerId ?? ''
  overrideModel.value = a?.model ?? ''
  effortValue.value = a?.reasoningEffort ?? 'off'
  settingsDirty.value = false
}

/** 会话级设置写回磁盘（模型 / 思考强度） */
async function persistSettings(sessionId: string): Promise<void> {
  if (!sessionId) return
  try {
    const patch = {
      providerId: overrideProviderId.value || undefined,
      model: overrideModel.value || undefined,
      reasoningEffort: effortValue.value
    }
    await window.api.ai.sessions.update(sessionId, patch)
    const meta = sessions.value.find((s) => s.id === sessionId)
    if (meta) {
      if (patch.providerId) meta.providerId = patch.providerId
      if (patch.model) meta.model = patch.model
      meta.reasoningEffort = patch.reasoningEffort
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存会话设置失败')
  }
}

function onModelChange(): void {
  if (!overrideProviderId.value || !overrideModel.value) return
  settingsDirty.value = true
  if (activeSessionId.value) void persistSettings(activeSessionId.value)
}

function onEffortChange(): void {
  settingsDirty.value = true
  if (activeSessionId.value) void persistSettings(activeSessionId.value)
}

function openEditor(a: AiAgent | null): void {
  editingAgent.value = a
  editorVisible.value = true
}

async function onAgentSaved(): Promise<void> {
  const prev = activeAgentId.value
  agents.value = await window.api.ai.agents.list()
  if (!prev && agents.value.length) await selectAgent(agents.value[0].id)
  else if (prev && !agents.value.some((a) => a.id === prev) && agents.value.length) {
    await selectAgent(agents.value[0].id)
  }
}

async function onAgentCommand(cmd: string, a: AiAgent): Promise<void> {
  if (cmd === 'edit') {
    openEditor(a)
    return
  }
  if (cmd !== 'remove') return
  try {
    await ElMessageBox.confirm(`删除助手「${a.name}」？对话记录会一并移除。`, '删除助手', { type: 'warning' })
  } catch {
    return
  }
  try {
    agents.value = await window.api.ai.agents.remove(a.id)
    if (activeAgentId.value === a.id) {
      activeAgentId.value = ''
      sessions.value = []
      messages.value = []
      if (agents.value.length) await selectAgent(agents.value[0].id)
    }
    ElMessage.success('已删除助手')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

async function newSession(resetSettings = true): Promise<void> {
  if (!activeAgentId.value || streaming.value) return
  try {
    const s = await window.api.ai.sessions.create(activeAgentId.value)
    if (resetSettings) applyAgentDefaults()
    activeSessionId.value = s.id
    sessions.value = await window.api.ai.sessions.list(activeAgentId.value)
    messages.value = []
    streamError.value = ''
    streamNotice.value = ''
    // 用户开新对话前已选好模型/思考强度时，落到新会话上
    if (settingsDirty) {
      await persistSettings(s.id)
      settingsDirty.value = false
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '新建对话失败')
  }
}

async function openSession(id: string): Promise<void> {
  if (streaming.value) await stop()
  activeSessionId.value = id
  streamError.value = ''
  streamNotice.value = ''
  liveSteps.value = []
  applyAgentDefaults()
  const meta = sessions.value.find((s) => s.id === id)
  if (meta) {
    overrideProviderId.value = meta.providerId || overrideProviderId.value
    overrideModel.value = meta.model || overrideModel.value
    effortValue.value = meta.reasoningEffort ?? effortValue.value
  }
  try {
    messages.value = await window.api.ai.sessions.messages(id)
    scrollBottom()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '读取对话失败')
  }
}

async function renameSession(s: AiSessionMeta): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('输入新的对话名称', '重命名对话', {
      inputValue: s.title,
      inputValidator: (v: string) => (v && v.trim() ? true : '名称不能为空'),
      confirmButtonText: '保存',
      cancelButtonText: '取消'
    })
    sessions.value = await window.api.ai.sessions.rename(s.id, value.trim())
  } catch {
    /* 取消改名 */
  }
}

async function removeSession(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('删除这条对话记录？', '删除对话', { type: 'warning' })
  } catch {
    return
  }
  try {
    await window.api.ai.sessions.delete(id)
    if (activeAgentId.value) sessions.value = await window.api.ai.sessions.list(activeAgentId.value)
    if (activeSessionId.value === id) {
      activeSessionId.value = ''
      messages.value = []
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除对话失败')
  }
}

async function send(preset?: string): Promise<void> {
  const text = (preset ?? draft.value).trim()
  const agent = activeAgent.value
  if (!text || !agent || streaming.value) return

  if (!activeSessionId.value) await newSession(false)
  const sessionId = activeSessionId.value
  if (!sessionId) return

  // 乐观插入用户消息；流结束后以主进程落盘结果为准刷新
  messages.value.push({
    id: `local-${Date.now()}`,
    role: 'user',
    content: text,
    createdAt: new Date().toISOString()
  })
  draft.value = ''
  streamError.value = ''
  streamNotice.value = ''
  liveSteps.value = []
  streamingText.value = ''
  streaming.value = true
  scrollBottom()

  const requestId = `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  currentRequestId.value = requestId

  // 上下文由主进程按会话落盘消息 + 模型窗口统一构建，这里只上传本轮输入
  const history = [{ role: 'user' as const, content: text }]

  const off = window.api.ai.onStreamEvent((e) => {
    if (e.requestId !== requestId) return
    if (e.type === 'text') {
      streamingText.value += e.delta
      scrollBottom()
    } else if (e.type === 'tool') {
      liveSteps.value.push(e.step)
      scrollBottom()
    } else if (e.type === 'notice') {
      streamNotice.value = e.message
    } else if (e.type === 'error') {
      streamError.value = e.message
    }
  })

  try {
    const result = await window.api.ai.streamChat(
      toPlain<AiStreamRequest>({ requestId, agentId: agent.id, sessionId, messages: history })
    )
    if (!result.ok && !streamError.value) streamError.value = result.message || '生成失败'
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : '生成失败'
  } finally {
    off()
    streaming.value = false
    streamingText.value = ''
    liveSteps.value = []
    currentRequestId.value = ''
    // 主进程已落盘用户与助手消息，这里整体刷新保证一致
    try {
      messages.value = await window.api.ai.sessions.messages(sessionId)
      sessions.value = await window.api.ai.sessions.list(agent.id)
    } catch {
      /* 刷新失败保留本地视图 */
    }
    scrollBottom()
  }
}

async function stop(): Promise<void> {
  if (!currentRequestId.value) return
  try {
    await window.api.ai.abortStream(currentRequestId.value)
  } catch {
    /* 已结束 */
  }
}

function onKeydown(e: Event | KeyboardEvent): void {
  const ev = e as KeyboardEvent
  if (ev.key !== 'Enter' || (!ev.ctrlKey && !ev.metaKey)) return
  ev.preventDefault()
  void send()
}

let scrollRaf = 0
function scrollBottom(): void {
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
  void nextTick(() => {
    if (scrollRaf === 0) {
      const el = scrollRef.value
      if (el) el.scrollTop = el.scrollHeight
    }
  })
}

function providerName(id: string): string {
  return providers.value.find((p) => p.id === id)?.name ?? '供应商未配置'
}
</script>

<style scoped>
.agent-wb {
  display: flex;
  gap: 12px;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
}

/* ---- 左侧 ---- */
.agent-side {
  width: 246px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 10px;
  overflow: hidden;
  min-height: 0;
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 8px;
  flex-shrink: 0;
}
.side-title { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.session-head { border-top: 1px solid var(--divider); margin-top: 8px; padding-top: 8px; }
.session-search { padding: 0 2px 6px; flex-shrink: 0; }

.agent-list { flex: 1; overflow-y: auto; min-height: 80px; }
.agent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s ease;
}
.agent-item:hover { background: var(--fill-hover); }
.agent-item.active { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-border); }
.agent-emoji { font-size: 18px; line-height: 1; flex-shrink: 0; }
.agent-info { min-width: 0; flex: 1; }
.agent-name {
  font-size: 12px; font-weight: 600; color: var(--ink-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.agent-desc {
  margin-top: 1px; font-size: 10px; color: var(--ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.agent-more { color: var(--ink-3); cursor: pointer; flex-shrink: 0; }
.agent-more:hover { color: var(--ink-1); }

.session-list { flex: 1; overflow-y: auto; min-height: 60px; }
.session-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--ink-2);
  font-size: 12px;
}
.session-item:hover { background: var(--fill-hover); }
.session-item.active { background: var(--fill-hover); color: var(--ink-1); }
.session-icon { font-size: 13px; flex-shrink: 0; color: var(--ink-3); }
.session-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-edit, .session-del { font-size: 12px; color: var(--ink-3); opacity: 0; transition: opacity 0.15s ease; }
.session-item:hover .session-edit, .session-item:hover .session-del { opacity: 1; }
.session-edit:hover { color: var(--el-color-primary); }
.session-del:hover { color: var(--el-color-danger); }

/* 搜索命中：两行展示标题 + 片段 */
.session-item.hit-item { align-items: flex-start; }
.hit-body { flex: 1; min-width: 0; }
.hit-title {
  font-size: 12px; color: var(--ink-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hit-snippet {
  margin-top: 2px; font-size: 11px; line-height: 1.5; color: var(--ink-3);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.hit-role { margin-right: 4px; font-size: 10px; color: var(--accent-strong); }
.hit-count {
  flex-shrink: 0; padding: 0 4px; font-size: 10px; line-height: 15px;
  border-radius: 3px; background: var(--accent-soft); color: var(--accent-strong);
}

.side-empty { padding: 18px 8px; text-align: center; font-size: 11px; line-height: 1.7; color: var(--ink-3); }
.side-empty.small { padding: 10px 8px; }

/* ---- 右侧 ---- */
.chat-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--divider);
  flex-shrink: 0;
}
.chat-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.chat-emoji { font-size: 22px; line-height: 1; }
.chat-name-wrap { min-width: 0; }
.chat-name { font-size: 13px; font-weight: 600; }
.chat-sub {
  margin-top: 1px; font-size: 11px; color: var(--ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px;
}
.chat-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.sel-model { width: 200px; }
.sel-effort { width: 118px; }

.chat-body { flex: 1; overflow-y: auto; padding: 16px 18px; min-height: 0; }

.chat-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.empty-emoji { font-size: 44px; line-height: 1; }
.empty-title { font-size: 13px; color: var(--ink-2); text-align: center; max-width: 420px; line-height: 1.6; }
.quick-list { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 6px; }

.msg { display: flex; gap: 10px; margin-bottom: 14px; align-items: flex-start; }
.msg.user { flex-direction: row-reverse; }
.msg-avatar {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; background: var(--fill-hover); color: var(--ink-2);
}
.msg.assistant .msg-avatar { background: var(--accent-soft); }
.msg-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 78%;
}
.msg-bubble {
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
  background: var(--fill-subtle);
  border: 1px solid var(--divider);
  color: var(--ink-1);
}
.msg.user .msg-bubble {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  white-space: pre-wrap;
}
/* 助手消息走 Markdown 渲染，内边距收紧一些 */
.msg.assistant .md-bubble { padding: 8px 12px; }
.msg-bubble.streaming { border-style: dashed; }
.thinking { color: var(--ink-3); }
.cursor { color: var(--accent-strong); animation: blink 1s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }

.chat-error {
  display: flex; align-items: flex-start; gap: 6px;
  margin: 6px 0 10px 36px; padding: 8px 10px;
  font-size: 12px; line-height: 1.6; color: var(--el-color-danger);
  background: var(--fill-subtle); border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
}
.chat-error .el-icon { margin-top: 2px; flex-shrink: 0; }

.chat-notice {
  display: flex; align-items: flex-start; gap: 6px;
  margin: 6px 0 10px 36px; padding: 8px 10px;
  font-size: 12px; line-height: 1.6; color: var(--ink-2);
  background: var(--fill-subtle); border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
}
.chat-notice .el-icon { margin-top: 2px; flex-shrink: 0; color: var(--ink-3); }

.chat-input {
  flex-shrink: 0;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--divider);
}
.input-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.input-tip { margin-right: auto; font-size: 11px; color: var(--ink-3); }

.chat-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

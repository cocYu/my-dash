<template>
  <div class="page dash">
    <!-- 问候区 -->
    <header class="hero">
      <div class="hero-text">
        <p class="eyebrow">{{ today }}</p>
        <h1>{{ greeting }}</h1>
        <p class="sub">{{ summary }}</p>
      </div>
      <div class="hero-actions">
        <el-button @click="newNote">
          <el-icon><DocumentAdd /></el-icon>
          <span>新建笔记</span>
        </el-button>
        <el-button @click="newTodo">
          <el-icon><Finished /></el-icon>
          <span>新建待办</span>
        </el-button>
        <el-button type="primary" @click="go('/ai')">
          <el-icon><MagicStick /></el-icon>
          <span>AI 工作台</span>
        </el-button>
      </div>
    </header>

    <!-- 统计 -->
    <div class="stat-grid">
      <div class="stat-tile">
        <div class="tile-top">
          <span class="label">笔记</span>
          <span class="tile-icon"><el-icon><Document /></el-icon></span>
        </div>
        <div class="value">{{ noteCount ?? '—' }}</div>
        <div class="hint">保存在本地 SQLite</div>
      </div>

      <div class="stat-tile">
        <div class="tile-top">
          <span class="label">待处理</span>
          <span class="tile-icon"><el-icon><Finished /></el-icon></span>
        </div>
        <div class="value accent">{{ openTodos ?? '—' }}</div>
        <div class="hint">未完成的待办</div>
      </div>

      <div class="stat-tile">
        <div class="tile-top">
          <span class="label">插件</span>
          <span class="tile-icon"><el-icon><Grid /></el-icon></span>
        </div>
        <div class="value">{{ enabledPlugins }}</div>
        <div class="hint">已安装 {{ totalPlugins }} 个</div>
      </div>

      <div class="stat-tile">
        <div class="tile-top">
          <span class="label">运行环境</span>
          <span class="tile-icon"><el-icon><Monitor /></el-icon></span>
        </div>
        <div class="value small">{{ electronVersion }}</div>
        <div class="hint">Electron · 后端已连接</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="col-main">
      <!-- 最近笔记 -->
      <section class="panel recent">
        <div class="panel-head">
          <div>
            <div class="panel-title">最近更新</div>
            <div class="panel-sub">按修改时间排序</div>
          </div>
          <el-button text size="small" @click="go('/notes')">全部笔记</el-button>
        </div>
        <div v-if="recent.length" class="recent-list">
          <button v-for="n in recent" :key="n.id" class="recent-row" @click="openNote(n.id)">
            <span class="recent-badge"><el-icon><Document /></el-icon></span>
            <span class="recent-main">
              <span class="recent-title">{{ n.title }}</span>
              <span class="recent-meta">{{ formatTime(n.updated_at) }}</span>
            </span>
            <el-icon class="recent-go"><ArrowRight /></el-icon>
          </button>
        </div>
        <div v-else class="recent-empty">
          <p>还没有笔记</p>
          <el-button size="small" type="primary" plain @click="newNote">写下第一篇</el-button>
        </div>
      </section>

      <section class="panel todo-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">待处理</div>
            <div class="panel-sub">按截止时间排序</div>
          </div>
          <el-button text size="small" @click="go('/todos')">全部待办</el-button>
        </div>
        <div v-if="openList.length" class="todo-mini">
          <button v-for="t in openList" :key="t.id" class="todo-mini-row" @click="go('/todos')">
            <span class="mini-dot" :style="{ background: priorityMeta(t.priority).color }" />
            <span class="mini-title">{{ t.title }}</span>
            <span v-if="t.due_at" class="mini-due" :data-state="dueState(t)">{{ formatDue(t.due_at, t.all_day) }}</span>
          </button>
        </div>
        <EmptyState v-else compact title="没有待处理事项" hint="今天可以专注手头的事" :icon="CircleCheck">
          <el-button size="small" @click="newTodo">新建待办</el-button>
        </EmptyState>
        <div class="todo-stats">
          <div class="stat-cell">
            <b>{{ doneThisWeek }}</b>
            <span>本周完成</span>
          </div>
          <div class="stat-cell" :class="{ danger: overdueCount > 0 }">
            <b>{{ overdueCount }}</b>
            <span>已逾期</span>
          </div>
          <div class="trend" title="近 7 天每日完成数">
            <span
              v-for="(n, i) in trend"
              :key="i"
              class="trend-bar"
              :style="{ height: `${Math.max(2, Math.round((n / trendMax) * 22))}px` }"
              :class="{ empty: n === 0 }"
            />
          </div>
          <span class="trend-caption">近 7 天完成趋势</span>
        </div>
      </section>
      </div>

      <!-- 快捷入口 -->
      <section class="panel shortcuts">
        <div class="panel-head">
          <div>
            <div class="panel-title">快捷入口</div>
            <div class="panel-sub">常用功能一键直达</div>
          </div>
        </div>
        <div class="shortcut-list">
          <button v-for="s in shortcuts" :key="s.path" class="shortcut" @click="go(s.path)">
            <span class="sc-icon"><el-icon><component :is="s.icon" /></el-icon></span>
            <span class="sc-text">
              <span class="sc-title">{{ s.title }}</span>
              <span class="sc-desc">{{ s.desc }}</span>
            </span>
            <el-icon class="recent-go"><ArrowRight /></el-icon>
          </button>
        </div>
      </section>
    </div>

    <!-- 插件小组件 -->
    <template v-if="pluginRegistry.widgets.length > 0">
      <div class="section-title">插件小组件</div>
      <div class="widget-grid">
        <el-card
          v-for="(w, i) in pluginRegistry.widgets"
          :key="w.id"
          shadow="never"
          class="widget"
          :style="{ animationDelay: `${i * 50}ms` }"
        >
          <template #header>
            <span class="widget-title">{{ w.title }}</span>
          </template>
          <component :is="w.component" />
        </el-card>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowRight,
  CircleCheck,
  Document,
  DocumentAdd,
  Finished,
  Grid,
  MagicStick,
  Monitor,
  Setting,
  Suitcase
} from '@element-plus/icons-vue'
import { listNotes, type NoteMeta } from '../api/notes'
import { dueState, formatDue, listTodos, priorityMeta, type Todo } from '../api/todo'
import { appMeta } from '../api/http'
import { pluginRegistry } from '../plugins/store'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()

const now = new Date()
const today = now.toLocaleDateString('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long'
})

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意休息'
  if (h < 11) return '早上好，开始今天的工作'
  if (h < 14) return '中午好，稍作休整'
  if (h < 18) return '下午好，保持专注'
  return '晚上好，收尾一下今天'
})

const noteCount = ref<number | null>(null)
const openTodos = ref<number | null>(null)
const recent = ref<NoteMeta[]>([])
const openList = ref<Todo[]>([])
const enabledPlugins = ref(0)
const totalPlugins = ref(0)
const electronVersion = `v${appMeta.electronVersion.split('.').slice(0, 2).join('.')}`

// ---- 待办统计（R10）----
const doneThisWeek = ref(0)
const overdueCount = ref(0)
/** 近 7 天每日完成数（旧 → 今天） */
const trend = ref<number[]>([])
const trendMax = computed(() => Math.max(1, ...trend.value))

const DAY = 86_400_000
const day0 = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

const summary = computed(() => {
  const parts: string[] = []
  if (noteCount.value != null) parts.push(`${noteCount.value} 篇笔记`)
  if (openTodos.value != null) parts.push(`${openTodos.value} 个待处理待办`)
  if (enabledPlugins.value) parts.push(`${enabledPlugins.value} 个插件在运行`)
  return parts.length ? parts.join(' · ') : '正在读取本地数据…'
})

const shortcuts = [
  { path: '/notes', title: '笔记', desc: 'Markdown 写作与版本', icon: Document },
  { path: '/todos', title: '待办', desc: '分类、标签与截止时间', icon: Finished },
  { path: '/toolbox', title: '工具箱', desc: '开发与日常小工具', icon: Suitcase },
  { path: '/settings', title: '设置', desc: '主题、插件与同步', icon: Setting }
]

function go(path: string): void {
  void router.push(path)
}

function newNote(): void {
  void router.push('/notes')
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('mydash:new-note')), 60)
}

function newTodo(): void {
  void router.push('/todos')
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('mydash:new-todo')), 60)
}

function openNote(id: number): void {
  void router.push({ path: '/notes', query: { note: String(id) } })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

async function refresh(): Promise<void> {
  try {
    const notes = await listNotes()
    noteCount.value = notes.length
    recent.value = [...notes]
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, 5)
  } catch {
    noteCount.value = 0
    recent.value = []
  }

  try {
    const todos = await listTodos()
    const open = todos.filter((t) => t.status === 'open')
    openTodos.value = open.length
    openList.value = open
      .sort((a, b) => {
        if (!a.due_at && !b.due_at) return b.priority - a.priority
        if (!a.due_at) return 1
        if (!b.due_at) return -1
        return a.due_at < b.due_at ? -1 : 1
      })
      .slice(0, 5)

    // 本周完成（自然周，周一起）与近 7 天完成趋势、逾期数
    const nowD = new Date()
    const today0 = day0(nowD)
    const weekStart = today0 - ((nowD.getDay() + 6) % 7) * DAY
    const counts = new Array<number>(7).fill(0)
    let weekDone = 0
    let overdue = 0
    for (const t of todos) {
      if (t.status === 'done' && t.completed_at) {
        const diff = Math.round((today0 - day0(new Date(t.completed_at))) / DAY)
        if (diff >= 0 && diff < 7) counts[6 - diff]++
        if (Date.parse(t.completed_at) >= weekStart) weekDone++
      }
      if (t.status === 'open' && t.due_at && Date.parse(t.due_at) < Date.now()) overdue++
    }
    doneThisWeek.value = weekDone
    overdueCount.value = overdue
    trend.value = counts
  } catch {
    openTodos.value = 0
    openList.value = []
    doneThisWeek.value = 0
    overdueCount.value = 0
    trend.value = []
  }

  try {
    const list = await window.api.plugins.list()
    totalPlugins.value = list.filter((p) => !p.error).length
    enabledPlugins.value = list.filter((p) => p.enabled && !p.error).length
  } catch {
    enabledPlugins.value = 0
  }
}

onMounted(refresh)

// keep-alive：切回仪表盘时刷新统计
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  void refresh()
})
</script>

<style scoped>
.dash {
  gap: 20px;
}

/* 问候区 */
.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 6px 2px 0;
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 11.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.hero h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
  color: var(--ink-1);
}

.hero .sub {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--ink-2);
}

.hero-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 统计磁贴 */
.tile-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tile-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--fill-subtle);
  color: var(--ink-3);
  font-size: 14px;
}

.stat-tile .value.small {
  font-size: 22px;
}

/* 双栏 */
.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.col-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (max-width: 1080px) {
  .dash-grid {
    grid-template-columns: 1fr;
  }
}

.panel-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-1);
}

.panel-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ink-3);
}

/* 最近笔记 */
.recent-list {
  padding: 6px;
  display: flex;
  flex-direction: column;
}

.recent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  text-align: left;
  cursor: pointer;
  color: var(--ink-1);
  transition: background var(--dur-fast) var(--ease);
}

.recent-row:hover {
  background: var(--fill-hover);
}

.recent-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 14px;
}

.recent-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.recent-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-meta {
  font-size: 11.5px;
  color: var(--ink-3);
}

.recent-go {
  color: var(--ink-3);
  font-size: 12px;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}

.recent-row:hover .recent-go {
  opacity: 1;
}

.recent-empty {
  padding: 34px 16px;
  text-align: center;
  color: var(--ink-3);
  font-size: 12.5px;
}

.recent-empty p {
  margin: 0 0 10px;
}

/* 快捷入口 */
.shortcut-list {
  padding: 6px;
  display: flex;
  flex-direction: column;
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  text-align: left;
  cursor: pointer;
  color: var(--ink-1);
  transition: background var(--dur-fast) var(--ease);
}

.shortcut:hover {
  background: var(--fill-hover);
}

.sc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 15px;
}

.sc-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sc-title {
  font-size: 13px;
  font-weight: 500;
}

.sc-desc {
  font-size: 11.5px;
  color: var(--ink-3);
}

.shortcut:hover .recent-go {
  opacity: 1;
}

/* 待办预览 */
.todo-panel {
  overflow: hidden;
}

.todo-panel :deep(.empty-state.compact) {
  min-height: 86px;
  padding: 12px 16px;
}

.todo-panel :deep(.empty-state.compact .es-art) {
  display: none;
}

.todo-mini {
  padding: 6px;
  display: flex;
  flex-direction: column;
}

.todo-mini-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  text-align: left;
  cursor: pointer;
  color: var(--ink-1);
  transition: background var(--dur-fast) var(--ease);
}

.todo-mini-row:hover {
  background: var(--fill-hover);
}

.mini-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mini-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-due {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--ink-3);
}

.mini-due[data-state='overdue'] {
  color: var(--danger);
}

.mini-due[data-state='today'] {
  color: var(--warning);
}

/* 待办统计条 */
.todo-stats {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 14px;
  border-top: 1px solid var(--line, var(--divider));
}

.stat-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.stat-cell b {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink-1);
  line-height: 1.2;
}

.stat-cell span {
  font-size: 11px;
  color: var(--ink-3);
}

.stat-cell.danger b {
  color: var(--danger, #e5484d);
}

.trend {
  margin-left: auto;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 24px;
}

.trend-bar {
  width: 7px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
  opacity: 0.75;
  min-height: 2px;
}

.trend-bar.empty {
  background: var(--fill-subtle);
  opacity: 1;
}

.trend-caption {
  font-size: 11px;
  color: var(--ink-3);
}

/* 插件小组件 */
.widget-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.widget {
  animation: widget-in 0.36s var(--ease) both;
}

.widget:hover {
  border-color: var(--line-strong);
}

.widget-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}

@keyframes widget-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

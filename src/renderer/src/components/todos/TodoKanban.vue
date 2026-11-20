<template>
  <div class="kanban">
    <div v-for="col in COLUMNS" :key="col.key" class="kanban-col" @dragover.prevent @drop.prevent="onDrop(col.key, $event)">
      <div class="col-head" :data-tone="col.key">
        <span class="col-dot" />
        <span class="col-label">{{ col.label }}</span>
        <span class="col-count">{{ columnItems(col.key).length }}</span>
      </div>
      <div class="col-body" :class="{ empty: columnItems(col.key).length === 0 }">
        <div
          v-for="t in columnItems(col.key)"
          :key="t.id"
          class="kan-card"
          :class="{ selected: t.id === selectedId }"
          draggable="true"
          @click="$emit('select', t.id)"
          @dragstart="onDragStart(t, $event)"
          @contextmenu.prevent="openMenu($event, t)"
        >
          <div class="card-title-line">
            <span class="card-title" :class="{ done: t.status !== 'open' }">{{ t.title }}</span>
            <span
              v-if="t.priority !== 4"
              class="p-badge"
              :style="{ background: priorityMeta(t.priority).color }"
            >P{{ t.priority }}</span>
          </div>
          <div class="card-meta">
            <span v-if="dueBadgeOf(t)" class="due-badge" :data-state="dueState(t)">{{ dueBadgeOf(t) }}</span>
            <span v-if="recBadge(t)" class="rec-badge"><el-icon><RefreshIcon /></el-icon>{{ recBadge(t) }}</span>
            <span v-for="tag in t.tags.slice(0, 2)" :key="tag" class="mini-tag">{{ tag }}</span>
          </div>
          <div class="card-foot">
            <span v-if="t.sub_total > 0" class="sub-chip">{{ t.sub_done }}/{{ t.sub_total }} 子任务</span>
            <span class="card-due">{{ t.due_at ? formatDue(t.due_at) : '' }}</span>
          </div>
        </div>
        <div v-if="columnItems(col.key).length === 0" class="col-empty">{{ col.empty }}</div>
      </div>
    </div>

    <!-- 右键菜单：不依赖拖拽的状态流转（WCAG 2.5.7 单指针替代） -->
    <teleport to="body">
      <div
        v-if="menu.visible"
        class="ctx-menu glass"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      >
        <div
          v-for="col in COLUMNS"
          :key="col.key"
          class="ctx-item"
          :class="{ current: menu.todo?.status === col.key }"
          @click="applyStatus(col.key)"
        >{{ col.key === menu.todo?.status ? `✓ ${col.label}` : `移到「${col.label}」` }}</div>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Refresh as RefreshIcon } from '@element-plus/icons-vue'
import { dueState, formatDue, priorityMeta, recBadge, type Todo, type TodoStatus } from '../../api/todo'

const props = defineProps<{
  /** 已按筛选条件过滤后的顶层待办 */
  items: Todo[]
  selectedId: number | null
}>()

const emit = defineEmits<{
  select: [id: number]
  'status-change': [id: number, status: TodoStatus]
}>()

const COLUMNS: { key: TodoStatus; label: string; empty: string }[] = [
  { key: 'open', label: '待处理', empty: '拖一张卡片过来，或右键菜单移入' },
  { key: 'done', label: '已完成', empty: '完成的事项会落在这里' },
  { key: 'closed', label: '已关闭', empty: '不再跟踪的事项会落在这里' }
]

const dragTodoId = ref<number | null>(null)
const menu = ref<{ visible: boolean; x: number; y: number; todo: Todo | null }>({
  visible: false,
  x: 0,
  y: 0,
  todo: null
})

function columnItems(status: TodoStatus): Todo[] {
  return props.items.filter((t) => t.status === status)
}

function onDragStart(t: Todo, e: DragEvent): void {
  dragTodoId.value = t.id
  e.dataTransfer?.setData('text/plain', String(t.id))
}

function onDrop(status: TodoStatus, _e: DragEvent): void {
  const id = dragTodoId.value
  dragTodoId.value = null
  if (id == null) return
  const todo = props.items.find((t) => t.id === id)
  if (todo && todo.status !== status) emit('status-change', id, status)
}

function openMenu(e: MouseEvent, todo: Todo): void {
  emit('select', todo.id)
  menu.value = { visible: true, x: e.clientX, y: e.clientY, todo }
  window.addEventListener('click', closeMenu, { once: true })
}

function closeMenu(): void {
  menu.value.visible = false
}

function applyStatus(status: TodoStatus): void {
  const todo = menu.value.todo
  closeMenu()
  if (todo && todo.status !== status) emit('status-change', todo.id, status)
}

function dueBadgeOf(t: Todo): string {
  const state = dueState(t)
  if (state === 'none') return ''
  const due = Date.parse(t.due_at!)
  const minutes = Math.round(Math.abs(due - Date.now()) / 60000)
  const span = minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时` : `${Math.round(minutes / 1440)} 天`
  return state === 'overdue' ? `已超时 ${span}` : `即将超时 ${span}`
}
</script>

<style scoped>
.kanban {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.kanban-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--divider);
  border-radius: 10px;
  background: var(--fill-subtle);
  overflow: hidden;
}

.col-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--divider);
}

.col-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-3);
}

.col-head[data-tone='open'] .col-dot {
  background: var(--accent);
}

.col-head[data-tone='done'] .col-dot {
  background: #30a46c;
}

.col-head[data-tone='closed'] .col-dot {
  background: var(--ink-3);
}

.col-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.col-count {
  font-size: 11px;
  color: var(--ink-3);
  margin-left: auto;
}

.col-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.col-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
  padding: 0 12px;
  line-height: 1.6;
}

.kan-card {
  border: 1px solid var(--divider);
  background: transparent;
  border-radius: 8px;
  padding: 9px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.kan-card:hover {
  background: var(--fill-hover);
}

.kan-card.selected {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.card-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.card-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-title.done {
  text-decoration: line-through;
  color: var(--ink-3);
  font-weight: 500;
}

.p-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  padding: 1px 6px;
  border-radius: 5px;
  line-height: 1.5;
}

.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

.due-badge {
  flex-shrink: 0;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}

.due-badge[data-state='soon'] {
  background: rgba(255, 159, 26, 0.16);
  color: #ff9f1a;
}

.due-badge[data-state='overdue'] {
  background: rgba(229, 72, 77, 0.16);
  color: #e5484d;
}

.rec-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.mini-tag {
  flex-shrink: 0;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--fill-subtle);
  color: var(--ink-2);
  border: 1px solid var(--divider);
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.sub-chip {
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 1px 8px;
}

.card-due {
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}

/* 右键菜单（与列表页一致） */
.ctx-menu {
  position: fixed;
  z-index: 3000;
  min-width: 150px;
  padding: 6px;
  border-radius: 10px;
}

.ctx-item {
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.ctx-item:hover {
  background: var(--fill-hover);
}

.ctx-item.current {
  color: var(--accent-strong);
}
</style>

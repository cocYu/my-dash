<template>
  <div
    class="todo-row"
    :class="{
      selected,
      closed: todo.status === 'closed',
      done: todo.status === 'done',
      subtask,
      'drag-over': dragOver,
      manual: draggable
    }"
    :draggable="draggable || undefined"
    @click="$emit('select', $event)"
    @contextmenu.prevent="$emit('contextmenu', $event)"
    @dragstart="$emit('dragstart', $event)"
    @dragover.prevent="$emit('dragover', $event)"
    @drop.prevent="$emit('drop', $event)"
    @dragend="$emit('dragend')"
  >
    <el-icon v-if="draggable" class="drag-handle" title="拖拽排序"><RankIcon /></el-icon>
    <el-checkbox
      v-if="batchMode"
      class="row-check"
      :model-value="checked"
      @click.stop
      @change="$emit('check')"
    />
    <el-checkbox
      v-else
      class="row-check"
      :model-value="todo.status === 'done'"
      @click.stop
      @change="$emit('toggle-done', $event as boolean)"
    />
    <div class="row-main">
      <div class="row-title-line">
        <span class="row-title" :class="{ done: todo.status !== 'open' }">{{ todo.title }}</span>
        <span
          v-if="!subtask && todo.priority !== 4"
          class="p-badge"
          :style="{ background: priorityMeta(todo.priority).color }"
        >P{{ todo.priority }}</span>
        <span v-if="dueBadgeOf(todo)" class="due-badge" :data-state="dueState(todo)">{{ dueBadgeOf(todo) }}</span>
        <span v-if="recText" class="rec-badge" :title="`${recText} · 完成后自动创建下一期`">
          <el-icon><RefreshIcon /></el-icon>{{ recText }}
        </span>
      </div>
      <div class="row-sub" v-if="todo.subtitle || todo.tags.length || todo.sub_total > 0">
        <span v-if="todo.subtitle" class="subtitle">{{ todo.subtitle }}</span>
        <span v-for="tag in todo.tags" :key="tag" class="mini-tag">{{ tag }}</span>
        <span
          v-if="todo.sub_total > 0"
          class="sub-chip"
          :class="{ expanded }"
          @click.stop="$emit('toggle-expand')"
        >{{ todo.sub_done }}/{{ todo.sub_total }} 子任务</span>
      </div>
    </div>
    <span class="row-due">{{ todo.due_at ? formatDue(todo.due_at) : '' }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Rank as RankIcon, Refresh as RefreshIcon } from '@element-plus/icons-vue'
import { dueState, formatDue, priorityMeta, recBadge, type Todo } from '../../api/todo'

const props = defineProps<{
  todo: Todo
  subtask?: boolean
  selected?: boolean
  /** 批量模式：左侧复选框变为多选 */
  batchMode?: boolean
  checked?: boolean
  /** 手动排序模式：整行可拖拽 */
  draggable?: boolean
  dragOver?: boolean
  expanded?: boolean
}>()

defineEmits<{
  select: [event: MouseEvent]
  'toggle-done': [checked: boolean]
  check: []
  contextmenu: [event: MouseEvent]
  'toggle-expand': []
  dragstart: [event: DragEvent]
  dragover: [event: DragEvent]
  drop: [event: DragEvent]
  dragend: []
}>()

const recText = computed(() => (props.subtask ? '' : recBadge(props.todo)))

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
.todo-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.todo-row:hover {
  background: var(--fill-hover);
}

.todo-row.selected {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.todo-row.selected::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
}

.todo-row.subtask {
  margin-left: 26px;
  padding: 5px 10px;
}

.todo-row.subtask.selected::before {
  display: none;
}

.todo-row.manual {
  cursor: grab;
}

.todo-row.drag-over {
  border-color: var(--accent);
  box-shadow: 0 -2px 0 0 var(--accent) inset;
}

.drag-handle {
  flex-shrink: 0;
  color: var(--ink-3);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}

.todo-row:hover .drag-handle {
  opacity: 1;
}

.row-check {
  flex-shrink: 0;
  height: auto;
}

.row-main {
  flex: 1;
  min-width: 0;
}

.row-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-title.done {
  text-decoration: line-through;
  color: var(--ink-3);
  font-weight: 500;
}

.todo-row.closed .row-title {
  color: var(--ink-3);
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
  white-space: nowrap;
}

.row-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  min-width: 0;
}

.subtitle {
  font-size: 12px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.sub-chip {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 1px 8px;
  cursor: pointer;
}

.sub-chip.expanded {
  color: var(--accent-strong);
}

.row-due {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}
</style>

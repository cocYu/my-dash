<template>
  <div v-if="todo" class="todo-detail">
    <!-- 标题区 -->
    <div class="detail-head">
      <el-checkbox
        class="done-check"
        :model-value="todo.status === 'done'"
        @change="toggleDone"
      />
      <div class="head-main">
        <input v-model="draft.title" class="title-input" :class="{ done: todo.status === 'done' }" placeholder="待办标题" />
        <input v-model="draft.subtitle" class="subtitle-input" placeholder="副标题（可选）" />
      </div>
      <span v-if="dueText.badge" class="due-badge" :data-state="dueText.state">{{ dueText.badge }}</span>
    </div>

    <!-- 属性区 -->
    <div class="meta-grid">
      <label>分类</label>
      <el-select v-model="draft.categoryId" size="small" clearable placeholder="根目录">
        <el-option v-for="cat in categories" :key="cat.id" :value="cat.id" :label="cat.name" />
      </el-select>
      <label>优先级</label>
      <el-select v-model="draft.priority" size="small">
        <el-option v-for="p in PRIORITIES" :key="p.value" :value="p.value" :label="p.label">
          <span class="p-dot" :style="{ background: p.color }" />{{ p.label }}
        </el-option>
      </el-select>
      <label>开始时间</label>
      <el-date-picker
        v-model="draft.startAt"
        type="datetime"
        size="small"
        placeholder="可选"
        format="YYYY-MM-DD HH:mm"
        :clearable="true"
      />
      <label>截止时间</label>
      <el-date-picker
        v-model="draft.dueAt"
        type="datetime"
        size="small"
        placeholder="可选"
        format="YYYY-MM-DD HH:mm"
        :clearable="true"
      />
      <label>超时提醒</label>
      <div class="warn-cell">
        <el-checkbox-group v-model="draft.warnOffsets" :disabled="!draft.dueAt" class="warn-group" size="small">
          <el-checkbox v-for="opt in WARN_OFFSET_PRESETS" :key="opt.minutes" :value="opt.minutes" :label="opt.label" />
        </el-checkbox-group>
        <span v-if="draft.warnOffsets.length === 0" class="warn-none">{{ draft.dueAt ? '不提醒' : '先设置截止时间' }}</span>
      </div>
      <label>重复</label>
      <div v-if="!isSubtask" class="rec-cell">
        <el-select v-model="draft.recType" size="small" class="rec-select" placeholder="不重复">
          <el-option v-for="r in REC_TYPES" :key="r.value" :value="r.value" :label="r.label" />
        </el-select>
        <template v-if="draft.recType === 'custom'">
          <span class="rec-unit">每</span>
          <el-input-number
            v-model="draft.recInterval"
            size="small"
            :min="1"
            :max="365"
            controls-position="right"
            class="rec-interval"
          />
          <span class="rec-unit">天重复一次</span>
        </template>
        <span v-else-if="draft.recType" class="rec-hint">{{ recHint }} · 完成或关闭后自动创建下一期</span>
      </div>
      <div v-else class="rec-cell rec-disabled">子任务不支持重复规则</div>
      <label>标签</label>
      <el-select
        v-model="draft.tags"
        size="small"
        multiple
        filterable
        allow-create
        default-first-option
        placeholder="回车创建新标签"
        :max-collapse-tags="3"
        :collapse-tags="true"
      >
        <el-option v-for="t in tags" :key="t.name" :value="t.name" :label="`${t.name} (${t.count})`" />
      </el-select>
    </div>

    <!-- 子任务 -->
    <div class="block">
      <div class="block-title">
        子任务
        <span v-if="todo.sub_total > 0" class="sub-progress">已完成 {{ todo.sub_done }}/{{ todo.sub_total }}</span>
      </div>
      <div v-for="sub in subtasks" :key="sub.id" class="sub-row" :data-status="sub.status">
        <el-checkbox
          :model-value="sub.status === 'done'"
          size="small"
          @change="toggleSub(sub, $event as boolean)"
        />
        <span class="sub-title" :class="{ done: sub.status === 'done' }">{{ sub.title }}</span>
        <span v-if="dueTextOf(sub)" class="sub-due" :data-state="dueState(sub)">{{ dueTextOf(sub) }}</span>
        <el-icon class="row-del" title="删除子任务" @click="removeSub(sub)"><DeleteIcon /></el-icon>
      </div>
      <input
        v-model="newSubTitle"
        class="sub-add"
        placeholder="+ 添加子任务，回车确认"
        @keydown.enter="addSub"
      />
    </div>

    <!-- 描述（富文本） -->
    <div class="block">
      <div class="block-title">描述</div>
      <RichTextEditor v-model="draft.description" placeholder="填写备注、链接、清单…" />
    </div>

    <!-- 状态操作 -->
    <div class="status-actions">
      <template v-if="todo.status === 'open'">
        <el-button type="primary" size="small" @click="setStatus('done')">
          <el-icon><SelectIcon /></el-icon>完成
        </el-button>
        <el-button size="small" @click="setStatus('closed')">关闭</el-button>
      </template>
      <template v-else>
        <el-button type="primary" size="small" @click="setStatus('open')">重新开启</el-button>
        <el-button v-if="todo.status === 'done'" size="small" @click="setStatus('closed')">关闭</el-button>
      </template>
      <span class="spacer" />
      <el-button size="small" type="danger" plain @click="remove">删除</el-button>
    </div>

    <!-- 评论 -->
    <div class="block">
      <div class="block-title">评论（{{ comments.length }}）</div>
      <div v-for="cm in comments" :key="cm.id" class="comment-row">
        <div class="comment-body">
          <div class="comment-time">{{ fmtTime(cm.created_at) }}</div>
          <div class="comment-text">{{ cm.content }}</div>
        </div>
        <el-icon class="row-del" title="删除评论" @click="removeComment(cm)"><DeleteIcon /></el-icon>
      </div>
      <div v-if="comments.length === 0" class="comment-empty">还没有评论</div>
      <div class="comment-input">
        <el-input
          v-model="newComment"
          type="textarea"
          :rows="2"
          size="small"
          placeholder="记录一些事情…（Ctrl+Enter 发送）"
          @keydown="onCommentKeydown"
        />
        <el-button size="small" type="primary" :disabled="!newComment.trim()" @click="submitComment">发送</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Delete as DeleteIcon,
  Finished as SelectIcon
} from '@element-plus/icons-vue'
import RichTextEditor from './RichTextEditor.vue'
import {
  addComment,
  createTodo,
  deleteComment,
  deleteTodo,
  dueState,
  effectiveWarnOffsets,
  formatDue,
  listComments,
  PRIORITIES,
  REC_TYPES,
  setTodoStatus,
  toDateInput,
  updateTodo,
  type RecType,
  type Todo,
  type TodoCategory,
  type TodoComment,
  type TodoStatus,
  type TodoTag,
  untilDueText,
  WARN_OFFSET_PRESETS
} from '../../api/todo'

const props = defineProps<{
  todo: Todo | null
  subtasks: Todo[]
  categories: TodoCategory[]
  tags: TodoTag[]
}>()

const emit = defineEmits<{
  changed: []
  deleted: [id: number]
}>()

const draft = reactive({
  title: '',
  subtitle: '',
  categoryId: null as number | null,
  priority: 4,
  startAt: null as Date | null,
  dueAt: null as Date | null,
  warnOffsets: [] as number[],
  recType: '' as RecType,
  recInterval: 1,
  tags: [] as string[],
  description: ''
})

const isSubtask = computed(() => props.todo?.parent_id != null)
const recHint = computed(() => REC_TYPES.find((r) => r.value === draft.recType)?.hint ?? '')

const newSubTitle = ref('')
const newComment = ref('')
const comments = ref<TodoComment[]>([])
let saveTimer: ReturnType<typeof setTimeout> | null = null
let applying = false

// ---- 装载 ----
function seed(): void {
  applying = true
  const t = props.todo
  draft.title = t?.title ?? ''
  draft.subtitle = t?.subtitle ?? ''
  draft.categoryId = t?.category_id ?? null
  draft.priority = t?.priority ?? 4
  draft.startAt = toDateInput(t?.start_at ?? null)
  draft.dueAt = toDateInput(t?.due_at ?? null)
  draft.warnOffsets = t ? effectiveWarnOffsets(t) : []
  draft.recType = t?.rec_type ?? ''
  draft.recInterval = t?.rec_interval || 1
  draft.tags = [...(t?.tags ?? [])]
  draft.description = t?.description ?? ''
  comments.value = []
  if (t) void loadComments(t.id)
  void nextTick(() => {
    applying = false
  })
}

watch(
  () => props.todo?.id,
  () => seed()
)
onMounted(seed)

// ---- 自动保存 ----
watch(draft, () => {
  if (applying) return
  if (!props.todo) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 500)
})

async function save(): Promise<void> {
  const t = props.todo
  if (!t || applying) return
  const patch: Record<string, unknown> = {}
  if (draft.title.trim() && draft.title !== t.title) patch.title = draft.title.trim()
  if (draft.subtitle !== t.subtitle) patch.subtitle = draft.subtitle
  if ((draft.categoryId ?? null) !== t.category_id) patch.category_id = draft.categoryId ?? 0
  if (draft.priority !== t.priority) patch.priority = draft.priority
  if ((toDateInput(t.start_at) ?? null)?.getTime() !== (draft.startAt ?? null)?.getTime()) {
    patch.start_at = draft.startAt ? draft.startAt.toISOString() : null
  }
  if ((toDateInput(t.due_at) ?? null)?.getTime() !== (draft.dueAt ?? null)?.getTime()) {
    patch.due_at = draft.dueAt ? draft.dueAt.toISOString() : null
    if (!draft.dueAt) draft.warnOffsets = []
  }
  if (JSON.stringify([...draft.warnOffsets].sort((a, b) => a - b)) !== JSON.stringify(effectiveWarnOffsets(t))) {
    patch.warn_offsets = [...draft.warnOffsets]
  }
  if (draft.recType !== t.rec_type) patch.rec_type = draft.recType
  if (draft.recType !== '' && draft.recInterval !== t.rec_interval) patch.rec_interval = draft.recInterval
  if (JSON.stringify([...draft.tags].sort()) !== JSON.stringify([...t.tags].sort())) patch.tags = [...draft.tags]
  if (draft.description !== t.description) patch.description = draft.description
  if (Object.keys(patch).length === 0) return
  try {
    await updateTodo(t.id, patch)
    emit('changed')
  } catch {
    // 错误已由 http 拦截器提示；保持脏值等待再次编辑
  }
}

// ---- 状态操作 ----
async function toggleDone(): Promise<void> {
  if (!props.todo) return
  await setStatus(props.todo.status === 'done' ? 'open' : 'done')
}

async function setStatus(status: TodoStatus): Promise<void> {
  if (!props.todo) return
  await setTodoStatus(props.todo.id, status)
  emit('changed')
  ElMessage.success(status === 'done' ? '已完成' : status === 'closed' ? '已关闭' : '已重新开启')
}

async function remove(): Promise<void> {
  const t = props.todo
  if (!t) return
  await ElMessageBox.confirm(
    t.sub_total > 0
      ? `「${t.title}」及其 ${t.sub_total} 个子任务将移入回收站，30 天内可恢复。继续吗？`
      : `确定把「${t.title}」移入回收站吗？30 天内可恢复，评论与标签一并保留。`,
    '移入回收站',
    { type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消' }
  )
  await deleteTodo(t.id)
  emit('deleted', t.id)
  ElMessage.success('已移入回收站')
}

// ---- 子任务 ----
function dueTextOf(t: Todo): string {
  if (!t.due_at) return ''
  const state = dueState(t)
  if (state === 'none') return formatDue(t.due_at)
  return `${formatDue(t.due_at)} · ${untilDueText(t)}`
}

async function toggleSub(sub: Todo, checked: boolean): Promise<void> {
  await setTodoStatus(sub.id, checked ? 'done' : 'open')
  emit('changed')
}

async function addSub(): Promise<void> {
  const title = newSubTitle.value.trim()
  if (!title || !props.todo) return
  await createTodo({ title, parent_id: props.todo.id, category_id: props.todo.category_id })
  newSubTitle.value = ''
  emit('changed')
}

async function removeSub(sub: Todo): Promise<void> {
  await deleteTodo(sub.id)
  emit('changed')
}

// ---- 评论 ----
async function loadComments(todoId: number): Promise<void> {
  try {
    comments.value = await listComments(todoId)
  } catch {
    comments.value = []
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function submitComment(): Promise<void> {
  const content = newComment.value.trim()
  if (!content || !props.todo) return
  const cm = await addComment(props.todo.id, content)
  comments.value.push(cm)
  newComment.value = ''
}

function onCommentKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void submitComment()
  }
}

async function removeComment(cm: TodoComment): Promise<void> {
  if (!props.todo) return
  await deleteComment(props.todo.id, cm.id)
  comments.value = comments.value.filter((x) => x.id !== cm.id)
}

// ---- 超时徽标 ----
const dueText = computed(() => {
  const t = props.todo
  if (!t) return { badge: '', state: 'none' as string }
  const state = dueState(t)
  if (state === 'none') return { badge: '', state }
  if (state === 'overdue') return { badge: `已超时 · ${untilDueText(t)}`, state }
  return { badge: `即将超时 · ${untilDueText(t)}`, state }
})
</script>

<style scoped>
.todo-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title-input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink-1);
  padding: 2px 4px;
  border-radius: 6px;
}

.title-input:focus {
  background: var(--fill-subtle);
}

.title-input.done {
  text-decoration: line-through;
  color: var(--ink-3);
}

.subtitle-input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 12.5px;
  color: var(--ink-3);
  padding: 2px 4px;
  border-radius: 6px;
}

.subtitle-input:focus {
  background: var(--fill-subtle);
}

.due-badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.due-badge[data-state='soon'] {
  background: rgba(255, 159, 26, 0.15);
  color: #ff9f1a;
}

.due-badge[data-state='overdue'] {
  background: rgba(229, 72, 77, 0.15);
  color: #e5484d;
}

.meta-grid {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: center;
  gap: 8px 10px;
}

.meta-grid > label {
  font-size: 12.5px;
  color: var(--ink-3);
}

.warn-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
}

.warn-none {
  font-size: 12px;
  color: var(--ink-3);
}

.rec-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.rec-cell :deep(.el-select) {
  width: 130px;
}

.rec-cell.rec-disabled {
  font-size: 12px;
  color: var(--ink-3);
}

.rec-select {
  flex: 0 0 120px;
}

.rec-unit {
  font-size: 12.5px;
  color: var(--ink-2);
}

.rec-interval {
  width: 90px;
}

.rec-hint {
  font-size: 11.5px;
  color: var(--ink-3);
}

.meta-grid :deep(.el-select),
.meta-grid :deep(.el-date-editor) {
  width: 100%;
}

.p-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.block-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-progress {
  font-weight: 400;
  color: var(--ink-3);
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 8px;
}

.sub-row:hover {
  background: var(--fill-subtle);
}

.sub-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-title.done {
  text-decoration: line-through;
  color: var(--ink-3);
}

.sub-due {
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}

.sub-due[data-state='soon'] {
  color: #ff9f1a;
}

.sub-due[data-state='overdue'] {
  color: #e5484d;
}

.sub-add {
  border: 1px dashed var(--divider);
  background: transparent;
  border-radius: 8px;
  outline: none;
  padding: 6px 10px;
  font-size: 12.5px;
  color: var(--ink-1);
}

.sub-add:focus {
  border-color: var(--accent);
}

.row-del {
  flex-shrink: 0;
  cursor: pointer;
  color: var(--ink-3);
  border-radius: 4px;
  padding: 2px;
  opacity: 0;
}

.sub-row:hover .row-del,
.comment-row:hover .row-del {
  opacity: 1;
}

.row-del:hover {
  color: var(--el-color-danger);
  background: var(--fill-hover);
}

.status-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.comment-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
}

.comment-row:hover {
  background: var(--fill-subtle);
}

.comment-body {
  flex: 1;
  min-width: 0;
}

.comment-time {
  font-size: 11px;
  color: var(--ink-3);
}

.comment-text {
  font-size: 13px;
  color: var(--ink-1);
  white-space: pre-wrap;
  word-break: break-word;
}

.comment-empty {
  font-size: 12px;
  color: var(--ink-3);
  padding: 4px 8px;
}

.comment-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  margin-top: 4px;
}

.comment-input :deep(.el-textarea) {
  width: 100%;
}
</style>

<template>
  <div class="page todos-page">
    <!-- 左：分类 + 标签 -->
    <div class="glass side-panel">
      <div class="side-title">
        分类
        <el-icon class="side-add" title="新建分类" @click="addCategory"><PlusIcon /></el-icon>
      </div>
      <div
        class="cat-row"
        :class="{ active: filterCategory === 'all' }"
        @click="filterCategory = 'all'"
      >
        <span class="cat-name">全部待办</span>
        <span class="cat-count">{{ topLevelCount }}</span>
      </div>
      <div
        class="cat-row"
        :class="{ active: filterCategory === 'root' }"
        @click="filterCategory = 'root'"
      >
        <span class="cat-name">根目录</span>
        <span class="cat-count">{{ rootCount }}</span>
      </div>
      <div
        v-for="cat in categories"
        :key="cat.id"
        class="cat-row"
        :class="{ active: filterCategory === cat.id }"
        @click="filterCategory = cat.id"
      >
        <el-icon class="cat-icon"><FolderIcon /></el-icon>
        <span class="cat-name">{{ cat.name }}</span>
        <span class="cat-count">{{ cat.count }}</span>
        <span class="cat-actions" @click.stop>
          <el-icon title="重命名" @click="renameCategory(cat)"><EditIcon /></el-icon>
          <el-icon class="danger" title="删除分类（待办回到根目录）" @click="removeCategory(cat)"><DeleteIcon /></el-icon>
        </span>
      </div>

      <div class="side-title tag-title">
        标签
      </div>
      <div class="tag-cloud">
        <span
          v-for="t in tags"
          :key="t.name"
          class="tag-chip"
          :class="{ active: filterTag === t.name }"
          @click="filterTag = filterTag === t.name ? null : t.name"
        >{{ t.name }} <i>{{ t.count }}</i></span>
        <span v-if="tags.length === 0" class="tag-empty">暂无标签</span>
      </div>
    </div>

    <!-- 中：筛选 + 列表 -->
    <div class="glass list-panel">
      <div class="filter-row">
        <el-radio-group v-model="filterStatus" size="small">
          <el-radio-button value="all">全部 {{ statusCount.all }}</el-radio-button>
          <el-radio-button value="open">待处理 {{ statusCount.open }}</el-radio-button>
          <el-radio-button value="done">已完成 {{ statusCount.done }}</el-radio-button>
          <el-radio-button value="closed">已关闭 {{ statusCount.closed }}</el-radio-button>
        </el-radio-group>
        <el-button type="primary" size="small" @click="createTodoRoot">
          <el-icon><PlusIcon /></el-icon>新建待办
        </el-button>
      </div>
      <div class="filter-row second">
        <el-input
          v-model="search"
          size="small"
          class="search-input"
          placeholder="搜索标题 / 副标题…"
          clearable
        >
          <template #prefix><el-icon><SearchIcon /></el-icon></template>
        </el-input>
        <el-select v-model="filterPriority" size="small" class="mini-select" clearable placeholder="优先级">
          <el-option v-for="p in PRIORITIES" :key="p.value" :value="p.value" :label="p.label" />
        </el-select>
        <el-select v-model="filterDue" size="small" class="mini-select" placeholder="截止时间">
          <el-option value="all" label="全部时间" />
          <el-option value="today" label="今天截止" />
          <el-option value="week" label="未来 7 天" />
          <el-option value="overdue" label="已逾期" />
          <el-option value="none" label="无截止时间" />
        </el-select>
        <el-select v-model="sortBy" size="small" class="mini-select" placeholder="排序">
          <el-option value="due" label="按截止时间" />
          <el-option value="priority" label="按优先级" />
          <el-option value="title" label="按标题" />
          <el-option value="created" label="按创建时间" />
        </el-select>
      </div>

      <div class="todo-list">
        <template v-for="item in visibleItems" :key="item.todo.id">
          <div
            class="todo-row"
            :class="{ selected: item.todo.id === selectedId, closed: item.todo.status === 'closed', done: item.todo.status === 'done' }"
            @click="selectedId = item.todo.id"
            @contextmenu.prevent="openRowMenu($event, item.todo)"
          >
            <el-checkbox
              class="row-check"
              :model-value="item.todo.status === 'done'"
              @click.stop
              @change="toggleDone(item.todo, $event as boolean)"
            />
            <div class="row-main">
              <div class="row-title-line">
                <span class="row-title" :class="{ done: item.todo.status !== 'open' }">{{ item.todo.title }}</span>
                <span
                  v-if="item.todo.priority !== 4"
                  class="p-badge"
                  :style="{ background: priorityMeta(item.todo.priority).color }"
                >P{{ item.todo.priority }}</span>
                <span v-if="dueBadgeOf(item.todo)" class="due-badge" :data-state="dueState(item.todo)">{{ dueBadgeOf(item.todo) }}</span>
              </div>
              <div class="row-sub" v-if="item.todo.subtitle || item.todo.tags.length || item.todo.sub_total > 0">
                <span v-if="item.todo.subtitle" class="subtitle">{{ item.todo.subtitle }}</span>
                <span v-for="tag in item.todo.tags" :key="tag" class="mini-tag">{{ tag }}</span>
                <span
                  v-if="item.todo.sub_total > 0"
                  class="sub-chip"
                  :class="{ expanded: expanded.has(item.todo.id) }"
                  @click.stop="toggleExpand(item.todo.id)"
                >{{ item.todo.sub_done }}/{{ item.todo.sub_total }} 子任务</span>
              </div>
            </div>
            <span class="row-due">{{ item.todo.due_at ? formatDue(item.todo.due_at) : '' }}</span>
          </div>
          <template v-if="expanded.has(item.todo.id)">
            <div
              v-for="sub in childrenOf(item.todo.id)"
              :key="sub.id"
              class="todo-row subtask"
              :class="{ selected: sub.id === selectedId }"
              @click="selectedId = sub.id"
              @contextmenu.prevent="openRowMenu($event, sub)"
            >
              <el-checkbox
                class="row-check"
                :model-value="sub.status === 'done'"
                @click.stop
                @change="toggleDone(sub, $event as boolean)"
              />
              <div class="row-main">
                <div class="row-title-line">
                  <span class="row-title" :class="{ done: sub.status !== 'open' }">{{ sub.title }}</span>
                  <span v-if="dueBadgeOf(sub)" class="due-badge" :data-state="dueState(sub)">{{ dueBadgeOf(sub) }}</span>
                </div>
              </div>
              <span class="row-due">{{ sub.due_at ? formatDue(sub.due_at) : '' }}</span>
            </div>
          </template>
        </template>
        <div v-if="visibleItems.length === 0" class="list-empty">
          <el-empty :description="emptyText" :image-size="80">
            <el-button v-if="filterStatus === 'open' && visibleItems.length === 0" type="primary" size="small" @click="createTodoRoot">新建待办</el-button>
          </el-empty>
        </div>
      </div>
    </div>

    <!-- 右：详情 -->
    <div class="glass detail-panel">
      <TodoDetail
        v-if="selected"
        :key="selected.id"
        :todo="selected"
        :subtasks="childrenOf(selected.id)"
        :categories="categories"
        :tags="tags"
        @changed="refresh"
        @deleted="onDeleted"
      />
      <div v-else class="detail-empty">
        <el-empty description="选择一条待办查看详情" :image-size="90" />
      </div>
    </div>

    <!-- 行右键菜单 -->
    <teleport to="body">
      <div
        v-if="ctxMenu.visible"
        class="ctx-menu glass"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <template v-if="ctxMenu.todo">
          <div
            v-if="ctxMenu.todo.status === 'open'"
            class="ctx-item"
            @click="ctxRun(() => toggleDone(ctxMenu.todo!, true))"
          >标记完成</div>
          <div class="ctx-item danger" @click="ctxRun(() => removeRow(ctxMenu.todo!))">删除</div>
        </template>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Folder as FolderIcon,
  Plus as PlusIcon,
  Search as SearchIcon
} from '@element-plus/icons-vue'
import TodoDetail from '../components/todos/TodoDetail.vue'
import {
  createTodo,
  createTodoCategory,
  deleteTodo,
  deleteTodoCategory,
  dueState,
  formatDue,
  listTodoCategories,
  listTodos,
  listTodoTags,
  PRIORITIES,
  priorityMeta,
  renameTodoCategory,
  setTodoStatus,
  type Todo,
  type TodoCategory
} from '../api/todo'

type CategoryFilter = 'all' | 'root' | number
type StatusFilter = 'open' | 'done' | 'closed' | 'all'
type DueFilter = 'all' | 'today' | 'week' | 'overdue' | 'none'
type SortBy = 'due' | 'priority' | 'title' | 'created'

const categories = ref<TodoCategory[]>([])
const tags = ref<{ id: number; name: string; count: number }[]>([])
const todos = ref<Todo[]>([])
const selectedId = ref<number | null>(null)
const expanded = ref(new Set<number>())

const filterCategory = ref<CategoryFilter>('all')
// 默认展示「全部」；「全部」Tab 置于最前
const filterStatus = ref<StatusFilter>('all')
const filterPriority = ref<number | null>(null)
const filterDue = ref<DueFilter>('all')
const filterTag = ref<string | null>(null)
const search = ref('')
const sortBy = ref<SortBy>('due')

async function refresh(): Promise<void> {
  try {
    const [cats, tg, td] = await Promise.all([listTodoCategories(), listTodoTags(), listTodos()])
    categories.value = cats
    tags.value = tg
    todos.value = td
    // 选中的待办被删除 → 清空详情
    if (selectedId.value != null && !td.some((t) => t.id === selectedId.value)) {
      selectedId.value = null
    }
  } catch {
    // 失败提示由 http 拦截器统一弹出，这里保持现有列表不变
  }
}

function onDeleted(id: number): void {
  if (selectedId.value === id) selectedId.value = null
  void refresh()
}

// ---- 过滤与排序 ----
// 计数口径：只统计顶层待办（子任务随父级展示，不重复计入分类/根目录）
const rootCount = computed(() => todos.value.filter((t) => t.parent_id == null && t.category_id == null).length)
const topLevelCount = computed(() => todos.value.filter((t) => t.parent_id == null).length)

const statusCount = computed(() => {
  const scoped = todos.value.filter((t) => t.parent_id == null && matchCategory(t) && matchTag(t))
  return {
    open: scoped.filter((t) => t.status === 'open').length,
    done: scoped.filter((t) => t.status === 'done').length,
    closed: scoped.filter((t) => t.status === 'closed').length,
    all: scoped.length
  }
})

function matchCategory(t: Todo): boolean {
  if (filterCategory.value === 'all') return true
  if (filterCategory.value === 'root') return t.category_id == null
  return t.category_id === filterCategory.value
}

function matchTag(t: Todo): boolean {
  return filterTag.value == null || t.tags.includes(filterTag.value)
}

function matchDue(t: Todo): boolean {
  if (filterDue.value === 'all') return true
  if (filterDue.value === 'none') return !t.due_at
  if (!t.due_at) return false
  const due = Date.parse(t.due_at)
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (filterDue.value === 'today') return due >= dayStart && due < dayStart + 86400000
  if (filterDue.value === 'week') return due >= dayStart && due < dayStart + 7 * 86400000
  if (filterDue.value === 'overdue') return due < Date.now() && t.status === 'open'
  return true
}

/** 列表主体 = 顶层待办（分类/标签/状态/搜索/优先级/时间筛选后排序） */
const visibleItems = computed(() => {
  const kw = search.value.trim().toLowerCase()
  const list = todos.value.filter((t) => {
    if (t.parent_id != null) return false
    if (!matchCategory(t) || !matchTag(t) || !matchDue(t)) return false
    if (filterStatus.value !== 'all' && t.status !== filterStatus.value) return false
    if (filterPriority.value != null && t.priority !== filterPriority.value) return false
    if (kw && !`${t.title} ${t.subtitle}`.toLowerCase().includes(kw)) return false
    return true
  })
  const dir = [...list]
  dir.sort((a, b) => {
    if (sortBy.value === 'priority') {
      return a.priority - b.priority || byDue(a, b)
    }
    if (sortBy.value === 'title') {
      return a.title.localeCompare(b.title, 'zh-CN') || byDue(a, b)
    }
    if (sortBy.value === 'created') {
      return b.created_at.localeCompare(a.created_at)
    }
    return byDue(a, b)
  })
  return dir.map((todo) => ({ todo }))
})

function byDue(a: Todo, b: Todo): number {
  const av = a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER
  const bv = b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER
  return av - bv || a.id - b.id
}

function childrenOf(id: number): Todo[] {
  return todos.value
    .filter((t) => t.parent_id === id)
    .sort((a, b) => a.status === b.status ? a.sort - b.sort || a.id - b.id : a.status === 'done' ? 1 : -1)
}

function dueBadgeOf(t: Todo): string {
  const state = dueState(t)
  if (state === 'none') return ''
  const due = Date.parse(t.due_at!)
  const now = Date.now()
  const minutes = Math.round(Math.abs(due - now) / 60000)
  const span = minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时` : `${Math.round(minutes / 1440)} 天`
  return state === 'overdue' ? `已超时 ${span}` : `即将超时 ${span}`
}

const emptyText = computed(() => {
  if (search.value) return '没有匹配的待办'
  if (filterStatus.value === 'open') return '这里没有待处理的事项'
  if (filterStatus.value === 'done') return '还没有已完成的待办'
  if (filterStatus.value === 'closed') return '还没有关闭的待办'
  return '当前筛选下没有待办'
})

const selected = computed(() => todos.value.find((t) => t.id === selectedId.value) ?? null)

function toggleExpand(id: number): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

// ---- 操作 ----
async function toggleDone(t: Todo, checked: boolean): Promise<void> {
  await setTodoStatus(t.id, checked ? 'done' : 'open')
  await refresh()
}

async function createTodoRoot(): Promise<void> {
  await createTodo({
    title: '新待办',
    category_id: typeof filterCategory.value === 'number' ? filterCategory.value : null
  })
  await refresh()
  // 选中新建的第一条
  const fresh = todos.value
    .filter((t) => t.parent_id == null)
    .sort((a, b) => b.id - a.id)
    .find((t) => (typeof filterCategory.value === 'number' ? t.category_id === filterCategory.value : true))
  if (fresh) selectedId.value = fresh.id
  ElMessage.success('已创建')
}

async function addCategory(): Promise<void> {
  const { value } = await ElMessageBox.prompt('分类名称', '新建分类', {
    inputValue: '新分类',
    confirmButtonText: '创建',
    cancelButtonText: '取消'
  })
  const name = (value ?? '').trim()
  if (!name) return
  await createTodoCategory(name)
  await refresh()
  ElMessage.success('分类已创建')
}

async function renameCategory(cat: TodoCategory): Promise<void> {
  const { value } = await ElMessageBox.prompt('新名称', '重命名分类', {
    inputValue: cat.name,
    confirmButtonText: '确定',
    cancelButtonText: '取消'
  })
  const name = (value ?? '').trim()
  if (!name || name === cat.name) return
  await renameTodoCategory(cat.id, name)
  await refresh()
}

async function removeCategory(cat: TodoCategory): Promise<void> {
  await ElMessageBox.confirm(
    `删除分类「${cat.name}」后，其中的 ${cat.count} 条待办将回到根目录。继续吗？`,
    '删除分类',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  )
  await deleteTodoCategory(cat.id)
  if (filterCategory.value === cat.id) filterCategory.value = 'all'
  await refresh()
  ElMessage.success('分类已删除')
}

// ---- 行右键菜单 ----
const ctxMenu = ref<{ visible: boolean; x: number; y: number; todo: Todo | null }>({
  visible: false,
  x: 0,
  y: 0,
  todo: null
})

function openRowMenu(event: MouseEvent, todo: Todo): void {
  selectedId.value = todo.id
  ctxMenu.value = { visible: true, x: event.clientX, y: event.clientY, todo }
  window.addEventListener('click', closeCtxMenu, { once: true })
}

function closeCtxMenu(): void {
  ctxMenu.value.visible = false
}

function ctxRun(fn: () => void): void {
  closeCtxMenu()
  fn()
}

async function removeRow(todo: Todo): Promise<void> {
  await ElMessageBox.confirm(
    todo.parent_id != null
      ? `删除子任务「${todo.title}」后不可恢复。继续吗？`
      : `删除待办「${todo.title}」后，其子任务与评论将一并删除。继续吗？`,
    '删除待办',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  )
  await deleteTodo(todo.id)
  await refresh()
  ElMessage.success('待办已删除')
}

onMounted(refresh)

// App.vue 用 keep-alive 缓存页面，切回待办页不会重新挂载。
// 首次挂载已由 onMounted 拉取，之后每次激活都刷新，避免外部写入（脚本导入 / AI 助手 / 其他窗口）后列表过期。
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
.todos-page {
  height: 100%;
  overflow: hidden;
  flex-direction: row;
  gap: 14px;
}

/* 左侧分类/标签 */
.side-panel {
  width: 216px;
  flex-shrink: 0;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  padding: 6px 8px 6px;
}

.side-add {
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
}

.side-add:hover {
  background: var(--fill-hover);
  color: var(--accent);
}

.tag-title {
  margin-top: 10px;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ink-2);
}

.cat-row:hover {
  background: var(--fill-hover);
}

.cat-row.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.cat-icon {
  flex-shrink: 0;
  color: var(--ink-3);
}

.cat-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-count {
  font-size: 11px;
  color: var(--ink-3);
}

.cat-actions {
  display: none;
  align-items: center;
  gap: 3px;
}

.cat-row:hover .cat-actions {
  display: inline-flex;
}

.cat-actions .el-icon {
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
}

.cat-actions .el-icon:hover {
  background: var(--fill-hover);
}

.cat-actions .danger:hover {
  color: var(--el-color-danger);
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 8px;
}

.tag-chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--fill-subtle);
  color: var(--ink-2);
  cursor: pointer;
  border: 1px solid transparent;
}

.tag-chip i {
  font-style: normal;
  color: var(--ink-3);
  font-size: 11px;
}

.tag-chip:hover {
  border-color: var(--accent-border);
}

.tag-chip.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
  border-color: var(--accent-border);
}

.tag-empty {
  font-size: 12px;
  color: var(--ink-3);
}

/* 中间列表 */
.list-panel {
  width: 420px;
  flex-shrink: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.filter-row.second {
  flex-wrap: wrap;
}

.search-input {
  flex: 1 1 100%;
  min-width: 0;
}

.mini-select {
  width: 118px;
  flex-shrink: 0;
}

.todo-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.todo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;
}

.todo-row:hover {
  background: var(--fill-hover);
}

.todo-row.selected {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.todo-row.subtask {
  margin-left: 26px;
  padding: 5px 10px;
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

.list-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 右侧详情 */
.detail-panel {
  flex: 1;
  min-width: 0;
  padding: 16px;
  overflow-y: auto;
}

.detail-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 行右键菜单 */
.ctx-menu {
  position: fixed;
  z-index: 3000;
  min-width: 132px;
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

.ctx-item.danger {
  color: var(--el-color-danger);
}
</style>

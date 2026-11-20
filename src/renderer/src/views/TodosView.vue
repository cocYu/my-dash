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

    <!-- 中：视图主体 -->
    <div class="glass list-panel">
      <QuickAddBar
        ref="quickAddRef"
        :category-names="categoryNames"
        :default-category-id="defaultCategoryId"
        @created="onQuickCreated"
      />

      <div class="filter-row">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="today">今日</el-radio-button>
          <el-radio-button value="list">列表</el-radio-button>
          <el-radio-button value="kanban">看板</el-radio-button>
        </el-radio-group>
        <div class="filter-actions">
          <el-checkbox
            v-if="viewMode === 'list'"
            v-model="batchMode"
            class="batch-toggle"
            label="批量管理"
            size="small"
          />
          <el-button size="small" @click="trashOpen = true">
            <el-icon><DeleteIcon /></el-icon>回收站{{ trashItems.length ? ` ${trashItems.length}` : '' }}
          </el-button>
          <el-button type="primary" size="small" @click="createTodoRoot">
            <el-icon><PlusIcon /></el-icon>新建待办
          </el-button>
        </div>
      </div>

      <!-- 列表视图筛选 -->
      <div v-if="viewMode === 'list'" class="filter-row second">
        <el-input
          v-model="search"
          size="small"
          class="search-input"
          placeholder="搜索标题 / 副标题…"
          clearable
        >
          <template #prefix><el-icon><SearchIcon /></el-icon></template>
        </el-input>
        <el-radio-group v-model="filterStatus" size="small">
          <el-radio-button value="all">全部 {{ statusCount.all }}</el-radio-button>
          <el-radio-button value="open">待处理 {{ statusCount.open }}</el-radio-button>
          <el-radio-button value="done">已完成 {{ statusCount.done }}</el-radio-button>
          <el-radio-button value="closed">已关闭 {{ statusCount.closed }}</el-radio-button>
        </el-radio-group>
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
          <el-option value="manual" label="手动排序" />
          <el-option value="due" label="按截止时间" />
          <el-option value="priority" label="按优先级" />
          <el-option value="title" label="按标题" />
          <el-option value="created" label="按创建时间" />
        </el-select>
        <el-select v-model="groupBy" size="small" class="mini-select" placeholder="分组">
          <el-option value="none" label="不分组" />
          <el-option value="priority" label="按优先级" />
          <el-option value="tag" label="按标签" />
          <el-option value="due" label="按截止时间" />
        </el-select>
      </div>

      <!-- 今日 / 列表视图共用的搜索框 -->
      <div v-if="viewMode === 'today'" class="filter-row second">
        <el-input
          v-model="search"
          size="small"
          class="search-input"
          placeholder="在今日视图中搜索…"
          clearable
        >
          <template #prefix><el-icon><SearchIcon /></el-icon></template>
        </el-input>
      </div>

      <!-- 批量工具条 -->
      <div v-if="batchMode && viewMode === 'list'" class="batch-bar">
        <span class="batch-count">已选 {{ selectedIds.size }} 条</span>
        <el-button size="small" @click="selectAllVisible">{{ allVisibleSelected ? '取消全选' : '全选' }}</el-button>
        <el-button size="small" type="primary" :disabled="!selectedIds.size" @click="batchRun('done')">完成</el-button>
        <el-button size="small" :disabled="!selectedIds.size" @click="batchRun('open')">重开</el-button>
        <el-select
          class="batch-cat"
          size="small"
          placeholder="移动到分类…"
          :disabled="!selectedIds.size"
          @change="(v: number) => batchRun('category', { category_id: v })"
        >
          <el-option :value="0" label="根目录" />
          <el-option v-for="cat in categories" :key="cat.id" :value="cat.id" :label="cat.name" />
        </el-select>
        <el-button size="small" :disabled="!selectedIds.size" @click="batchTags(true)">加标签</el-button>
        <el-button size="small" :disabled="!selectedIds.size" @click="batchTags(false)">删标签</el-button>
        <el-button size="small" type="danger" plain :disabled="!selectedIds.size" @click="batchRun('delete')">删除</el-button>
        <span class="batch-hint">支持 Shift + 点击范围选择</span>
      </div>

      <!-- 今日视图 -->
      <div v-if="viewMode === 'today'" class="todo-list">
        <template v-for="group in todayGroups" :key="group.key">
          <div v-if="group.items.length" class="group-head" :data-tone="group.tone">
            <span class="group-dot" />
            <span class="group-label">{{ group.label }}</span>
            <span class="group-count">{{ group.items.length }}</span>
          </div>
          <template v-for="item in group.items" :key="item.todo.id">
            <TodoRow
              :todo="item.todo"
              :selected="item.todo.id === selectedId"
              @select="(e) => onRowClick(item.todo, e)"
              @toggle-done="(c) => toggleDone(item.todo, c)"
              @contextmenu="(e) => openRowMenu(e, item.todo)"
              @toggle-expand="selectForDetail(item.todo)"
            />
          </template>
        </template>
        <div v-if="todayTotal === 0" class="list-empty">
          <EmptyState compact title="今天没有需要处理的事" hint="用上方输入框随手记一条，或去列表视图规划">
            <el-button type="primary" size="small" @click="createTodoRoot">新建待办</el-button>
          </EmptyState>
        </div>
      </div>

      <!-- 列表视图（可分组） -->
      <div v-else-if="viewMode === 'list'" class="todo-list">
        <template v-if="groupedView">
          <template v-for="group in groupedView" :key="group.key">
            <div class="group-head collapsible" @click="toggleGroup(group.key)">
              <el-icon class="group-arrow" :class="{ folded: collapsedGroups.has(group.key) }"><ArrowIcon /></el-icon>
              <span class="group-label">{{ group.label }}</span>
              <span class="group-count">{{ group.items.length }}</span>
            </div>
            <template v-if="!collapsedGroups.has(group.key)">
              <template v-for="item in group.items" :key="item.todo.id">
                <TodoRow
                  :todo="item.todo"
                  :selected="item.todo.id === selectedId"
                  :batch-mode="batchMode"
                  :checked="selectedIds.has(item.todo.id)"
                  :draggable="manualSortActive"
                  :drag-over="dragOverId === item.todo.id"
                  :expanded="expanded.has(item.todo.id)"
                  @select="(e) => onRowClick(item.todo, e)"
                  @toggle-done="(c) => toggleDone(item.todo, c)"
                  @check="onCheckRow(item.todo, false)"
                  @contextmenu="(e) => openRowMenu(e, item.todo)"
                  @toggle-expand="toggleExpand(item.todo.id)"
                  @dragstart="onDragStart(item.todo, $event)"
                  @dragover="dragOverId = item.todo.id"
                  @drop="onDropRow(item.todo.id)"
                  @dragend="resetDrag"
                />
                <template v-if="expanded.has(item.todo.id)">
                  <TodoRow
                    v-for="sub in childrenOf(item.todo.id)"
                    :key="sub.id"
                    :todo="sub"
                    subtask
                    :selected="sub.id === selectedId"
                    @select="() => (selectedId = sub.id)"
                    @toggle-done="(c) => toggleDone(sub, c)"
                    @contextmenu="(e) => openRowMenu(e, sub)"
                  />
                </template>
              </template>
            </template>
          </template>
        </template>
        <template v-else>
          <template v-for="item in visibleItems" :key="item.todo.id">
            <TodoRow
              :todo="item.todo"
              :selected="item.todo.id === selectedId"
              :batch-mode="batchMode"
              :checked="selectedIds.has(item.todo.id)"
              :draggable="manualSortActive"
              :drag-over="dragOverId === item.todo.id"
              :expanded="expanded.has(item.todo.id)"
              @select="(e) => onRowClick(item.todo, e)"
              @toggle-done="(c) => toggleDone(item.todo, c)"
              @check="onCheckRow(item.todo, false)"
              @contextmenu="(e) => openRowMenu(e, item.todo)"
              @toggle-expand="toggleExpand(item.todo.id)"
              @dragstart="onDragStart(item.todo, $event)"
              @dragover="dragOverId = item.todo.id"
              @drop="onDropRow(item.todo.id)"
              @dragend="resetDrag"
            />
            <template v-if="expanded.has(item.todo.id)">
              <TodoRow
                v-for="sub in childrenOf(item.todo.id)"
                :key="sub.id"
                :todo="sub"
                subtask
                :selected="sub.id === selectedId"
                @select="() => (selectedId = sub.id)"
                @toggle-done="(c) => toggleDone(sub, c)"
                @contextmenu="(e) => openRowMenu(e, sub)"
              />
            </template>
          </template>
        </template>
        <div v-if="visibleItems.length === 0" class="list-empty">
          <EmptyState compact :title="emptyText" hint="可以换个筛选条件，或直接新建一条">
            <el-button v-if="filterStatus === 'open'" type="primary" size="small" @click="createTodoRoot">新建待办</el-button>
          </EmptyState>
        </div>
      </div>

      <!-- 看板视图 -->
      <TodoKanban
        v-else
        :items="kanbanItems"
        :selected-id="selectedId"
        @select="(id) => (selectedId = id)"
        @status-change="(id, status) => changeStatus(id, status)"
      />
    </div>

    <!-- 右：详情（未选中时整块收起，把宽度让给列表） -->
    <div v-if="selected" class="glass detail-panel">
      <TodoDetail
        :key="selected.id"
        :todo="selected"
        :subtasks="childrenOf(selected.id)"
        :categories="categories"
        :tags="tags"
        @changed="refresh"
        @deleted="onDeleted"
      />
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
          <div
            v-else
            class="ctx-item"
            @click="ctxRun(() => toggleDone(ctxMenu.todo!, false))"
          >重新开启</div>
          <template v-if="manualSortActive && ctxMenu.todo.parent_id == null">
            <div class="ctx-item" @click="ctxRun(() => moveRow(ctxMenu.todo!.id, -1))">上移</div>
            <div class="ctx-item" @click="ctxRun(() => moveRow(ctxMenu.todo!.id, 1))">下移</div>
          </template>
          <div class="ctx-item danger" @click="ctxRun(() => removeRow(ctxMenu.todo!))">移入回收站</div>
        </template>
      </div>
    </teleport>

    <!-- 回收站 -->
    <TodoTrash
      v-model:visible="trashOpen"
      :items="trashItems"
      @restore="restoreOne"
      @purge="purgeOne"
      @clear="clearTrash"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import {
  ArrowDown as ArrowIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Folder as FolderIcon,
  Plus as PlusIcon,
  Search as SearchIcon
} from '@element-plus/icons-vue'
import TodoDetail from '../components/todos/TodoDetail.vue'
import TodoKanban from '../components/todos/TodoKanban.vue'
import TodoRow from '../components/todos/TodoRow.vue'
import TodoTrash from '../components/todos/TodoTrash.vue'
import QuickAddBar from '../components/todos/QuickAddBar.vue'
import EmptyState from '../components/EmptyState.vue'
import {
  batchTodos,
  createTodo,
  createTodoCategory,
  deleteTodo,
  deleteTodoCategory,
  listTodoCategories,
  listTodos,
  listTodoTags,
  listTrash,
  PRIORITIES,
  purgeTodo,
  renameTodoCategory,
  restoreTodo,
  setTodoStatus,
  sortTodos,
  updateTodo,
  type BatchOp,
  type Todo,
  type TodoCategory,
  type TodoStatus
} from '../api/todo'

type CategoryFilter = 'all' | 'root' | number
type StatusFilter = 'open' | 'done' | 'closed' | 'all'
type DueFilter = 'all' | 'today' | 'week' | 'overdue' | 'none'
type SortBy = 'manual' | 'due' | 'priority' | 'title' | 'created'
type ViewMode = 'today' | 'list' | 'kanban'
type GroupBy = 'none' | 'priority' | 'tag' | 'due'

const DAY = 86_400_000
const LS_VIEW = 'mydash.todos.viewMode'
const LS_GROUP = 'mydash.todos.groupBy'

const categories = ref<TodoCategory[]>([])
const tags = ref<{ id: number; name: string; count: number }[]>([])
const todos = ref<Todo[]>([])
const trashItems = ref<Todo[]>([])
const selectedId = ref<number | null>(null)
const expanded = ref(new Set<number>())

const filterCategory = ref<CategoryFilter>('all')
const filterStatus = ref<StatusFilter>('all')
const filterPriority = ref<number | null>(null)
const filterDue = ref<DueFilter>('all')
const filterTag = ref<string | null>(null)
const search = ref('')

const viewMode = ref<ViewMode>(readLS<ViewMode>(LS_VIEW, 'today'))
watch(viewMode, (v) => localStorage.setItem(LS_VIEW, v))
const groupBy = ref<GroupBy>(readLS<GroupBy>(LS_GROUP, 'none'))
watch(groupBy, (v) => localStorage.setItem(LS_GROUP, v))
const collapsedGroups = ref(new Set<string>())
const sortBy = ref<SortBy>('due')

const batchMode = ref(false)
const selectedIds = ref(new Set<number>())
const lastCheckedId = ref<number | null>(null)

const dragId = ref<number | null>(null)
const dragOverId = ref<number | null>(null)
const trashOpen = ref(false)
const quickAddRef = ref<InstanceType<typeof QuickAddBar> | null>(null)

function readLS<T extends string>(key: string, fallback: T): T {
  const v = localStorage.getItem(key)
  return v === 'today' || v === 'list' || v === 'kanban' || v === 'none' || v === 'priority' || v === 'tag' || v === 'due'
    ? (v as T)
    : fallback
}

async function refresh(): Promise<void> {
  try {
    const [cats, tg, td, trash] = await Promise.all([listTodoCategories(), listTodoTags(), listTodos(), listTrash()])
    categories.value = cats
    tags.value = tg
    todos.value = td
    trashItems.value = trash
    // 选中的待办被删除 → 清空详情
    if (selectedId.value != null && !td.some((t) => t.id === selectedId.value)) {
      selectedId.value = null
    }
    // 批量选择里已不存在的项清掉
    if (selectedIds.value.size) {
      const alive = new Set(td.map((t) => t.id))
      const next = new Set([...selectedIds.value].filter((id) => alive.has(id)))
      selectedIds.value = next
    }
  } catch {
    // 失败提示由 http 拦截器统一弹出，这里保持现有列表不变
  }
}

function onDeleted(id: number): void {
  if (selectedId.value === id) selectedId.value = null
  void refresh()
}

// ---- 过滤 ----
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

function matchSearch(t: Todo): boolean {
  const kw = search.value.trim().toLowerCase()
  return !kw || `${t.title} ${t.subtitle}`.toLowerCase().includes(kw)
}

function matchDue(t: Todo): boolean {
  if (filterDue.value === 'all') return true
  if (filterDue.value === 'none') return !t.due_at
  if (!t.due_at) return false
  const due = Date.parse(t.due_at)
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (filterDue.value === 'today') return due >= dayStart && due < dayStart + DAY
  if (filterDue.value === 'week') return due >= dayStart && due < dayStart + 7 * DAY
  if (filterDue.value === 'overdue') return due < Date.now() && t.status === 'open'
  return true
}

/** 列表视图数据：顶层 + 全部筛选 + 排序（手动排序按 sort,id） */
const visibleItems = computed(() => {
  const list = todos.value.filter((t) => {
    if (t.parent_id != null) return false
    if (!matchCategory(t) || !matchTag(t) || !matchSearch(t) || !matchDue(t)) return false
    if (filterStatus.value !== 'all' && t.status !== filterStatus.value) return false
    if (filterPriority.value != null && t.priority !== filterPriority.value) return false
    return true
  })
  const dir = [...list]
  dir.sort((a, b) => {
    if (sortBy.value === 'manual') {
      return a.sort - b.sort || a.id - b.id
    }
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

const manualSortActive = computed(
  () => viewMode.value === 'list' && sortBy.value === 'manual' && groupBy.value === 'none' && !batchMode.value
)

/** 手动排序的全局顶层顺序（拖拽/上移下移以它为基准重排） */
const manualOrder = computed(() =>
  todos.value
    .filter((t) => t.parent_id == null)
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((t) => t.id)
)

function byDue(a: Todo, b: Todo): number {
  const av = a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER
  const bv = b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER
  return av - bv || a.id - b.id
}

function childrenOf(id: number): Todo[] {
  return todos.value
    .filter((t) => t.parent_id === id)
    .sort((a, b) => (a.status === b.status ? a.sort - b.sort || a.id - b.id : a.status === 'done' ? 1 : -1))
}

// ---- 今日视图：逾期 → 今天截止 → 今天开始 → 高优先级，逐组去重 ----
interface DisplayGroup {
  key: string
  label: string
  tone: 'danger' | 'warn' | 'accent' | 'normal'
  items: { todo: Todo }[]
}

const todayGroups = computed<DisplayGroup[]>(() => {
  const base = todos.value.filter(
    (t) => t.parent_id == null && t.status === 'open' && matchCategory(t) && matchTag(t) && matchSearch(t)
  )
  const now = Date.now()
  const nowDate = new Date()
  const dayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const dayEnd = dayStart + DAY
  const seen = new Set<number>()
  const pick = (list: Todo[]): { todo: Todo }[] =>
    list.filter((t) => !seen.has(t.id) && (seen.add(t.id), true)).map((todo) => ({ todo })).sort((a, b) => byDue(a.todo, b.todo))

  const overdue = pick(base.filter((t) => t.due_at && Date.parse(t.due_at) < now))
  const dueToday = pick(base.filter((t) => t.due_at && Date.parse(t.due_at) >= dayStart && Date.parse(t.due_at) < dayEnd))
  const startToday = pick(
    base.filter((t) => t.start_at && Date.parse(t.start_at) >= dayStart && Date.parse(t.start_at) < dayEnd)
  )
  const high = pick(
    base.filter((t) => t.priority <= 2).sort((a, b) => a.priority - b.priority)
  )
  return [
    { key: 'overdue', label: '已逾期', tone: 'danger', items: overdue },
    { key: 'due', label: '今天截止', tone: 'warn', items: dueToday },
    { key: 'start', label: '今天开始', tone: 'accent', items: startToday },
    { key: 'high', label: '高优先级（P0 - P2）', tone: 'normal', items: high }
  ]
})

const todayTotal = computed(() => todayGroups.value.reduce((sum, g) => sum + g.items.length, 0))

// ---- 列表视图分组 ----
interface ListGroup {
  key: string
  label: string
  items: { todo: Todo }[]
}

const groupedView = computed<ListGroup[] | null>(() => {
  if (viewMode.value !== 'list' || groupBy.value === 'none') return null
  const list = visibleItems.value
  if (groupBy.value === 'priority') {
    const byPrio = new Map<number, Todo[]>()
    for (const { todo } of list) {
      const arr = byPrio.get(todo.priority) ?? []
      arr.push(todo)
      byPrio.set(todo.priority, arr)
    }
    return [...byPrio.keys()]
      .sort((a, b) => a - b)
      .map((p) => ({
        key: `p${p}`,
        label: PRIORITIES[p].label,
        items: byPrio.get(p)!.map((todo) => ({ todo }))
      }))
  }
  if (groupBy.value === 'tag') {
    const byTag = new Map<string, Todo[]>()
    for (const { todo } of list) {
      const key = [...todo.tags].sort()[0] ?? '未标签'
      const arr = byTag.get(key) ?? []
      arr.push(todo)
      byTag.set(key, arr)
    }
    return [...byTag.keys()]
      .sort((a, b) => (a === '未标签' ? 1 : b === '未标签' ? -1 : a.localeCompare(b, 'zh-CN')))
      .map((name) => ({ key: `t:${name}`, label: name === '未标签' ? '未标签' : `#${name}`, items: byTag.get(name)!.map((todo) => ({ todo })) }))
  }
  // 按截止时间分桶
  const now = Date.now()
  const nowDate = new Date()
  const dayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const buckets: { key: string; label: string; test: (t: Todo) => boolean }[] = [
    { key: 'overdue', label: '已逾期', test: (t) => t.status === 'open' && !!t.due_at && Date.parse(t.due_at) < now },
    { key: 'today', label: '今天截止', test: (t) => !!t.due_at && Date.parse(t.due_at) >= dayStart && Date.parse(t.due_at) < dayStart + DAY },
    { key: 'week', label: '未来 7 天', test: (t) => !!t.due_at && Date.parse(t.due_at) >= dayStart + DAY && Date.parse(t.due_at) < dayStart + 7 * DAY },
    { key: 'later', label: '更远', test: (t) => !!t.due_at && Date.parse(t.due_at) >= dayStart + 7 * DAY },
    { key: 'none', label: '无截止时间', test: (t) => !t.due_at }
  ]
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    items: list.filter((x) => b.test(x.todo)).map((x) => ({ todo: x.todo }))
  })).filter((g) => g.items.length > 0)
})

function toggleGroup(key: string): void {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroups.value = next
}

// ---- 看板 ----
const kanbanItems = computed(() =>
  todos.value.filter((t) => {
    if (t.parent_id != null) return false
    if (!matchCategory(t) || !matchTag(t) || !matchSearch(t) || !matchDue(t)) return false
    if (filterPriority.value != null && t.priority !== filterPriority.value) return false
    return true
  })
)

async function changeStatus(id: number, status: TodoStatus): Promise<void> {
  await setTodoStatus(id, status)
  await refresh()
  ElMessage.success(status === 'done' ? '已完成' : status === 'closed' ? '已关闭' : '已重新开启')
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

function selectForDetail(t: Todo): void {
  selectedId.value = t.id
}

// ---- 行交互 ----
function onRowClick(t: Todo, e: MouseEvent): void {
  // 批量模式：点击行即切换选择（Shift 范围选择）
  if (batchMode.value && viewMode.value === 'list') {
    onCheckRow(t, e.shiftKey)
    return
  }
  selectedId.value = t.id
}

function onCheckRow(t: Todo, shift: boolean): void {
  const next = new Set(selectedIds.value)
  const anchor = lastCheckedId.value
  if (shift && anchor != null) {
    const order = visibleItems.value.map((i) => i.todo.id)
    const from = order.indexOf(anchor)
    const to = order.indexOf(t.id)
    if (from >= 0 && to >= 0) {
      const [lo, hi] = from < to ? [from, to] : [to, from]
      for (let i = lo; i <= hi; i++) next.add(order[i])
    }
  } else if (next.has(t.id)) {
    next.delete(t.id)
  } else {
    next.add(t.id)
  }
  selectedIds.value = next
  lastCheckedId.value = t.id
}

const allVisibleSelected = computed(
  () => visibleItems.value.length > 0 && visibleItems.value.every((i) => selectedIds.value.has(i.todo.id))
)

function selectAllVisible(): void {
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) {
    for (const i of visibleItems.value) next.delete(i.todo.id)
  } else {
    for (const i of visibleItems.value) next.add(i.todo.id)
  }
  selectedIds.value = next
}

watch(batchMode, (on) => {
  if (!on) {
    selectedIds.value = new Set()
    lastCheckedId.value = null
  }
})

function todoById(id: number): Todo | undefined {
  return todos.value.find((t) => t.id === id)
}

// ---- 批量操作（带撤销） ----
async function batchRun(op: BatchOp, payload?: { category_id?: number | null; tags?: string[] }): Promise<void> {
  const ids = [...selectedIds.value]
  if (ids.length === 0) {
    ElMessage.warning('请先勾选待办')
    return
  }
  if (op === 'delete') {
    await ElMessageBox.confirm(
      `将把选中的 ${ids.length} 条待办移入回收站（子任务一并移入，30 天内可恢复）。继续吗？`,
      '批量删除',
      { type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消' }
    )
  }
  // 撤销快照：状态与分类可精确还原；标签与删除不做撤销（删除可从回收站找回）
  let undo: (() => Promise<void>) | null = null
  if (op === 'done' || op === 'open' || op === 'closed') {
    const prev = ids
      .map((id) => ({ id, status: todoById(id)?.status }))
      .filter((p): p is { id: number; status: TodoStatus } => !!p.status)
    undo = async () => {
      for (const p of prev) await setTodoStatus(p.id, p.status)
      await refresh()
    }
  } else if (op === 'category') {
    const prev = ids.map((id) => ({ id, category_id: todoById(id)?.category_id ?? null }))
    undo = async () => {
      for (const p of prev) {
        // 后端以 0 表示「移到根目录」，null 表示不修改
        await updateTodo(p.id, { category_id: p.category_id ?? 0 })
      }
      await refresh()
    }
  }

  await batchTodos(ids, op, payload)
  await refresh()
  const label =
    op === 'done'
      ? `已完成 ${ids.length} 条`
      : op === 'open'
        ? `已重开 ${ids.length} 条`
        : op === 'closed'
          ? `已关闭 ${ids.length} 条`
          : op === 'category'
            ? '已移动分类'
            : op === 'delete'
              ? '已移入回收站'
              : op === 'tags_add'
                ? '已添加标签'
                : '已移除标签'
  if (undo) {
    const handle = ElNotification({
      title: label,
      message: '点击撤销本次批量操作',
      type: 'success',
      duration: 6000,
      onClick: () => {
        handle.close()
        void undo?.().then(() => ElMessage.success('已撤销'))
      }
    })
  } else {
    ElMessage.success(label)
  }
}

async function batchTags(add: boolean): Promise<void> {
  const { value } = await ElMessageBox.prompt(
    add ? '输入要添加的标签，多个用空格分隔' : '输入要移除的标签，多个用空格分隔',
    add ? '批量加标签' : '批量删标签',
    {
      confirmButtonText: add ? '添加' : '移除',
      cancelButtonText: '取消',
      inputPattern: /\S/,
      inputErrorMessage: '请输入至少一个标签'
    }
  )
  const names = (value ?? '').trim().split(/\s+/).filter(Boolean)
  if (names.length === 0) return
  await batchRun(add ? 'tags_add' : 'tags_remove', { tags: names })
}

// ---- 手动排序 ----
function onDragStart(t: Todo, e: DragEvent): void {
  dragId.value = t.id
  e.dataTransfer?.setData('text/plain', String(t.id))
  e.dataTransfer?.setDragImage?.(e.currentTarget as HTMLElement, 0, 0)
}

async function onDropRow(targetId: number): Promise<void> {
  const from = dragId.value
  dragOverId.value = null
  dragId.value = null
  if (from == null || from === targetId) return
  const arr = [...manualOrder.value]
  const fi = arr.indexOf(from)
  const ti = arr.indexOf(targetId)
  if (fi < 0 || ti < 0) return
  arr.splice(fi, 1)
  arr.splice(ti, 0, from)
  await sortTodos(arr)
  await refresh()
}

function resetDrag(): void {
  dragId.value = null
  dragOverId.value = null
}

async function moveRow(id: number, dir: -1 | 1): Promise<void> {
  const arr = [...manualOrder.value]
  const i = arr.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  await sortTodos(arr)
  await refresh()
}

// ---- 操作 ----
async function toggleDone(t: Todo, checked: boolean): Promise<void> {
  await setTodoStatus(t.id, checked ? 'done' : 'open')
  await refresh()
}

function selectNewest(): void {
  const fresh = todos.value.filter((t) => t.parent_id == null).sort((a, b) => b.id - a.id)[0]
  if (fresh) selectedId.value = fresh.id
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

function onQuickCreated(): void {
  void refresh().then(selectNewest)
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
  if (batchMode.value) return
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
  await deleteTodo(todo.id)
  await refresh()
  const handle = ElNotification({
    title: `已移入回收站「${todo.title}」`,
    message: '点击撤销（恢复）',
    type: 'success',
    duration: 6000,
    onClick: () => {
      handle.close()
      void restoreTodo(todo.id).then(() => refresh()).then(() => ElMessage.success('已恢复'))
    }
  })
}

// ---- 回收站 ----
async function restoreOne(id: number): Promise<void> {
  await restoreTodo(id)
  await refresh()
  ElMessage.success('已恢复')
}

async function purgeOne(id: number): Promise<void> {
  await purgeTodo(id)
  await refresh()
  ElMessage.success('已彻底删除')
}

async function clearTrash(): Promise<void> {
  const ids = trashItems.value.map((t) => t.id)
  if (ids.length === 0) return
  for (const id of ids) {
    await purgeTodo(id)
  }
  await refresh()
  ElMessage.success(`已清空回收站（${ids.length} 条）`)
}

const categoryNames = computed(() => categories.value.map((c) => c.name))
const defaultCategoryId = computed(() => (typeof filterCategory.value === 'number' ? filterCategory.value : null))

onMounted(() => {
  void refresh()
  window.addEventListener('mydash:new-todo', onPaletteNewTodo)
})

// 命令面板「新建待办」
function onPaletteNewTodo(): void {
  if (viewMode.value === 'kanban') viewMode.value = 'list'
  void createTodoRoot()
}

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

onBeforeUnmount(() => window.removeEventListener('mydash:new-todo', onPaletteNewTodo))
</script>

<style scoped>
.todos-page {
  height: 100%;
  overflow: hidden;
  flex-direction: row;
  gap: 16px;
}

/* 左侧分类/标签 */
.side-panel {
  width: 220px;
  flex-shrink: 0;
  padding: 10px;
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

/* 中间视图 */
.list-panel {
  flex: 1.15 1 0;
  min-width: 0;
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

.filter-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-toggle {
  height: auto;
  margin-right: 2px;
}

.filter-row.second {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.search-input {
  flex: 1 1 100%;
  min-width: 0;
}

.mini-select {
  flex: 1 1 0;
  min-width: 84px;
}

.batch-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
}

.batch-count {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent-strong);
}

.batch-cat {
  width: 140px;
}

.batch-hint {
  font-size: 11px;
  color: var(--ink-3);
  margin-left: auto;
}

.todo-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 分组头 */
.group-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 4px 4px;
  user-select: none;
}

.group-head.collapsible {
  cursor: pointer;
}

.group-head:hover .group-label {
  color: var(--ink-1);
}

.group-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-3);
}

.group-head[data-tone='danger'] .group-dot {
  background: #e5484d;
}

.group-head[data-tone='warn'] .group-dot {
  background: #ff9f1a;
}

.group-head[data-tone='accent'] .group-dot {
  background: var(--accent);
}

.group-label {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ink-2);
}

.group-count {
  font-size: 11px;
  color: var(--ink-3);
}

.group-arrow {
  color: var(--ink-3);
  transition: transform var(--dur-fast) var(--ease);
}

.group-arrow.folded {
  transform: rotate(-90deg);
}

.list-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 右侧详情 */
.detail-panel {
  flex: 1 1 0;
  min-width: 0;
  padding: 16px;
  overflow-y: auto;
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

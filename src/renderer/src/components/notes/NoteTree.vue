<template>
  <div class="note-tree">
    <div class="tree-toolbar">
      <el-tooltip content="新建根文件夹" placement="top">
        <el-button size="small" text @click="createFolder(null)"><el-icon><FolderAddIcon /></el-icon></el-button>
      </el-tooltip>
      <el-tooltip content="新建根笔记" placement="top">
        <el-button size="small" text @click="createNote(null)"><el-icon><DocumentAddIcon /></el-icon></el-button>
      </el-tooltip>
      <el-dropdown trigger="click" @command="(cmd: string) => void onImportCommand(cmd)">
        <el-button size="small" text title="导入 Markdown（文件 / 文件夹）">
          <el-icon><UploadIcon /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="files">导入 Markdown 文件…</el-dropdown-item>
            <el-dropdown-item command="folder">导入 Markdown 文件夹…</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-tooltip content="创建 Markdown 语法全览示例笔记" placement="top">
        <el-button size="small" text @click="createSample"><el-icon><TicketsIcon /></el-icon></el-button>
      </el-tooltip>
    </div>
    <el-input v-model="filterText" size="small" placeholder="搜索…" clearable class="tree-search">
      <template #prefix><el-icon><SearchIcon /></el-icon></template>
    </el-input>

    <el-tree
      ref="treeRef"
      class="tree"
      :data="treeData"
      node-key="id"
      default-expand-all
      highlight-current
      draggable
      :expand-on-click-node="false"
      :filter-node-method="filterNode"
      :allow-drop="allowDrop"
      @node-click="onNodeClick"
      @node-drop="onNodeDrop"
      @node-contextmenu="onContextMenu"
    >
      <template #default="{ data }">
        <div class="tree-row" @dblclick="renameNode(data)">
          <el-icon class="row-icon">
            <component :is="iconOf(data)" />
          </el-icon>
          <span class="row-label">{{ data.label }}</span>
          <span class="row-actions" @click.stop>
            <template v-if="data.kind === 'folder'">
              <el-icon title="新建笔记" @click.stop="createNote(data.rawId)"><DocumentAddIcon /></el-icon>
              <el-icon title="新建子文件夹" @click.stop="createFolder(data.rawId)"><FolderAddIcon /></el-icon>
            </template>
            <el-icon title="重命名（也可双击）" @click.stop="renameNode(data)"><EditPenIcon /></el-icon>
            <el-icon title="删除" class="danger" @click.stop="removeNode(data)"><DeleteIcon /></el-icon>
          </span>
        </div>
      </template>
    </el-tree>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div
        v-if="ctxMenu.visible"
        class="ctx-menu glass"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <template v-if="ctxMenu.node?.kind === 'folder'">
          <div class="ctx-item" @click="ctxRun(() => createNote(ctxMenu.node!.rawId))">新建笔记</div>
          <div class="ctx-item" @click="ctxRun(() => createFolder(ctxMenu.node!.rawId))">新建子文件夹</div>
          <div class="ctx-item" @click="ctxRun(() => importFiles(ctxMenu.node!.rawId))">导入 Markdown…</div>
          <div class="ctx-item" @click="ctxRun(() => renameNode(ctxMenu.node!))">重命名</div>
          <div class="ctx-item danger" @click="ctxRun(() => removeNode(ctxMenu.node!))">删除</div>
        </template>
        <template v-else-if="ctxMenu.node">
          <div class="ctx-item" @click="ctxRun(() => renameNode(ctxMenu.node!))">重命名</div>
          <div class="ctx-item danger" @click="ctxRun(() => removeNode(ctxMenu.node!))">删除</div>
        </template>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Delete as DeleteIcon,
  Document as NoteIcon,
  DocumentAdd as DocumentAddIcon,
  EditPen as EditPenIcon,
  Folder as FolderIcon,
  FolderAdd as FolderAddIcon,
  FolderOpened as FolderOpenedIcon,
  Search as SearchIcon,
  Tickets as TicketsIcon,
  Upload as UploadIcon
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { MdImportNode } from '../../../../preload/index'
import type { Folder, NoteMeta } from '../../api/notes'
import {
  createFolder as createFolderApi,
  createNote as createNoteApi,
  deleteFolder,
  deleteNote,
  renameFolder,
  reorder,
  uniqueName,
  updateNote
} from '../../api/notes'
import { SAMPLE_NOTE_CONTENT, SAMPLE_NOTE_TITLE } from '../../markdown/sample-note'

interface TreeNode {
  id: string
  kind: 'folder' | 'note'
  rawId: number
  label: string
  children?: TreeNode[]
}

const props = defineProps<{
  folders: Folder[]
  notes: NoteMeta[]
  selectedId: number | null
}>()

const emit = defineEmits<{
  select: [noteId: number]
  reorder: [payload: { type: 'note' | 'folder'; parent_id: number | null; ids: number[] }]
  changed: []
}>()

const treeRef = ref()
const filterText = ref('')
const treeData = ref<TreeNode[]>([])
const ctxMenu = ref<{ visible: boolean; x: number; y: number; node: TreeNode | null }>({
  visible: false,
  x: 0,
  y: 0,
  node: null
})

// ---- 组树（文件夹在前，笔记在后，按 sort/id）----
function buildTree(): void {
  const folderNodes = new Map<number, TreeNode>()
  for (const f of [...props.folders].sort((a, b) => a.sort - b.sort || a.id - b.id)) {
    folderNodes.set(f.id, { id: `f-${f.id}`, kind: 'folder', rawId: f.id, label: f.name, children: [] })
  }
  const roots: TreeNode[] = []
  for (const f of [...props.folders].sort((a, b) => a.sort - b.sort || a.id - b.id)) {
    const node = folderNodes.get(f.id)!
    if (f.parent_id != null && folderNodes.has(f.parent_id)) {
      folderNodes.get(f.parent_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }
  for (const n of [...props.notes].sort((a, b) => a.sort - b.sort || a.id - b.id)) {
    const node: TreeNode = { id: `n-${n.id}`, kind: 'note', rawId: n.id, label: n.title }
    if (n.folder_id != null && folderNodes.has(n.folder_id)) {
      folderNodes.get(n.folder_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }
  treeData.value = roots
}

watch(() => [props.folders, props.notes], buildTree, { immediate: true, deep: true })

// ---- 选择 ----
function onNodeClick(data: TreeNode): void {
  if (data.kind === 'note') emit('select', data.rawId)
}

// ---- 过滤 ----
watch(filterText, (val) => treeRef.value?.filter(val))
function filterNode(value: string, data: TreeNode): boolean {
  if (!value) return true
  return data.label.toLowerCase().includes(value.toLowerCase())
}

// ---- 拖拽 ----
function allowDrop(_dragging: unknown, dropNode: { data: TreeNode }, type: 'inner' | 'prev' | 'next'): boolean {
  if (type === 'inner') return dropNode.data.kind === 'folder'
  return true
}

function onNodeDrop(
  draggingNode: { data: TreeNode },
  dropNode: { data: TreeNode },
  dropType: 'inner' | 'before' | 'after' | 'none'
): void {
  const dragged = draggingNode.data
  // EP 已在本地数据上完成移动；从落地位置读取同层新顺序
  let siblings: TreeNode[]
  let parentId: number | null
  if (dropType === 'inner') {
    parentId = dropNode.data.kind === 'folder' ? dropNode.data.rawId : null
    siblings = (dropNode.data.children ?? []) as TreeNode[]
  } else {
    const layer = findSiblingsOf(dropNode.data.id)
    if (!layer) return
    siblings = layer
    parentId = parentOf(dropNode.data.id)
  }
  emit('reorder', {
    type: dragged.kind,
    parent_id: parentId,
    ids: siblings.map((s) => s.rawId)
  })
}

function findSiblingsOf(nodeId: string): TreeNode[] | null {
  const walk = (nodes: TreeNode[]): TreeNode[] | null => {
    for (const n of nodes) {
      if (n.id === nodeId) return nodes
      if (n.children) {
        const found = walk(n.children)
        if (found) return found
      }
    }
    return null
  }
  const layer = walk(treeData.value)
  return layer ? [...layer] : null
}

/** 节点所在父文件夹的 rawId（根层级返回 null） */
function parentOf(nodeId: string): number | null {
  const walk = (nodes: TreeNode[], parentFolderId: number | null): number | null => {
    for (const n of nodes) {
      if (n.id === nodeId) return parentFolderId
      if (n.children) {
        const found = walk(n.children, n.kind === 'folder' ? n.rawId : parentFolderId)
        if (found !== null) return found
      }
    }
    return null
  }
  return walk(treeData.value, null)
}

// ---- 右键菜单 ----
function onContextMenu(event: MouseEvent, data: TreeNode): void {
  ctxMenu.value = { visible: true, x: event.clientX, y: event.clientY, node: data }
  window.addEventListener('click', closeCtxMenu, { once: true })
}
function closeCtxMenu(): void {
  ctxMenu.value.visible = false
}
function ctxRun(fn: () => void): void {
  closeCtxMenu()
  fn()
}

// ---- CRUD ----
/** 某父级下已有的笔记标题集合（唯一名判断用） */
function siblingNoteTitles(parentId: number | null): Set<string> {
  const s = new Set<string>()
  for (const n of props.notes) if ((n.folder_id ?? null) === parentId) s.add(n.title)
  return s
}

/** 某父级下已有的文件夹名集合 */
function siblingFolderNames(parentId: number | null): Set<string> {
  const s = new Set<string>()
  for (const f of props.folders) if ((f.parent_id ?? null) === parentId) s.add(f.name)
  return s
}

async function createNote(folderId: number | null): Promise<void> {
  const { value } = await ElMessageBox.prompt('笔记标题', '新建笔记', {
    inputValue: uniqueName('未命名笔记', siblingNoteTitles(folderId)),
    confirmButtonText: '创建',
    cancelButtonText: '取消'
  })
  const name = (value ?? '').trim()
  if (!name) return
  const note = await createNoteApi(name, folderId)
  emit('changed')
  emit('select', note.id)
  ElMessage.success('笔记已创建')
}

async function createFolder(parentId: number | null): Promise<void> {
  const { value } = await ElMessageBox.prompt('文件夹名称', '新建文件夹', {
    inputValue: uniqueName('新建文件夹', siblingFolderNames(parentId)),
    confirmButtonText: '创建',
    cancelButtonText: '取消'
  })
  const name = (value ?? '').trim()
  if (!name) return
  await createFolderApi(name, parentId)
  emit('changed')
  ElMessage.success('文件夹已创建')
}

// ---- 导入 / 示例 ----
function onImportCommand(cmd: string): void {
  void (cmd === 'folder' ? importFolder(null) : importFiles(null))
}

/** 导入若干 .md 文件为同级笔记（重名自动追加序号） */
async function importFiles(folderId: number | null): Promise<void> {
  const res = await window.api.notesImport.pick('files')
  if (!('files' in res)) return
  if (res.files.length === 0) {
    ElMessage.warning('所选位置没有可导入的 .md 文件')
    return
  }
  const taken = siblingNoteTitles(folderId)
  let firstId: number | null = null
  for (const f of res.files) {
    const note = await createNoteApi(uniqueName(f.title, taken), folderId, f.content)
    taken.add(note.title)
    firstId = firstId ?? note.id
  }
  emit('changed')
  if (firstId != null) emit('select', firstId)
  ElMessage.success(`已导入 ${res.files.length} 篇笔记`)
}

/** 导入整个文件夹：子目录 → 文件夹，.md → 笔记（递归） */
async function importFolder(folderId: number | null): Promise<void> {
  const res = await window.api.notesImport.pick('folder')
  if (!('tree' in res)) return
  if (res.tree.length === 0) {
    ElMessage.warning('所选文件夹中没有 .md 文件')
    return
  }
  const firstId = await createImportNodes(res.tree, folderId)
  emit('changed')
  if (firstId != null) emit('select', firstId)
  ElMessage.success('文件夹导入完成')
}

async function createImportNodes(nodes: MdImportNode[], parentId: number | null): Promise<number | null> {
  let firstId: number | null = null
  const noteTaken = siblingNoteTitles(parentId)
  const folderTaken = siblingFolderNames(parentId)
  for (const node of nodes) {
    if (node.note) {
      const note = await createNoteApi(uniqueName(node.note.title, noteTaken), parentId, node.note.content)
      noteTaken.add(note.title)
      firstId = firstId ?? note.id
    } else if (node.children?.length) {
      const folder = await createFolderApi(uniqueName(node.title, folderTaken), parentId)
      folderTaken.add(folder.name)
      firstId = (await createImportNodes(node.children, folder.id)) ?? firstId
    }
  }
  return firstId
}

/** 创建内置「Markdown 语法示例」笔记 */
async function createSample(): Promise<void> {
  const note = await createNoteApi(uniqueName(SAMPLE_NOTE_TITLE, siblingNoteTitles(null)), null, SAMPLE_NOTE_CONTENT)
  emit('changed')
  emit('select', note.id)
  ElMessage.success('示例笔记已创建')
}

async function renameNode(data: TreeNode): Promise<void> {
  const { value } = await ElMessageBox.prompt('新名称', '重命名', {
    inputValue: data.label,
    confirmButtonText: '确定',
    cancelButtonText: '取消'
  })
  const name = (value ?? '').trim()
  if (!name || name === data.label) return
  if (data.kind === 'folder') {
    await renameFolder(data.rawId, name)
  } else {
    await updateNote(data.rawId, { title: name })
  }
  emit('changed')
  ElMessage.success('已重命名')
}

async function removeNode(data: TreeNode): Promise<void> {
  if (data.kind === 'folder') {
    await ElMessageBox.confirm(
      `删除文件夹「${data.label}」将同时删除其中的所有笔记与子文件夹，且不可恢复。继续吗？`,
      '删除文件夹',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    await deleteFolder(data.rawId)
  } else {
    await ElMessageBox.confirm(`确定删除笔记「${data.label}」吗？其版本历史将一并删除。`, '删除笔记', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    await deleteNote(data.rawId)
  }
  emit('changed')
  if (data.kind === 'note' && data.rawId === props.selectedId) {
    // 选中的笔记被删除：通知父级取消选中
    emit('select', -1)
  }
  ElMessage.success('已删除')
}

// 图标
function iconOf(data: TreeNode) {
  if (data.kind === 'folder') {
    return data.children?.length ? FolderOpenedIcon : FolderIcon
  }
  return NoteIcon
}

// 全局点击关闭右键菜单
onMounted(() => window.addEventListener('click', closeCtxMenu))
onBeforeUnmount(() => window.removeEventListener('click', closeCtxMenu))
</script>

<style scoped>
.note-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tree-toolbar {
  display: flex;
  gap: 2px;
  margin-bottom: 4px;
}

.tree-search {
  margin-bottom: 8px;
}

.tree {
  flex: 1;
  overflow-y: auto;
  background: transparent;
  --el-tree-node-hover-bg-color: var(--fill-hover);
}

.tree :deep(.el-tree-node__content) {
  height: 32px;
  border-radius: 8px;
}

.tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding-right: 4px;
}

.row-icon {
  flex-shrink: 0;
  color: var(--ink-3);
}

.row-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.row-actions {
  display: none;
  align-items: center;
  gap: 4px;
  color: var(--ink-2);
}

.tree-row:hover .row-actions {
  display: inline-flex;
}

.row-actions .el-icon {
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
}

.row-actions .el-icon:hover {
  background: var(--fill-hover);
  color: var(--ink-1);
}

.row-actions .danger:hover {
  color: var(--el-color-danger);
}

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

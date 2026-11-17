<template>
  <div class="page notes-page">
    <!-- 左：目录树 / 大纲 -->
    <div class="glass tree-panel">
      <el-segmented
        v-model="panelMode"
        class="panel-switch"
        size="small"
        block
        :options="[
          { label: '目录', value: 'tree' },
          { label: '大纲', value: 'outline' }
        ]"
      />
      <NoteTree
        v-show="panelMode === 'tree'"
        :folders="folders"
        :notes="notes"
        :selected-id="selectedId"
        @select="selectNote"
        @reorder="onReorder"
        @changed="refreshMetas"
      />
      <NoteOutline
        v-show="panelMode === 'outline'"
        :items="outline"
        :has-note="!!selectedNote"
        @jump="onJump"
      />
    </div>

    <!-- 右：编辑器 / 空态 -->
    <div class="editor-area">
      <NoteEditor
        v-if="selectedNote"
        ref="editorRef"
        :key="selectedNote.id"
        :note="selectedNote"
        @saved="refreshMetas"
        @content-change="onContentChange"
      />
      <div v-else class="empty glass">
        <el-empty description="选择或创建一篇笔记开始写作">
          <el-button type="primary" @click="createRootNote">新建笔记</el-button>
        </el-empty>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import NoteTree from '../components/notes/NoteTree.vue'
import NoteOutline from '../components/notes/NoteOutline.vue'
import { notesPanelMode } from '../components/notes/panel-state'
import NoteEditor from '../components/notes/NoteEditor.vue'
import {
  createNote,
  getNote,
  listFolders,
  listNotes,
  reorder,
  uniqueName,
  type Folder,
  type NoteFull,
  type NoteMeta
} from '../api/notes'
import { extractOutline, type OutlineItem } from '../markdown/outline'
import { ElMessage } from 'element-plus'

const folders = ref<Folder[]>([])
const notes = ref<NoteMeta[]>([])
const selectedId = ref<number | null>(null)
const selectedNote = ref<NoteFull | null>(null)

// ---- 左侧面板：目录 / 大纲 ----
// 进入默认「目录」；会话内切换记忆在 panel-state 模块（路由切回保留，重启回到目录）
const panelMode = notesPanelMode

const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)
const outlineSource = ref('')
const outline = computed(() => extractOutline(outlineSource.value))

function onContentChange(content: string): void {
  outlineSource.value = content
}

function onJump(item: OutlineItem): void {
  editorRef.value?.revealHeading(item)
}

const selectedStillExists = computed(() =>
  selectedId.value == null ? true : notes.value.some((n) => n.id === selectedId.value)
)

async function refreshMetas(): Promise<void> {
  const [f, n] = await Promise.all([listFolders(), listNotes()])
  folders.value = f
  notes.value = n
  // 选中的笔记被删除 → 清空选中
  if (!selectedStillExists.value) {
    selectedId.value = null
    selectedNote.value = null
  }
}

async function selectNote(id: number): Promise<void> {
  if (id <= 0) {
    selectedId.value = null
    selectedNote.value = null
    return
  }
  try {
    selectedId.value = id
    selectedNote.value = await getNote(id)
  } catch (err) {
    ElMessage.error(`打开笔记失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function onReorder(payload: {
  type: 'note' | 'folder'
  parent_id: number | null
  ids: number[]
}): Promise<void> {
  // 失败（如落点重名被拒）也要刷新，把 el-tree 的本地移动弹回真实顺序
  try {
    await reorder(payload)
  } finally {
    await refreshMetas()
  }
}

async function createRootNote(): Promise<void> {
  const taken = new Set(notes.value.filter((n) => n.folder_id == null).map((n) => n.title))
  const note = await createNote(uniqueName('未命名笔记', taken), null)
  await refreshMetas()
  await selectNote(note.id)
}

// 托盘「新建笔记」：主进程经 notes:quick-create 事件触发。
// keep-alive 下本页切走不卸载，改用 activated/deactivated 挂卸监听（仅本页可见时响应）
let offQuickCreate: (() => void) | null = null

function bindQuickCreate(): void {
  if (offQuickCreate || !window.api?.onQuickCreate) return
  offQuickCreate = window.api.onQuickCreate(() => {
    void createRootNote()
  })
}

function unbindQuickCreate(): void {
  offQuickCreate?.()
  offQuickCreate = null
}

onMounted(refreshMetas)
onActivated(bindQuickCreate)
onDeactivated(unbindQuickCreate)
onBeforeUnmount(unbindQuickCreate)
</script>

<style scoped>
/* 行方向三栏：树 | 编辑器；两栏随容器拉伸填满（覆盖 .page 的纵向布局） */
.notes-page {
  height: 100%;
  overflow: hidden;
  flex-direction: row;
  gap: 14px;
}

.tree-panel {
  width: 252px;
  flex-shrink: 0;
  padding: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-switch {
  margin-bottom: 8px;
  flex-shrink: 0;
}

.editor-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

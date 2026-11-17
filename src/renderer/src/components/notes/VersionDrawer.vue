<template>
  <el-drawer
    :model-value="visible"
    title="版本历史"
    direction="rtl"
    size="440px"
    :append-to-body="true"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <div v-if="loading" v-loading="true" class="loading" />

    <template v-else-if="previewing">
      <div class="drawer-actions">
        <el-button size="small" @click="previewing = null">返回列表</el-button>
        <el-button
          size="small"
          type="primary"
          :loading="restoringId !== null"
          @click="doRestore(previewing.id)"
        >还原到此版本</el-button>
      </div>
      <MdPreview :content="previewing.content" :theme="mdThemeId" />
    </template>

    <template v-else>
      <el-table :data="versions" stripe size="small" v-loading="listLoading">
        <el-table-column label="时间" min-width="140">
          <template #default="{ row }">{{ new Date(row.created_at).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.auto ? '自动' : row.label || '手动' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="70">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button size="small" text @click="preview(row)">预览</el-button>
            <el-button size="small" text type="primary" @click="doRestore(row.id)">还原</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无版本" :image-size="64" />
        </template>
      </el-table>
      <div class="tip">保存时内容有变化会自动存版本；「还原」会先把当前内容存为一版，可随时找回。</div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MdPreview from './MdPreview.vue'
import { getMdThemeId } from '../../markdown/themes'
import {
  getVersionContent,
  listVersions,
  restoreVersion,
  type VersionMeta
} from '../../api/notes'

const props = defineProps<{
  noteId: number | null
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  restored: [noteId: number]
}>()

const mdThemeId = getMdThemeId()
const versions = ref<VersionMeta[]>([])
const loading = ref(false)
const listLoading = ref(false)
const previewing = ref<{ id: number; content: string } | null>(null)
const restoringId = ref<number | null>(null)

async function load(): Promise<void> {
  if (!props.noteId) return
  listLoading.value = true
  previewing.value = null
  try {
    versions.value = await listVersions(props.noteId)
  } finally {
    listLoading.value = false
  }
}

watch(
  () => [props.visible, props.noteId],
  ([visible]) => {
    if (visible) void load()
  }
)

async function preview(row: VersionMeta): Promise<void> {
  if (!props.noteId) return
  const content = await getVersionContent(props.noteId, row.id)
  previewing.value = { id: row.id, content }
}

async function doRestore(vid: number): Promise<void> {
  if (!props.noteId) return
  await ElMessageBox.confirm('将内容还原到该版本？当前内容会先自动存为一个版本。', '还原确认', {
    type: 'warning',
    confirmButtonText: '还原',
    cancelButtonText: '取消'
  })
  restoringId.value = vid
  try {
    await restoreVersion(props.noteId, vid)
    ElMessage.success('已还原')
    emit('restored', props.noteId)
    await load()
  } catch (err) {
    ElMessage.error(`还原失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    restoringId.value = null
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
</script>

<style scoped>
.loading {
  min-height: 200px;
}

.drawer-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.tip {
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-3);
}
</style>

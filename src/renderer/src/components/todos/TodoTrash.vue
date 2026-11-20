<template>
  <el-dialog
    :model-value="visible"
    title="回收站"
    width="640px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:visible', $event as boolean)"
  >
    <div class="trash-hint">
      删除的待办在这里保留 <b>30 天</b>，期间可随时恢复；子任务、标签与评论一并保留。
    </div>
    <div v-if="items.length" class="trash-list">
      <div v-for="t in items" :key="t.id" class="trash-row">
        <div class="trash-main">
          <div class="trash-title-line">
            <span class="trash-title">{{ t.title }}</span>
            <span
              v-if="t.priority !== 4"
              class="p-badge"
              :style="{ background: priorityMeta(t.priority).color }"
            >P{{ t.priority }}</span>
            <span v-if="t.sub_total > 0" class="sub-chip">{{ t.sub_total }} 子任务</span>
          </div>
          <div class="trash-meta">
            <span>{{ deletedText(t) }}</span>
            <span v-if="t.tags.length" class="trash-tags">{{ t.tags.map((n) => `#${n}`).join(' ') }}</span>
          </div>
        </div>
        <div class="trash-actions">
          <el-button size="small" type="primary" plain @click="$emit('restore', t.id)">恢复</el-button>
          <el-button size="small" type="danger" plain @click="confirmPurge(t)">彻底删除</el-button>
        </div>
      </div>
    </div>
    <div v-else class="trash-empty">
      <EmptyState compact title="回收站是空的" hint="删除的待办会先到这里，不会立即消失" />
    </div>
    <template #footer>
      <div class="trash-footer">
        <span class="footer-hint">超过 30 天的待办会在应用启动时自动清除</span>
        <el-button size="small" type="danger" plain :disabled="items.length === 0" @click="confirmClear">清空回收站</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import EmptyState from '../EmptyState.vue'
import { priorityMeta, type Todo } from '../../api/todo'

defineProps<{
  visible: boolean
  items: Todo[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  restore: [id: number]
  purge: [id: number]
  clear: []
}>()

function deletedText(t: Todo): string {
  if (!t.deleted_at) return ''
  const d = new Date(t.deleted_at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const deletedAt = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const days = 30 - Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const left = days <= 0 ? '即将自动清除' : `${Math.max(days, 0)} 天后自动清除`
  return `${deletedAt} 删除 · ${left}`
}

async function confirmPurge(t: Todo): Promise<void> {
  await ElMessageBox.confirm(
    `彻底删除「${t.title}」后不可恢复（子任务与评论一并清除）。继续吗？`,
    '彻底删除',
    { type: 'warning', confirmButtonText: '彻底删除', cancelButtonText: '取消' }
  )
  emit('purge', t.id)
}

async function confirmClear(): Promise<void> {
  await ElMessageBox.confirm('清空回收站将彻底删除其中全部待办，不可恢复。继续吗？', '清空回收站', {
    type: 'warning',
    confirmButtonText: '清空',
    cancelButtonText: '取消'
  })
  emit('clear')
}
</script>

<style scoped>
.trash-hint {
  font-size: 12.5px;
  color: var(--ink-3);
  line-height: 1.6;
  margin-bottom: 12px;
}

.trash-list {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trash-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--divider);
  border-radius: 8px;
}

.trash-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.trash-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.trash-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-3);
}

.trash-tags {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.sub-chip {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 1px 8px;
}

.trash-actions {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
}

.trash-empty {
  padding: 20px 0;
}

.trash-footer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.footer-hint {
  flex: 1;
  text-align: left;
  font-size: 11.5px;
  color: var(--ink-3);
}
</style>

<!-- 插件源：管理插件市场聚合的 registry.json 索引地址（可多份，各自可带备用地址）。
     改动即落盘（userData/plugin-sources.json），主进程负责校验。 -->
<template>
  <div class="sources">
    <div class="s-intro">
      <div class="s-title">插件源</div>
      <div class="s-desc">
        插件市场会聚合所有「已启用」的源；同一插件出现在多个源时取版本最高的一份，下载仍按源内
        主地址 → 备用地址 依次回退。删除源不会卸载已安装的插件。
      </div>
    </div>

    <div class="s-actions">
      <el-button size="small" type="primary" plain :icon="Plus" @click="openAdd">添加插件源</el-button>
      <el-button size="small" text :loading="resetting" @click="reset">恢复默认</el-button>
    </div>

    <div v-loading="loading" class="s-list">
      <div v-for="s in sources" :key="s.id" class="s-item" :class="{ 'is-off': !s.enabled }">
        <div class="si-head">
          <span class="si-name">{{ s.name }}</span>
          <el-tag v-if="s.builtin" size="small" effect="plain">内置</el-tag>
          <el-tag v-if="s.mirrors.length" size="small" type="info" effect="plain">
            +{{ s.mirrors.length }} 备用
          </el-tag>
          <span class="si-spacer" />
          <el-switch :model-value="s.enabled" size="small" @change="toggle(s)" />
        </div>
        <div class="si-url">{{ s.url }}</div>
        <div v-if="s.mirrors.length" class="si-mirrors">
          <div v-for="(m, i) in s.mirrors" :key="m" class="si-mirror">备用 {{ i + 1 }}：{{ m }}</div>
        </div>
        <div class="si-foot">
          <el-button size="small" text :loading="testingId === s.id" @click="test(s)">测试</el-button>
          <el-button size="small" text @click="openEdit(s)">编辑</el-button>
          <el-button size="small" text type="danger" @click="remove(s)">删除</el-button>
        </div>
      </div>

      <EmptyState
        v-if="!loading && !sources.length"
        title="还没有插件源"
        hint="添加一份 registry.json 索引地址，插件市场就能读取到可用插件"
        :icon="Link"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editing ? '编辑插件源' : '添加插件源'"
      width="min(520px, 92vw)"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-form label-position="top" class="s-form">
        <el-form-item label="名称">
          <el-input v-model="draft.name" maxlength="40" placeholder="例如：团队内部插件" />
        </el-form-item>
        <el-form-item label="索引地址（registry.json）">
          <el-input v-model="draft.url" placeholder="https://example.com/plugins/registry.json" />
        </el-form-item>
        <el-form-item label="备用地址（可选，每行一个，最多 5 个）">
          <el-input
            v-model="draftMirrors"
            type="textarea"
            :rows="3"
            resize="vertical"
            placeholder="主地址不可达时按顺序尝试"
          />
        </el-form-item>
        <el-form-item>
          <el-switch v-model="draft.enabled" />
          <span class="form-hint">启用后参与插件市场聚合</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDraft">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Link, Plus } from '@element-plus/icons-vue'
import EmptyState from '../EmptyState.vue'
import type { PluginSourceConfig } from '../../../../preload/index'

const emit = defineEmits<{ (e: 'changed'): void }>()

const sources = ref<PluginSourceConfig[]>([])
const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const testingId = ref('')
const dialogVisible = ref(false)
const editing = ref(false)
const draftMirrors = ref('')
const draft = ref<PluginSourceConfig>({ id: '', name: '', url: '', mirrors: [], enabled: true })

function newId(): string {
  return `src-${Math.random().toString(36).slice(2, 8)}`
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    sources.value = await window.api.plugins.sources.list()
  } catch (err) {
    ElMessage.error(`插件源读取失败：${errText(err)}`)
  } finally {
    loading.value = false
  }
}

/** 落盘并同步本地副本；失败时重新拉取，避免界面与磁盘不一致 */
async function persist(next?: PluginSourceConfig[]): Promise<boolean> {
  const payload = (next ?? sources.value).map((s) => ({ ...s, mirrors: [...s.mirrors] }))
  try {
    sources.value = await window.api.plugins.sources.save(payload)
    emit('changed')
    return true
  } catch (err) {
    ElMessage.error(`保存失败：${errText(err)}`)
    await load()
    return false
  }
}

async function toggle(s: PluginSourceConfig): Promise<void> {
  const next = sources.value.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x))
  await persist(next)
}

function openAdd(): void {
  editing.value = false
  draft.value = { id: newId(), name: '', url: '', mirrors: [], enabled: true }
  draftMirrors.value = ''
  dialogVisible.value = true
}

function openEdit(s: PluginSourceConfig): void {
  editing.value = true
  draft.value = { ...s, mirrors: [...s.mirrors] }
  draftMirrors.value = s.mirrors.join('\n')
  dialogVisible.value = true
}

async function saveDraft(): Promise<void> {
  const name = draft.value.name.trim()
  const url = draft.value.url.trim()
  if (!name) {
    ElMessage.warning('请填写插件源名称')
    return
  }
  if (!/^https?:\/\//i.test(url)) {
    ElMessage.warning('索引地址需以 http(s):// 开头')
    return
  }
  const mirrors = draftMirrors.value
    .split('\n')
    .map((m) => m.trim())
    .filter(Boolean)
  const bad = mirrors.find((m) => !/^https?:\/\//i.test(m))
  if (bad) {
    ElMessage.warning(`备用地址格式不正确：${bad}`)
    return
  }
  const item: PluginSourceConfig = { ...draft.value, name, url, mirrors }
  const next = editing.value
    ? sources.value.map((s) => (s.id === item.id ? item : s))
    : [...sources.value, item]
  saving.value = true
  try {
    if (await persist(next)) {
      dialogVisible.value = false
      ElMessage.success(editing.value ? '已更新插件源' : '已添加插件源')
    }
  } finally {
    saving.value = false
  }
}

async function remove(s: PluginSourceConfig): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除插件源「${s.name}」？仅移除这条索引配置，已安装的插件不受影响。`,
      '删除插件源',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await persist(sources.value.filter((x) => x.id !== s.id))
}

async function reset(): Promise<void> {
  try {
    await ElMessageBox.confirm('恢复为内置默认插件源？自定义源配置会被移除。', '恢复默认', {
      type: 'warning',
      confirmButtonText: '恢复',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  resetting.value = true
  try {
    sources.value = await window.api.plugins.sources.reset()
    emit('changed')
    ElMessage.success('已恢复默认插件源')
  } catch (err) {
    ElMessage.error(`恢复失败：${errText(err)}`)
  } finally {
    resetting.value = false
  }
}

async function test(s: PluginSourceConfig): Promise<void> {
  testingId.value = s.id
  try {
    const res = await window.api.plugins.remoteList({ sourceIds: [s.id] })
    const r = res.results.find((x) => x.sourceId === s.id)
    if (!r) throw new Error('未返回该源的检测结果')
    const viaMirror = r.ok && r.sourceUrl !== s.url ? '（经备用地址）' : ''
    if (r.ok) {
      ElMessage.success(
        r.entries.length
          ? `${s.name} 可用：${r.entries.length} 个插件${viaMirror}`
          : `${s.name} 可访问，但索引里没有插件${viaMirror}`
      )
    } else {
      ElMessage.error(`${s.name} 不可用：${r.error || '未知错误'}`)
    }
  } catch (err) {
    ElMessage.error(`${s.name} 检测失败：${errText(err)}`)
  } finally {
    testingId.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.sources {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.s-intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.s-title {
  font-size: 13px;
  font-weight: 600;
}

.s-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-3);
}

.s-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.s-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100px;
}

.s-item {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--fill-subtle);
  transition: opacity 0.18s ease, border-color 0.18s ease;
}

.s-item:hover {
  border-color: var(--accent-border);
}

.s-item.is-off {
  opacity: 0.62;
}

.si-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.si-name {
  font-size: 13.5px;
  font-weight: 600;
}

.si-spacer {
  flex: 1 1 0;
}

.si-url {
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-2);
  word-break: break-all;
}

.si-mirrors {
  margin-top: 2px;
}

.si-mirror {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-3);
  word-break: break-all;
}

.si-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 6px;
}

.s-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.form-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ink-3);
}
</style>

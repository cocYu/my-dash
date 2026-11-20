<!-- 插件市场：聚合所有启用的插件源索引 → 搜索 / 分类过滤 → 一键安装或更新。
     安装由主进程完成（镜像回退 + sha256 校验 + 原子落位），成功后重载插件。 -->
<template>
  <div class="market">
    <div class="m-toolbar">
      <el-input
        v-model="keyword"
        class="m-search"
        size="small"
        placeholder="搜索名称、描述、分类或 ID"
        clearable
        :prefix-icon="Search"
      />
      <el-select
        v-if="categories.length > 1"
        v-model="category"
        class="m-cat"
        size="small"
        placeholder="全部分类"
        clearable
      >
        <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
      </el-select>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="m-meta">
      <span v-if="loaded">
        {{ filtered.length }} 个插件 · {{ okCount }}/{{ results.length }} 个源可用
      </span>
      <span v-else class="dim">尚未加载</span>
      <el-button link type="primary" size="small" @click="emit('open-sources')">管理插件源</el-button>
    </div>

    <el-alert v-if="failed.length" type="warning" :closable="false" show-icon class="m-alert">
      <template #title>{{ failed.length }} 个插件源不可用（其余源不受影响）</template>
      <div v-for="f in failed" :key="f.sourceId" class="m-fail">
        <b>{{ f.sourceName }}</b>：{{ f.error || '未知错误' }}
      </div>
    </el-alert>

    <div v-loading="loading" class="m-body">
      <template v-if="entries.length">
        <div v-for="e in filtered" :key="e.id" class="m-item">
          <div class="mi-head">
            <span class="mi-name">{{ e.name }}</span>
            <el-tag v-if="e.category" size="small" effect="plain">{{ e.category }}</el-tag>
            <span class="mi-id">{{ e.id }}</span>
          </div>
          <div class="mi-desc">{{ e.description || '暂无描述' }}</div>
          <div class="mi-foot">
            <span class="mi-ver">v{{ e.version }}</span>
            <span v-if="localVersion(e.id)" class="mi-local">已装 v{{ localVersion(e.id) }}</span>
            <el-tooltip
              v-if="e.sources.length > 1"
              :content="`多个源提供：${e.sources.join('、')}`"
              placement="top"
            >
              <span class="mi-src">{{ e.sources.length }} 个源</span>
            </el-tooltip>
            <span v-else class="mi-src">{{ e.sourceName }}</span>
            <span v-if="e.size" class="mi-size">{{ sizeText(e.size) }}</span>
            <span class="mi-spacer" />
            <el-button
              size="small"
              :type="actionOf(e).type"
              :loading="installingId === e.id"
              :disabled="!!installingId && installingId !== e.id"
              @click="install(e)"
            >{{ actionOf(e).label }}</el-button>
          </div>
        </div>
        <EmptyState
          v-if="!filtered.length"
          compact
          title="没有匹配的插件"
          hint="换个关键词，或清空分类过滤"
          :icon="Search"
        />
      </template>

      <EmptyState
        v-else-if="!loading && !results.length"
        title="还没有启用任何插件源"
        hint="插件源是一份 registry.json 索引，添加后即可浏览并安装插件"
        :icon="Shop"
      >
        <el-button size="small" type="primary" plain @click="emit('open-sources')">配置插件源</el-button>
      </EmptyState>
      <EmptyState
        v-else-if="!loading && !entries.length"
        title="插件市场暂时没有内容"
        hint="检查插件源地址是否正确，或稍后重试"
        :icon="Shop"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Shop } from '@element-plus/icons-vue'
import EmptyState from '../EmptyState.vue'
import { reloadPlugins } from '../../plugins/host'
import type { PluginInfo, RemoteMarketEntry, RemoteSourceStatus } from '../../../../preload/index'

const emit = defineEmits<{
  (e: 'installed', id: string): void
  (e: 'open-sources'): void
}>()

const keyword = ref('')
const category = ref('')
const loading = ref(false)
const loaded = ref(false)
const entries = ref<RemoteMarketEntry[]>([])
const results = ref<RemoteSourceStatus[]>([])
const installed = ref<Record<string, PluginInfo>>({})
const installingId = ref('')

const failed = computed(() => results.value.filter((r) => !r.ok))
const okCount = computed(() => results.value.filter((r) => r.ok).length)

const categories = computed(() => {
  const set = new Set<string>()
  for (const e of entries.value) if (e.category) set.add(e.category)
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

/** 本地过滤：名称 / 描述 / 分类 / id 任一命中即可，全部小写比较 */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return entries.value.filter((e) => {
    if (category.value && e.category !== category.value) return false
    if (!kw) return true
    return [e.name, e.id, e.description ?? '', e.category ?? ''].some((t) => t.toLowerCase().includes(kw))
  })
})

function localVersion(id: string): string | undefined {
  return installed.value[id]?.version
}

function compareVersion(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((s) => Number.parseInt(s, 10) || 0)
  const pb = b.split(/[.+-]/).map((s) => Number.parseInt(s, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function actionOf(e: RemoteMarketEntry): { label: string; type: 'primary' | 'warning' | 'info' } {
  const local = localVersion(e.id)
  if (!local) return { label: '安装', type: 'primary' }
  const diff = compareVersion(local, e.version)
  if (diff < 0) return { label: '更新', type: 'warning' }
  return { label: '重装', type: 'info' }
}

function sizeText(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function refreshInstalled(): Promise<void> {
  const list = (await window.api.plugins.list()) as PluginInfo[]
  installed.value = Object.fromEntries(list.map((p) => [p.id, p]))
}

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    const res = await window.api.plugins.remoteList()
    entries.value = res.entries
    results.value = res.results
    loaded.value = true
  } catch (err) {
    entries.value = []
    results.value = []
    ElMessage.error(`插件市场加载失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    loading.value = false
    await refreshInstalled()
  }
}

async function install(e: RemoteMarketEntry): Promise<void> {
  installingId.value = e.id
  const tip = ElMessage({ message: `正在下载并安装 ${e.name}…`, type: 'info', duration: 0 })
  try {
    // 注意：entries 是 Vue 响应式代理，直接把数组塞进 IPC 会触发结构化克隆失败，这里复制成普通数组
    await window.api.plugins.installRemote({
      url: e.downloadUrl,
      mirrors: e.mirrors ? [...e.mirrors] : undefined,
      sha256: e.sha256 || undefined
    })
    await reloadPlugins()
    await refreshInstalled()
    emit('installed', e.id)
    ElMessage.success(`已安装 ${e.name} v${e.version}`)
  } catch (err) {
    ElMessage.error(`安装失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    tip.close()
    installingId.value = ''
  }
}

onMounted(load)

defineExpose({ load })
</script>

<style scoped>
.market {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 180px;
}

/* 工具栏：窄窗口下自动换行，搜索框独占一行 */
.m-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.m-search {
  flex: 1 1 200px;
  min-width: 140px;
}

.m-cat {
  width: 128px;
  flex: 0 0 auto;
}

.m-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-3);
}

.m-alert {
  border-radius: var(--radius-sm);
}

.m-fail {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.6;
  word-break: break-all;
}

.m-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
}

.m-item {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--fill-subtle);
  transition: border-color 0.18s ease, background 0.18s ease;
}

.m-item:hover {
  border-color: var(--accent-border);
  background: var(--surface-1);
}

.mi-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mi-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-1);
}

.mi-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-3);
}

.mi-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-3);
}

.mi-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ink-3);
}

.mi-ver {
  font-family: var(--font-mono);
  color: var(--ink-2);
}

.mi-local {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.mi-src,
.mi-size {
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--divider);
  background: var(--surface-1);
}

/* 把操作按钮推到行尾；窄窗口换行后仍然贴着右侧 */
.mi-spacer {
  flex: 1 1 0;
  min-width: 0;
}

.dim {
  color: var(--ink-3);
}
</style>

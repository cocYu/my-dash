<!-- 插件设置：已安装 / 插件市场 / 插件源 三块。
     窄窗口下自动切换紧凑布局（信息表格 → 卡片列表），操作按钮换行而不是溢出。 -->
<template>
  <div ref="rootRef" class="panel plugin-panel">
    <div class="pp-head">
      <div class="pp-head-text">
        <div class="pp-title">插件</div>
        <div class="pp-sub">已安装 {{ plugins.length }} 个 · 启用 {{ enabledCount }} 个</div>
      </div>
      <el-button size="small" :loading="reloading" @click="reload">重载</el-button>
    </div>

    <el-tabs v-model="tabModel" class="pp-tabs">
      <!-- 已安装 -->
      <el-tab-pane label="已安装" name="installed">
        <div class="pp-toolbar">
          <el-button size="small" type="primary" plain @click="pickZip">导入 .zip</el-button>
          <el-button size="small" @click="installFromUrl">从 URL 安装</el-button>
          <template v-if="!compact">
            <el-button size="small" text @click="openDir">打开目录</el-button>
            <el-button size="small" text @click="docsVisible = true">开发文档</el-button>
          </template>
          <el-dropdown v-else trigger="click" @command="onMore">
            <el-button size="small" text>
              更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="dir">打开插件目录</el-dropdown-item>
                <el-dropdown-item command="docs">插件开发文档</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <!-- 宽窗口：表格 -->
        <el-table v-if="!compact" v-loading="loading" :data="plugins" size="small" stripe class="pp-table">
          <el-table-column prop="name" label="名称" min-width="140">
            <template #default="{ row }">
              <span class="plugin-name">{{ row.name }}</span>
              <el-tag v-if="row.source === 'dev'" size="small" type="warning" effect="plain" class="ml4">dev</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="id" label="ID" min-width="110" show-overflow-tooltip />
          <el-table-column prop="version" label="版本" width="76" />
          <el-table-column label="权限" min-width="150">
            <template #default="{ row }">
              <el-tag v-for="p in row.permissions" :key="p" size="small" effect="plain" class="mr4">{{ p }}</el-tag>
              <span v-if="!row.permissions?.length" class="dim">无</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="96" align="center">
            <template #default="{ row }">
              <el-tooltip v-if="row.error" :content="row.error" placement="top">
                <el-tag size="small" type="danger" effect="plain">异常</el-tag>
              </el-tooltip>
              <el-switch
                v-else
                :model-value="row.enabled"
                :loading="switchingId === row.id"
                @change="toggle(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ row }">
              <el-button
                size="small"
                type="danger"
                plain
                :disabled="row.source === 'dev' || !!row.error"
                @click="uninstall(row)"
              >卸载</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState compact title="还没有安装任何插件" hint="导入 .zip，或到「插件市场」挑一个" :icon="Box" />
          </template>
        </el-table>

        <!-- 窄窗口：卡片列表 -->
        <div v-else v-loading="loading" class="pp-cards">
          <div v-for="p in plugins" :key="p.id" class="pcard" :class="{ 'is-error': !!p.error }">
            <div class="pc-head">
              <span class="pc-name">{{ p.name }}</span>
              <el-tag v-if="p.source === 'dev'" size="small" type="warning" effect="plain">dev</el-tag>
              <el-tag v-if="p.error" size="small" type="danger" effect="plain">异常</el-tag>
              <span class="pc-spacer" />
              <el-switch
                v-if="!p.error"
                :model-value="p.enabled"
                :loading="switchingId === p.id"
                size="small"
                @change="toggle(p)"
              />
            </div>
            <div class="pc-meta">{{ p.id }} · v{{ p.version }}</div>
            <div class="pc-meta">权限：{{ p.permissions?.length ? p.permissions.join('、') : '无' }}</div>
            <div v-if="p.error" class="pc-err">{{ p.error }}</div>
            <div class="pc-foot">
              <el-button
                size="small"
                text
                type="danger"
                :disabled="p.source === 'dev' || !!p.error"
                @click="uninstall(p)"
              >卸载</el-button>
            </div>
          </div>
          <EmptyState
            v-if="!loading && !plugins.length"
            compact
            title="还没有安装任何插件"
            hint="导入 .zip，或到「插件市场」挑一个"
            :icon="Box"
          />
        </div>

        <el-alert
          v-for="err in pluginRegistry.errors"
          :key="err.id + err.message"
          :title="`插件 ${err.id} 加载失败：${err.message}`"
          type="error"
          show-icon
          :closable="false"
          class="err"
        />
      </el-tab-pane>

      <!-- 插件市场 -->
      <el-tab-pane label="插件市场" name="market" lazy>
        <PluginMarket ref="marketRef" @installed="fetchList" @open-sources="tab = 'sources'" />
      </el-tab-pane>

      <!-- 插件源 -->
      <el-tab-pane label="插件源" name="sources" lazy>
        <PluginSources @changed="onSourcesChanged" />
      </el-tab-pane>
    </el-tabs>

    <input ref="zipInput" type="file" accept=".zip" class="hidden-input" @change="onZipPicked" />
    <PluginDocsDialog v-model="docsVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Box } from '@element-plus/icons-vue'
import { pluginRegistry } from '../plugins/store'
import { reloadPlugins } from '../plugins/host'
import PluginDocsDialog from './PluginDocsDialog.vue'
import PluginMarket from './plugins/PluginMarket.vue'
import PluginSources from './plugins/PluginSources.vue'
import EmptyState from './EmptyState.vue'
import { useContainerWidth } from '../composables/useContainerWidth'
import type { PluginInfo } from '../../../preload/index'

type PluginTab = 'installed' | 'market' | 'sources'

const tab = defineModel<PluginTab>('tab', { default: 'installed' })
const docsVisible = ref(false)
const loading = ref(false)
const reloading = ref(false)
const switchingId = ref<string | null>(null)
const plugins = ref<PluginInfo[]>([])
const zipInput = ref<HTMLInputElement>()
const marketRef = ref<InstanceType<typeof PluginMarket>>()
const rootRef = ref<HTMLElement>()
const width = useContainerWidth(rootRef)

/** el-tabs 的 v-model 是 string，这里做一层收敛，保证只写回合法标签 */
const tabModel = computed({
  get: (): string => tab.value,
  set: (v: string | number) => {
    if (v === 'installed' || v === 'market' || v === 'sources') tab.value = v
  }
})

/** 表格 6 列在 640px 以下会挤压，改用卡片列表 */
const compact = computed(() => width.value > 0 && width.value < 640)
const enabledCount = computed(() => plugins.value.filter((p) => p.enabled && !p.error).length)

async function fetchList(): Promise<void> {
  loading.value = true
  try {
    plugins.value = (await window.api.plugins.list()) as PluginInfo[]
  } finally {
    loading.value = false
  }
}

async function toggle(row: PluginInfo): Promise<void> {
  switchingId.value = row.id
  try {
    await window.api.plugins.setEnabled(row.id, !row.enabled)
    await reloadPlugins()
    await fetchList()
    ElMessage.success(row.enabled ? `已禁用 ${row.name}` : `已启用 ${row.name}`)
  } catch (err) {
    ElMessage.error(String(err))
  } finally {
    switchingId.value = null
  }
}

async function uninstall(row: PluginInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定卸载插件「${row.name}」吗？其目录与本地数据（KV）将被删除。`,
      '卸载确认',
      { type: 'warning', confirmButtonText: '卸载', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await window.api.plugins.uninstall(row.id)
    await reloadPlugins()
    await fetchList()
    ElMessage.success(`已卸载 ${row.name}`)
  } catch (err) {
    ElMessage.error(`卸载失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 从 URL 安装/升级：下载 zip（可选校验 sha256）→ 原子落位 → 重载插件 */
async function installFromUrl(): Promise<void> {
  const { value } = await ElMessageBox.prompt(
    '输入插件 zip 包的下载地址（同 id 已安装时执行升级）',
    '从 URL 安装',
    {
      inputPlaceholder: 'https://…/my-plugin-0.1.0.zip',
      inputValue: '',
      cancelButtonText: '取消',
      confirmButtonText: '下载安装'
    }
  ).catch(() => ({ value: '' }))
  const url = value.trim()
  if (!url) return
  const tip = ElMessage({ message: '正在下载并安装…', type: 'info', duration: 0 })
  try {
    const res = (await window.api.plugins.installRemote({ url })) as {
      id: string
      name: string
      version: string
    }
    await reloadPlugins()
    await fetchList()
    ElMessage.success(`已安装 ${res.name} v${res.version}`)
  } catch (err) {
    ElMessage.error(`安装失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    tip.close()
  }
}

async function reload(): Promise<void> {
  reloading.value = true
  try {
    await reloadPlugins()
    await fetchList()
    ElMessage.success('插件已重载')
  } finally {
    reloading.value = false
  }
}

function onMore(command: string | number | object): void {
  const cmd = String(command)
  if (cmd === 'dir') void openDir()
  else if (cmd === 'docs') docsVisible.value = true
}

/** 源配置变化后，插件市场若已渲染则同步刷新列表 */
function onSourcesChanged(): void {
  void marketRef.value?.load()
}

function pickZip(): void {
  zipInput.value?.click()
}

async function onZipPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return
  try {
    const result = await window.api.plugins.importZip(await file.arrayBuffer())
    await reloadPlugins()
    await fetchList()
    ElMessage.success(`已安装插件：${result.name}`)
  } catch (err) {
    ElMessage.error(`导入失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function openDir(): Promise<void> {
  await window.api.plugins.openDir()
}

// 切回某个标签页时刷新数据（页面被 keep-alive 缓存，重进设置不会重新挂载）
watch(tab, (v) => {
  if (v === 'installed') void fetchList()
  // market 首次激活由组件自身的 onMounted 拉取，这里只处理「已挂载后再切回来」
  if (v === 'market' && marketRef.value) void marketRef.value.load()
})

onMounted(fetchList)
</script>

<style scoped>
.plugin-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.pp-title {
  font-size: 14px;
  font-weight: 600;
}

.pp-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ink-3);
}

.pp-tabs {
  margin-top: 6px;
}

.pp-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.pp-tabs :deep(.el-tabs__item) {
  padding: 0 14px;
  height: 34px;
  font-size: 13px;
}

/* 工具栏：允许换行，间距用 gap（Element 相邻按钮的 margin-left 在换行时会顶到左边） */
.pp-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.pp-toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}

.pp-table {
  width: 100%;
}

.plugin-name {
  font-weight: 600;
}

.ml4 {
  margin-left: 6px;
}

.mr4 {
  margin-right: 4px;
}

.dim {
  color: var(--ink-3);
}

.hidden-input {
  display: none;
}

.err {
  margin-top: 10px;
}

/* 窄窗口卡片 */
.pp-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 80px;
}

.pcard {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--fill-subtle);
}

.pcard.is-error {
  border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
}

.pc-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.pc-name {
  font-size: 13.5px;
  font-weight: 600;
}

.pc-spacer {
  flex: 1 1 0;
}

.pc-meta {
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-3);
  word-break: break-word;
}

.pc-err {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--danger);
  word-break: break-word;
}

.pc-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
</style>

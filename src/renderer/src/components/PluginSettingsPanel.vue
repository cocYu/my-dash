<template>
  <div class="panel">
    <div class="panel-toolbar">
      <div>
        <el-button @click="pickZip">导入插件 (.zip)</el-button>
        <el-button @click="installFromUrl">从 URL 安装…</el-button>
        <el-button @click="uninstallSelected">卸载</el-button>
        <el-button @click="openDir">打开插件目录</el-button>
      </div>
      <el-button :loading="reloading" @click="reload">重载全部</el-button>
    </div>

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="plugins"
      stripe
      @selection-change="(rows: PluginInfo[]) => (selected = rows)"
    >
      <el-table-column type="selection" width="42" :selectable="(row: PluginInfo) => !row.error" />
      <el-table-column prop="name" label="名称" min-width="150">
        <template #default="{ row }">
          <span class="plugin-name">{{ row.name }}</span>
          <el-tag v-if="row.source === 'dev'" size="small" type="warning" effect="plain" class="ml4">dev</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="ID" min-width="120" show-overflow-tooltip />
      <el-table-column prop="version" label="版本" width="80" />
      <el-table-column label="权限" min-width="170">
        <template #default="{ row }">
          <el-tag v-for="p in row.permissions" :key="p" size="small" effect="plain" class="mr4">{{ p }}</el-tag>
          <span v-if="!row.permissions?.length" class="dim">无</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="150" align="center">
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
      <el-table-column label="操作" width="90" align="center">
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
        <el-empty description="尚未安装任何插件，试试导入一个 .zip" />
      </template>
    </el-table>

    <el-alert
      v-for="err in pluginRegistry.errors"
      :key="err.id + err.message"
      :title="`插件 ${err.id} 加载失败：${err.message}`"
      type="error"
      show-icon
      :closable="false"
      class="err"
    />

    <input ref="zipInput" type="file" accept=".zip" class="hidden-input" @change="onZipPicked" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { pluginRegistry } from '../plugins/store'
import { reloadPlugins } from '../plugins/host'
import type { PluginInfo } from '../../../preload/index'

const loading = ref(false)
const reloading = ref(false)
const switchingId = ref<string | null>(null)
const plugins = ref<PluginInfo[]>([])
const selected = ref<PluginInfo[]>([])
const zipInput = ref<HTMLInputElement>()
const tableRef = ref<TableInstance>()

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
  await ElMessageBox.confirm(
    `确定卸载插件「${row.name}」吗？其目录与本地数据（KV）将被删除。`,
    '卸载确认',
    { type: 'warning', confirmButtonText: '卸载', cancelButtonText: '取消' }
  )
  try {
    await window.api.plugins.uninstall(row.id)
    await reloadPlugins()
    await fetchList()
    ElMessage.success(`已卸载 ${row.name}`)
  } catch (err) {
    ElMessage.error(`卸载失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function uninstallSelected(): void {
  const first = selected.value[0]
  if (!first) {
    ElMessage.info('请先在表格中勾选要卸载的插件')
    return
  }
  void uninstall(first)
}

/** 从 URL 安装/升级：下载 zip（可选校验 sha256）→ 原子落位 → 重载插件 */
async function installFromUrl(): Promise<void> {
  const { value } = await ElMessageBox.prompt(
    '输入工具/插件 zip 包的下载地址（同 id 已安装时执行升级）',
    '从 URL 安装',
    { inputPlaceholder: 'https://…/my-tool-0.1.0.zip', inputValue: '', cancelButtonText: '取消', confirmButtonText: '下载安装' }
  ).catch(() => ({ value: '' }))
  const url = value.trim()
  if (!url) return
  const loadingMsg = ElMessage({ message: '正在下载并安装…', type: 'info', duration: 0 })
  try {
    const res = (await window.api.plugins.installRemote({ url })) as { id: string; name: string; version: string }
    await reloadPlugins()
    await fetchList()
    ElMessage.success(`已安装 ${res.name} v${res.version}`)
  } catch (err) {
    ElMessage.error(`安装失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    loadingMsg.close()
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

onMounted(fetchList)
</script>

<style scoped>
.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
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
  margin-top: 12px;
}
</style>

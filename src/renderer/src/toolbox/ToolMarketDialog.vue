<!-- 获取工具（远程安装）：从 registry 索引拉取可用工具列表，比对本地已装版本，
     一键安装/更新（下载 zip → sha256 校验 → 原子落位 → 重载插件）。
     支持自定义 registry URL；sha256 缺失的条目标记「未校验」。 -->
<template>
  <el-dialog v-model="visible" title="获取工具" width="640px" :close-on-click-modal="false" @open="fetchList">
    <div class="src-row">
      <el-input v-model="registryUrl" placeholder="registry 索引地址（JSON）" size="small" clearable />
      <el-button size="small" :loading="loading" @click="fetchList">刷新</el-button>
    </div>

    <el-table :data="entries" v-loading="loading" size="small" max-height="360" empty-text="索引为空或未加载">
      <el-table-column label="工具" min-width="170">
        <template #default="{ row }">
          <div class="t-name">{{ row.name }}</div>
          <div class="t-desc">{{ row.description }}</div>
        </template>
      </el-table-column>
      <el-table-column label="版本" width="130">
        <template #default="{ row }">
          <div class="t-ver">远程 v{{ row.version }}</div>
          <div v-if="installedMap[row.id]" class="t-ver dim">本地 v{{ installedMap[row.id].version }}</div>
        </template>
      </el-table-column>
      <el-table-column label="校验" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.sha256" size="small" type="success" effect="plain">SHA256</el-tag>
          <el-tooltip v-else content="索引未提供哈希，安装时不做完整性校验" placement="top">
            <el-tag size="small" type="info" effect="plain">未校验</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90" align="center">
        <template #default="{ row }">
          <el-button
            size="small"
            :type="actionOf(row).type"
            :loading="installing === row.id"
            @click="install(row)"
          >{{ actionOf(row).label }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="foot-hint">
      工具包为 AtoZ 插件（主世界运行，权限为声明式约束），仅安装可信来源。安装来源 registry 默认指向仓库内置地址，可替换为自建索引。
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

interface RemoteEntry {
  id: string
  name: string
  version: string
  description?: string
  category?: string
  downloadUrl: string
  sha256?: string
}

const visible = defineModel<boolean>({ default: false })

/** 仓库内置 registry；可替换为自建索引 */
const DEFAULT_REGISTRY_URL = 'https://gitee.com/yukai1998/my-dash/raw/main/tools-registry/registry.json'
const registryUrl = ref('')
const loading = ref(false)
const entries = ref<RemoteEntry[]>([])
const installing = ref('')
const installedMap = ref<Record<string, { version: string }>>({})

async function refreshInstalled(): Promise<void> {
  const list = (await window.api.plugins.list()) as Array<{ id: string; version: string; source: string }>
  installedMap.value = Object.fromEntries(list.map((p) => [p.id, { version: p.version }]))
}

async function fetchList(): Promise<void> {
  loading.value = true
  try {
    const [remote, ] = await Promise.all([
      window.api.plugins.remoteList(registryUrl.value.trim() || undefined) as Promise<RemoteEntry[]>,
      refreshInstalled()
    ])
    entries.value = remote
  } catch (err) {
    ElMessage.error(`拉取工具索引失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    loading.value = false
  }
}

function actionOf(row: RemoteEntry): { label: string; type: 'primary' | 'warning' | 'info' } {
  const local = installedMap.value[row.id]
  if (!local) return { label: '安装', type: 'primary' }
  return local.version === row.version
    ? { label: '重装', type: 'info' }
    : { label: `更新`, type: 'warning' }
}

async function install(row: RemoteEntry): Promise<void> {
  installing.value = row.id
  try {
    await window.api.plugins.installRemote({ url: row.downloadUrl, sha256: row.sha256 || undefined })
    ElMessage.success(`已安装 ${row.name} v${row.version}`)
    await refreshInstalled()
    // 重载插件：新工具注册进工具箱
    const { reloadPlugins } = await import('../plugins/host')
    await reloadPlugins()
  } catch (err) {
    ElMessage.error(`安装失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    installing.value = ''
  }
}
</script>

<style scoped>
.src-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.src-row .el-input {
  flex: 1;
}

.t-name {
  font-weight: 600;
  font-size: 13px;
}

.t-desc {
  font-size: 12px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.t-ver {
  font-size: 12px;
}

.dim {
  color: var(--ink-3);
}

.foot-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.6;
}
</style>

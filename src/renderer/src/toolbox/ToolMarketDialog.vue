<!-- 获取工具（远程安装）：从 registry 索引拉取可用工具列表，比对本地已装版本，
     一键安装/更新（下载 zip → sha256 校验 → 原子落位 → 重载插件）。
     支持自定义 registry URL；sha256 缺失的条目标记「未校验」。 -->
<template>
  <el-dialog v-model="visible" title="获取工具" width="640px" :close-on-click-modal="false" @open="fetchList">
    <div class="src-row">
      <el-input
        v-model="registryUrl"
        placeholder="自定义索引地址（留空使用内置多源：Gitee → jsDelivr → GitHub）"
        size="small"
        clearable
      />
      <el-button size="small" :loading="loading" @click="fetchList">刷新</el-button>
      <el-button size="small" text :disabled="!registryUrl" @click="resetRegistry">默认</el-button>
    </div>
    <div v-if="sourceLabel" class="src-hint">当前索引：{{ sourceLabel }}</div>

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
          <el-tooltip
            v-if="row.mirrors?.length"
            :content="`备用下载源 ${row.mirrors.length} 个：主地址失败时自动切换`"
            placement="top"
          >
            <span class="t-mirror">含镜像</span>
          </el-tooltip>
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
      工具包为 AtoZ 插件（主世界运行，权限为声明式约束），仅安装可信来源。索引默认按
      Gitee → jsDelivr → GitHub 顺序自动回退，下载同样支持镜像切换。
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
  mirrors?: string[]
  sha256?: string
  size?: number
}

const visible = defineModel<boolean>({ default: false })

/** 自定义索引地址记忆到本地：换设备 / 重装后仍指向自建仓库 */
const STORAGE_KEY = 'mydash:tools-registry'
const registryUrl = ref(localStorage.getItem(STORAGE_KEY) || '')
const source = ref('')
const loading = ref(false)
const entries = ref<RemoteEntry[]>([])
const installing = ref('')
const installedMap = ref<Record<string, { version: string }>>({})

/** 展示用：去掉协议头，过长时截断 */
const sourceLabel = computed(() => {
  const text = source.value.replace(/^https?:\/\//, '')
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
})

async function refreshInstalled(): Promise<void> {
  const list = (await window.api.plugins.list()) as Array<{ id: string; version: string; source: string }>
  installedMap.value = Object.fromEntries(list.map((p) => [p.id, { version: p.version }]))
}

async function fetchList(): Promise<void> {
  loading.value = true
  const custom = registryUrl.value.trim()
  try {
    const res = await window.api.plugins.remoteList(custom || undefined)
    entries.value = res.entries
    source.value = res.source
    // 只有自定义地址才持久化，内置多源不写死，便于以后调整顺序
    if (custom) localStorage.setItem(STORAGE_KEY, custom)
    else localStorage.removeItem(STORAGE_KEY)
    await refreshInstalled()
  } catch (err) {
    entries.value = []
    source.value = ''
    ElMessage.error(`拉取工具索引失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    loading.value = false
  }
}

function resetRegistry(): void {
  registryUrl.value = ''
  localStorage.removeItem(STORAGE_KEY)
  void fetchList()
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
    await window.api.plugins.installRemote({
      url: row.downloadUrl,
      mirrors: row.mirrors,
      sha256: row.sha256 || undefined
    })
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

.src-hint {
  margin: -6px 0 10px;
  font-size: 11.5px;
  color: var(--ink-3);
  word-break: break-all;
}

.t-mirror {
  display: inline-block;
  margin-top: 2px;
  padding: 0 5px;
  font-size: 10.5px;
  line-height: 16px;
  border-radius: 4px;
  color: var(--ink-3);
  background: var(--fill-subtle);
  border: 1px solid var(--divider);
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

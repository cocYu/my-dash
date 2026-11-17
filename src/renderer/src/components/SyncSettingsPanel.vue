<template>
  <div class="panel">
    <!-- 同步目标 -->
    <div class="block">
      <div class="block-title">同步目标</div>
      <el-radio-group v-model="cfg.target" class="target-switch">
        <el-radio-button value="webdav">WebDAV</el-radio-button>
        <el-radio-button value="s3">S3 对象存储</el-radio-button>
      </el-radio-group>

      <el-form v-if="cfg.target === 'webdav'" label-width="92px" class="form">
        <el-form-item label="服务地址">
          <el-input v-model="cfg.webdav.url" placeholder="https://dav.example.com/dav/" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="cfg.webdav.username" placeholder="可留空" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="cfg.webdav.password" type="password" show-password placeholder="可留空" />
        </el-form-item>
      </el-form>

      <el-form v-else label-width="92px" class="form">
        <el-form-item label="Endpoint">
          <el-input v-model="cfg.s3.endpoint" placeholder="https://s3.amazonaws.com 或兼容端点" />
        </el-form-item>
        <el-form-item label="Region">
          <el-input v-model="cfg.s3.region" placeholder="auto / us-east-1 …" />
        </el-form-item>
        <el-form-item label="Bucket">
          <el-input v-model="cfg.s3.bucket" />
        </el-form-item>
        <el-form-item label="AccessKey">
          <el-input v-model="cfg.s3.accessKeyId" />
        </el-form-item>
        <el-form-item label="SecretKey">
          <el-input v-model="cfg.s3.secretAccessKey" type="password" show-password />
        </el-form-item>
        <el-form-item label="路径风格">
          <el-switch v-model="cfg.s3.pathStyle" /> <span class="inline-hint">MinIO/OSS 等兼容端点通常开启</span>
        </el-form-item>
      </el-form>

      <el-form label-width="92px" class="form">
        <el-form-item label="远端目录">
          <el-input v-model="cfg.remotePath" placeholder="/mydash-backup" />
        </el-form-item>
        <el-form-item label="保留份数">
          <el-input-number v-model="cfg.keepLast" :min="1" :max="100" />
        </el-form-item>
      </el-form>

      <div class="form-actions">
        <el-button :loading="testing" @click="test">测试连接</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
      </div>
    </div>

    <!-- 定时同步 -->
    <div class="block">
      <div class="block-title">定时同步</div>
      <div class="schedule-row">
        <el-switch v-model="cfg.schedule.enabled" />
        <template v-if="cfg.schedule.enabled">
          <el-radio-group v-model="cfg.schedule.mode" size="small">
            <el-radio-button value="interval">固定间隔</el-radio-button>
            <el-radio-button value="daily">每日定点</el-radio-button>
          </el-radio-group>
          <template v-if="cfg.schedule.mode === 'interval'">
            <span class="inline-hint">每</span>
            <el-input-number v-model="cfg.schedule.intervalHours" :min="1" :max="168" size="small" />
            <span class="inline-hint">小时</span>
          </template>
          <template v-else>
            <el-time-picker v-model="dailyTime" format="HH:mm" placeholder="时间" size="small" />
          </template>
        </template>
      </div>
      <div v-if="cfg.lastSuccessAt" class="inline-hint last-hint">
        上次成功同步：{{ new Date(cfg.lastSuccessAt).toLocaleString() }}
      </div>
    </div>

    <!-- 立即同步 -->
    <div class="block">
      <div class="block-title">立即同步</div>
      <div class="sync-now">
        <el-button type="primary" :loading="syncing" @click="syncNow">同步到云端</el-button>
        <span class="inline-hint">打包数据库快照 + 全部插件（含本地数据），上传到上方目标</span>
      </div>
    </div>

    <!-- 同步记录 -->
    <div class="block">
      <div class="block-title">同步记录</div>
      <el-table v-loading="historyLoading" :data="history" stripe size="small" style="width: 100%">
        <el-table-column label="时间" min-width="170">
          <template #default="{ row }">{{ new Date(row.time).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="类型" min-width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.direction === 'restore' ? '还原' : '备份' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="触发" min-width="80">
          <template #default="{ row }">{{ row.trigger === 'scheduled' ? '定时' : '手动' }}</template>
        </el-table-column>
        <el-table-column label="目标" min-width="90">
          <template #default="{ row }">{{ row.target === 's3' ? 'S3' : 'WebDAV' }}</template>
        </el-table-column>
        <el-table-column label="大小" min-width="90">
          <template #default="{ row }">{{ row.size ? formatSize(row.size) : '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" min-width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'success' ? 'success' : 'danger'" effect="plain">
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :disabled="row.direction !== 'backup' || row.status !== 'success' || !!row.purged || restoring"
              @click="restore(row)"
            >还原</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无同步记录" :image-size="72" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { SyncConfig, SyncHistoryRecord as HistoryRecord } from '../../../types/sync'

const cfg = ref<SyncConfig>(emptyConfig())
const testing = ref(false)
const saving = ref(false)
const syncing = ref(false)
const restoring = ref(false)
const historyLoading = ref(false)
const history = ref<HistoryRecord[]>([])
const dailyTime = ref<Date>(new Date('2000-01-01T03:00:00'))

function emptyConfig(): SyncConfig {
  return {
    target: 'webdav',
    remotePath: '/mydash-backup',
    keepLast: 10,
    webdav: { url: '', username: '', password: '' },
    s3: { endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '', pathStyle: true },
    schedule: { enabled: false, mode: 'interval', intervalHours: 12, dailyTime: '03:00' }
  }
}

const dailyTimeString = computed(() => {
  const d = dailyTime.value
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
})

function syncDailyTimeToCfg(): void {
  cfg.value.schedule.dailyTime = dailyTimeString.value
}
watch(dailyTime, syncDailyTimeToCfg, { deep: false })

async function fetchConfig(): Promise<void> {
  cfg.value = { ...emptyConfig(), ...((await window.api.sync.getConfig()) as Partial<SyncConfig>) } as SyncConfig
  dailyTime.value = new Date(`2000-01-01T${cfg.value.schedule.dailyTime ?? '03:00'}:00`)
}

async function save(): Promise<void> {
  syncDailyTimeToCfg()
  saving.value = true
  try {
    await window.api.sync.saveConfig(JSON.parse(JSON.stringify(cfg.value)))
    ElMessage.success('配置已保存')
  } catch (err) {
    ElMessage.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    saving.value = false
  }
}

async function test(): Promise<void> {
  syncDailyTimeToCfg()
  testing.value = true
  try {
    await window.api.sync.testConnection(JSON.parse(JSON.stringify(cfg.value)))
    ElMessage.success('连接成功')
  } catch (err) {
    ElMessage.error(`连接失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    testing.value = false
  }
}

async function syncNow(): Promise<void> {
  await save()
  syncing.value = true
  try {
    const rec = (await window.api.sync.run()) as { size: number }
    ElMessage.success(`同步完成（${formatSize(rec.size)}）`)
    await fetchHistory()
  } catch (err) {
    ElMessage.error(`同步失败：${err instanceof Error ? err.message : String(err)}`)
    await fetchHistory()
  } finally {
    syncing.value = false
  }
}

async function restore(row: HistoryRecord): Promise<void> {
  await ElMessageBox.confirm(
    '将从该备份还原数据库与插件。当前数据会被备份包内容覆盖，未包含在备份内的插件会保留。继续吗？',
    '还原确认',
    { type: 'warning', confirmButtonText: '开始还原', cancelButtonText: '取消' }
  )
  restoring.value = true
  try {
    await window.api.sync.restore(row.remoteFile!)
    ElMessage.success('还原完成，正在刷新数据…')
    await reloadPluginsAndData()
    await fetchHistory()
  } catch (err) {
    ElMessage.error(`还原失败：${err instanceof Error ? err.message : String(err)}`)
    await fetchHistory()
  } finally {
    restoring.value = false
  }
}

/** 还原后让页面数据回归备份时点：刷新插件与整页数据 */
async function reloadPluginsAndData(): Promise<void> {
  const { reloadPlugins } = await import('../plugins/host')
  await reloadPlugins()
  window.location.reload()
}

async function fetchHistory(): Promise<void> {
  historyLoading.value = true
  try {
    history.value = (await window.api.sync.getHistory()) as HistoryRecord[]
  } finally {
    historyLoading.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

onMounted(async () => {
  await fetchConfig()
  await fetchHistory()
})
</script>

<style scoped>
.block {
  margin-bottom: 22px;
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 12px;
}

.form {
  max-width: min(520px, 100%);
}

.target-switch {
  margin-bottom: 14px;
}

.form-actions {
  margin-left: 92px;
}

.schedule-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.inline-hint {
  font-size: 12px;
  color: var(--ink-3);
}

.last-hint {
  margin-top: 8px;
}

.sync-now {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>

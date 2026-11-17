<!-- 时间戳工具：当前时间(秒级刷新) + 时间戳→日期 + 日期→时间戳 双向转换（dayjs） -->
<template>
  <div class="ts">
    <div class="now glass">
      <span class="now-label">当前时间</span>
      <span class="now-value">{{ nowLabel }}</span>
      <span class="now-ts">{{ nowSec }} <button class="mini" @click="copy(String(nowSec))">复制秒</button></span>
      <span class="now-ts">{{ nowMs }} <button class="mini" @click="copy(String(nowMs))">复制毫秒</button></span>
    </div>

    <div class="block">
      <div class="block-title">时间戳 → 日期</div>
      <div class="row">
        <el-input v-model="tsInput" placeholder="粘贴时间戳（10 位秒 / 13 位毫秒自动识别）" clearable />
        <el-button @click="tsToNow">设为当前</el-button>
        <el-button @click="copy(tsOutput.local || '')" :disabled="!tsOutput.local">复制结果</el-button>
      </div>
      <el-descriptions v-if="tsOutput.local" :column="2" border size="small" class="desc">
        <el-descriptions-item label="本地时间">{{ tsOutput.local }}</el-descriptions-item>
        <el-descriptions-item label="ISO 8601">{{ tsOutput.iso }}</el-descriptions-item>
        <el-descriptions-item label="UTC">{{ tsOutput.utc }}</el-descriptions-item>
        <el-descriptions-item label="相对时间">{{ tsOutput.relative }}</el-descriptions-item>
      </el-descriptions>
      <el-alert v-else-if="tsError" :title="tsError" type="error" :closable="false" />
    </div>

    <div class="block">
      <div class="block-title">日期 → 时间戳</div>
      <div class="row">
        <el-date-picker v-model="dateValue" type="datetime" placeholder="选择日期时间" format="YYYY-MM-DD HH:mm:ss" class="date-picker" />
        <el-button :disabled="!dateValue" @click="copy(dateOutput.sec)">复制秒</el-button>
        <el-button :disabled="!dateValue" @click="copy(dateOutput.ms)">复制毫秒</el-button>
      </div>
      <div v-if="dateValue" class="out-row">
        <el-tag effect="plain">秒：{{ dateOutput.sec }}</el-tag>
        <el-tag effect="plain">毫秒：{{ dateOutput.ms }}</el-tag>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-timestamp' })
import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.extend(utc)
dayjs.locale('zh-cn')

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
// keep-alive 下切走停表，回来续上，不留后台定时器
onActivated(start)
onDeactivated(stop)
onUnmounted(stop)

function start(): void {
  stop()
  now.value = Date.now()
  ticker = setInterval(() => (now.value = Date.now()), 1000)
}
function stop(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

const nowLabel = computed(() => dayjs(now.value).format('YYYY-MM-DD HH:mm:ss'))
const nowSec = computed(() => Math.floor(now.value / 1000))
const nowMs = computed(() => now.value)

// ---- 时间戳 → 日期 ----
const tsInput = ref('')
const tsOutput = computed(() => {
  const raw = tsInput.value.trim()
  if (!raw) return { local: '', iso: '', utc: '', relative: '' }
  const n = Number(raw)
  if (!Number.isFinite(n)) return { local: '', iso: '', utc: '', relative: '' }
  // 依位数自动识别：<=11 位按秒，>11 位按毫秒
  const d = String(Math.trunc(Math.abs(n))).length > 11 ? dayjs(n) : dayjs(n * 1000)
  if (!d.isValid()) return { local: '', iso: '', utc: '', relative: '' }
  return {
    local: d.format('YYYY-MM-DD HH:mm:ss dddd'),
    iso: d.toISOString(),
    utc: d.utc().format('YYYY-MM-DD HH:mm:ss'),
    relative: d.fromNow()
  }
})
const tsError = computed(() =>
  tsInput.value.trim() && !tsOutput.value.local ? '无法识别的时间戳（应为纯数字）' : ''
)

// ---- 日期 → 时间戳 ----
const dateValue = ref<Date | null>(null)
const dateOutput = computed(() => {
  const d = dateValue.value ? dayjs(dateValue.value) : null
  return { sec: d ? String(d.unix()) : '', ms: d ? String(d.valueOf()) : '' }
})

async function copy(text: string): Promise<void> {
  if (!text) return
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

function tsToNow(): void {
  tsInput.value = String(nowMs.value)
}
</script>

<style scoped>
.ts {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.now {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  flex-wrap: wrap;
}

.now-label {
  font-size: 12px;
  color: var(--ink-3);
}

.now-value {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.now-ts {
  font-size: 13px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mini {
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.block-title {
  font-size: 12px;
  color: var(--ink-3);
  margin-bottom: 8px;
}

.row {
  display: flex;
  gap: 8px;
}

.row > .el-input {
  flex: 1;
}

.date-picker {
  flex: 1;
}

.desc {
  margin-top: 10px;
}

.out-row {
  margin-top: 10px;
  display: flex;
  gap: 10px;
}
</style>

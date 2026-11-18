<template>
  <div class="usage-view">
    <div class="section-head">
      <div>
        <div class="row-title">用量统计</div>
        <div class="row-desc">按日期查询 AI 调用次数与 token 消耗，数据来自本地用量记录，随云端备份同步。</div>
      </div>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="filter-bar">
      <span class="filter-label">查询方式</span>
      <el-radio-group v-model="rangeMode" size="small" @change="load">
        <el-radio-button value="single">单日</el-radio-button>
        <el-radio-button value="range">日期范围</el-radio-button>
        <el-radio-button value="all">全部</el-radio-button>
      </el-radio-group>

      <template v-if="rangeMode === 'single'">
        <el-date-picker
          v-model="singleDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          size="small"
          :clearable="false"
          @change="load"
        />
      </template>
      <template v-else-if="rangeMode === 'range'">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          size="small"
          @change="load"
        />
      </template>
      <span class="filter-tip">统计区间内共 {{ summary?.total.totalTokens.toLocaleString() || 0 }} tokens</span>
    </div>

    <div v-loading="loading" class="stat-cards">
      <div class="stat-card">
        <div class="stat-label">总 Token</div>
        <div class="stat-value">{{ (summary?.total.totalTokens || 0).toLocaleString() }}</div>
        <div class="stat-sub">输入 {{ (summary?.total.promptTokens || 0).toLocaleString() }} · 输出 {{ (summary?.total.completionTokens || 0).toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">对话调用</div>
        <div class="stat-value">{{ summary?.total.chatCalls || 0 }}</div>
        <div class="stat-sub">含提示词增强</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">生图调用</div>
        <div class="stat-value">{{ summary?.total.imageCalls || 0 }}</div>
        <div class="stat-sub">生图接口不返回 token 用量</div>
      </div>
    </div>

    <div class="section-subtitle">按日期</div>
    <el-table :data="summary?.days || []" size="small" stripe v-loading="loading" class="stat-table">
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column label="对话" width="80" align="right">
        <template #default="{ row }">{{ row.chatCalls }}</template>
      </el-table-column>
      <el-table-column label="生图" width="80" align="right">
        <template #default="{ row }">{{ row.imageCalls }}</template>
      </el-table-column>
      <el-table-column label="输入 Token" align="right">
        <template #default="{ row }">{{ row.promptTokens.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="输出 Token" align="right">
        <template #default="{ row }">{{ row.completionTokens.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="总 Token" align="right">
        <template #default="{ row }"><span class="strong">{{ row.totalTokens.toLocaleString() }}</span></template>
      </el-table-column>
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="provider-breakdown">
            <div v-for="p in row.byProvider" :key="p.providerId" class="breakdown-row">
              <span class="breakdown-name">{{ p.providerName }}</span>
              <span class="breakdown-calls">{{ p.calls }} 次</span>
              <span class="breakdown-tokens">{{ p.totalTokens.toLocaleString() }} tokens</span>
            </div>
            <div v-if="!row.byProvider.length" class="muted">无数据</div>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="!summary?.days?.length && !loading" class="empty-usage">当前查询区间没有用量记录</div>

    <div class="section-subtitle">调用明细（最近 {{ summary?.records.length || 0 }} 条）</div>
    <el-table :data="summary?.records.slice(0, 100) || []" size="small" stripe class="stat-table">
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ formatTime(row.at) }}</template>
      </el-table-column>
      <el-table-column prop="providerName" label="供应商" width="140" />
      <el-table-column label="类型" width="80">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" :type="row.kind === 'image' ? 'warning' : 'success'">
            {{ row.kind === 'image' ? '生图' : '对话' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="model" label="模型" min-width="140" show-overflow-tooltip />
      <el-table-column label="输入" width="90" align="right">
        <template #default="{ row }">{{ row.promptTokens.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="输出" width="90" align="right">
        <template #default="{ row }">{{ row.completionTokens.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="合计" width="90" align="right">
        <template #default="{ row }">{{ row.totalTokens.toLocaleString() }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AiUsageSummary } from '../../../../types/ai'

const loading = ref(false)
const rangeMode = ref<'single' | 'range' | 'all'>('all')
const singleDate = ref(today())
const dateRange = ref<string[]>([])
const summary = ref<AiUsageSummary | null>(null)

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const query =
      rangeMode.value === 'single'
        ? { date: singleDate.value }
        : rangeMode.value === 'range' && dateRange.value?.length === 2
          ? { from: dateRange.value[0], to: dateRange.value[1] }
          : {}
    summary.value = await window.api.ai.usage(query)
  } catch (err) {
    summary.value = null
  } finally {
    loading.value = false
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

onMounted(() => {
  void load()
})
</script>

<style scoped>
.usage-view { width: 100%; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.row-title { font-size: 14px; font-weight: 600; }
.row-desc { margin-top: 4px; font-size: 12px; color: var(--ink-3); line-height: 1.5; }

.filter-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  margin: 14px 0; padding: 10px 12px;
  background: var(--fill-subtle); border: 1px solid var(--divider); border-radius: var(--radius-sm);
}
.filter-label { font-size: 12px; color: var(--ink-2); }
.filter-tip { margin-left: auto; font-size: 11px; color: var(--ink-3); }

.stat-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
.stat-card {
  padding: 14px 16px; border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm); background: var(--fill-subtle);
}
.stat-label { font-size: 12px; color: var(--ink-3); }
.stat-value { margin-top: 6px; font-size: 22px; font-weight: 600; font-family: 'Outfit', sans-serif; }
.stat-sub { margin-top: 4px; font-size: 11px; color: var(--ink-3); }

.section-subtitle { margin: 18px 0 8px; font-size: 13px; font-weight: 600; }
.stat-table { width: 100%; }
.strong { font-weight: 600; }
.muted { color: var(--ink-3); font-size: 12px; }
.empty-usage { padding: 20px; text-align: center; font-size: 12px; color: var(--ink-3); }

.provider-breakdown { padding: 8px 16px; }
.breakdown-row { display: flex; gap: 16px; padding: 3px 0; font-size: 12px; color: var(--ink-2); }
.breakdown-name { min-width: 140px; }
.breakdown-calls { min-width: 60px; }
.breakdown-tokens { font-family: 'Outfit', monospace; }
</style>

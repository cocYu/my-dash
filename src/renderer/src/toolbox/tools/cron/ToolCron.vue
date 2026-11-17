<!-- Cron 表达式工具：cron-parser（v5）解析 + 下 5 次执行时间预览 + 字段说明 -->
<template>
  <div class="cr">
    <div class="row">
      <el-input v-model="expr" placeholder="*/5 * * * *（分 时 日 月 周）" clearable @keydown.enter="evaluate" />
      <el-button type="primary" @click="evaluate">解析</el-button>
    </div>
    <div class="presets">
      <el-tag v-for="p in PRESETS" :key="p.expr" size="small" effect="plain" class="preset" @click="expr = p.expr; evaluate()">
        {{ p.label }}
      </el-tag>
    </div>

    <el-alert v-if="error" :title="error" type="error" :closable="false" />

    <template v-if="result">
      <div class="glass desc-card">
        <div class="desc-line"><span class="k">表达式</span><code>{{ result.expr }}</code></div>
        <div class="desc-line"><span class="k">含义</span><span>{{ result.human }}</span></div>
        <div class="desc-line"><span class="k">下次执行</span><b>{{ result.nextLabel }}</b></div>
      </div>
      <div class="block-title">接下来 5 次执行时间</div>
      <el-table :data="upcoming" size="small" stripe>
        <el-table-column label="#" type="index" width="60" />
        <el-table-column label="本地时间" prop="local" />
        <el-table-column label="相对现在" prop="relative" />
      </el-table>
    </template>
    <el-empty v-else-if="!error" description="输入 cron 表达式并点击解析" :image-size="60" class="empty" />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-cron' })
import { ref } from 'vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { CronExpressionParser } from 'cron-parser'

dayjs.extend(relativeTime)

const PRESETS = [
  { label: '每分钟', expr: '* * * * *' },
  { label: '每5分钟', expr: '*/5 * * * *' },
  { label: '每小时', expr: '0 * * * *' },
  { label: '每天 03:00', expr: '0 3 * * *' },
  { label: '工作日 09:30', expr: '30 9 * * 1-5' },
  { label: '每月1号 00:00', expr: '0 0 1 * *' }
]

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const expr = ref('*/5 * * * *')
const error = ref('')
const result = ref<{ expr: string; human: string; nextLabel: string } | null>(null)
const upcoming = ref<Array<{ local: string; relative: string }>>([])

/** 五段字段的通俗描述（标准 5 段 cron；@宏 直接透传说明） */
function humanize(fields: string[]): string {
  const [min, hour, dom, mon, dow] = fields
  const part = (v: string, unit: string, all: string): string => {
    if (v === '*' || v === all) return `每${unit}`
    return `${unit} ${v}`
  }
  const seg = [part(min, '分钟', '*'), part(hour, '小时', '*')]
  seg.push(dom === '*' ? '每天' : `${mon === '*' ? '' : mon + '月'}${dom}日`)
  seg.push(dow === '*' ? '' : `周${dow}`)
  return seg.filter(Boolean).join(' · ')
}

function evaluate(): void {
  error.value = ''
  result.value = null
  upcoming.value = []
  const raw = expr.value.trim()
  if (!raw) return
  try {
    const parsed = CronExpressionParser.parse(raw, { currentDate: new Date() })
    const fields = raw.startsWith('@') ? [] : raw.replace(/\s+/g, ' ').split(' ')
    const next = parsed.next()
    result.value = {
      expr: raw,
      human: fields.length === 5 ? humanize(fields) : '预设宏表达式',
      nextLabel: next.toDate().toLocaleString()
    }
    const list: Array<{ local: string; relative: string }> = []
    let cursor = parsed
    for (let i = 0; i < 5; i++) {
      const d = cursor.next()
      const date = d.toDate()
      list.push({
        local: `${dayjs(date).format('YYYY-MM-DD HH:mm:ss')} 周${WEEKDAYS[date.getDay()]}`,
        relative: dayjs(date).fromNow()
      })
    }
    upcoming.value = list
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

evaluate()
</script>

<style scoped>
.cr {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: flex;
  gap: 8px;
}

.row > .el-input {
  flex: 1;
}

.presets {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.preset {
  cursor: pointer;
}

.desc-card {
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.desc-line {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.desc-line .k {
  width: 60px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ink-3);
}

code {
  font-family: ui-monospace, Menlo, monospace;
  background: var(--fill-subtle);
  padding: 1px 6px;
  border-radius: 4px;
}

.empty {
  padding: 30px 0;
}
</style>

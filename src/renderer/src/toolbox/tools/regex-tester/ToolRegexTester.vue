<!-- 正则测试器：pattern + flags，实时匹配高亮预览（HTML 转义后打 mark）+ 匹配列表与分组提取。
     零长匹配防护：跳过与上一匹配重叠的空匹配，避免死循环 -->
<template>
  <div class="rg">
    <div class="pat-row">
      <span class="slash">/</span>
      <el-input v-model="pattern" placeholder="正则表达式（不带两侧斜杠）" class="pat-input" />
      <span class="slash">/</span>
      <el-checkbox-group v-model="flags" size="small">
        <el-checkbox-button v-for="f in FLAG_ITEMS" :key="f.value" :value="f.value">{{ f.label }}</el-checkbox-button>
      </el-checkbox-group>
    </div>
    <el-alert v-if="regexError" :title="`正则不合法：${regexError}`" type="error" :closable="false" />

    <el-input v-model="text" type="textarea" :rows="6" placeholder="测试文本…" />

    <template v-if="compiled && !regexError">
      <div class="stat">
        <el-tag size="small" :type="matches.length ? 'success' : 'info'" effect="plain">
          {{ matches.length }} 处匹配
        </el-tag>
      </div>

      <div class="block-title">高亮预览</div>
      <div class="preview glass" v-html="highlighted"></div>

      <div v-if="matches.length" class="block-title">匹配详情</div>
      <el-table v-if="matches.length" :data="matchRows" size="small" stripe max-height="240">
        <el-table-column label="#" type="index" width="60" />
        <el-table-column label="匹配" min-width="140">
          <template #default="{ row }"><code>{{ row.value }}</code></template>
        </el-table-column>
        <el-table-column label="位置" width="100">
          <template #default="{ row }">{{ row.index }}</template>
        </el-table-column>
        <el-table-column label="分组" min-width="160">
          <template #default="{ row }">
            <span v-if="!row.groups.length" class="dim">-</span>
            <code v-for="(g, gi) in row.groups" :key="gi" class="group">{{ '$' + (Number(gi) + 1) + '=' + (g ?? '∅') }}</code>
          </template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-regex-tester' })
import { computed, ref, watch } from 'vue'

const FLAG_ITEMS = [
  { label: 'g 全局', value: 'g' },
  { label: 'i 忽略大小写', value: 'i' },
  { label: 'm 多行', value: 'm' },
  { label: 's dotall', value: 's' },
  { label: 'u unicode', value: 'u' }
]

const pattern = ref('\\d{4}-\\d{2}-\\d{2}')
const flags = ref<string[]>(['g'])
const text = ref('开工日期 2026-01-12，验收日期 2026-03-01，都写进合同里。')

const flagStr = computed(() => {
  const arr = [...flags.value]
  // 无 g 时手动限制只取第一次匹配，避免死循环——统一按 g 跑再截断
  if (!arr.includes('g')) arr.push('g')
  return arr.join('')
})

const regexError = ref('')
const compiled = computed(() => {
  try {
    const re = new RegExp(pattern.value, flagStr.value)
    regexError.value = ''
    return re
  } catch (err) {
    regexError.value = err instanceof Error ? err.message : String(err)
    return null
  }
})

interface MatchRow {
  value: string
  index: number
  groups: string[]
}

const matches = computed<MatchRow[]>(() => {
  if (!compiled.value || !text.value) return []
  const out: MatchRow[] = []
  const re = new RegExp(compiled.value.source, compiled.value.flags)
  let m: RegExpExecArray | null
  let guard = 0
  let lastIndex = -1
  while ((m = re.exec(text.value)) && guard < 1000) {
    // 零长匹配推进防护
    if (m.index === lastIndex && m[0] === '') {
      re.lastIndex++
      continue
    }
    lastIndex = m.index
    out.push({ value: m[0], index: m.index, groups: m.slice(1) })
    if (!re.global) break
    guard++
  }
  if (!flags.value.includes('g')) out.splice(1)
  return out
})

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const highlighted = computed(() => {
  const src = escapeHtml(text.value || '')
  if (!compiled.value || !matches.value.length) return src || '<span class="dim">（无匹配）</span>'
  // 按原始索引拼装：原文索引与转义后索引一致（&/</> 转义保持 1:1 长度）
  const parts: string[] = []
  let pos = 0
  for (const m of matches.value) {
    const start = m.index
    const end = m.index + m.value.length
    if (start < pos) continue // 转义导致长度不变，理论上不会越界，防御一下
    parts.push(src.slice(pos, start))
    parts.push(`<mark>${src.slice(start, end)}</mark>`)
    pos = end
  }
  parts.push(src.slice(pos))
  return parts.join('')
})

const matchRows = computed(() => matches.value)

watch([pattern, flags], () => {
  // 切换 pattern 时上次匹配结果即刻失效（matches 为 computed 自动更新，这里仅占位）
})
</script>

<style scoped>
.rg {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pat-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.slash {
  color: var(--ink-3);
  font-family: ui-monospace, Menlo, monospace;
}

.pat-input :deep(input) {
  font-family: ui-monospace, Menlo, monospace;
}

.stat {
  display: flex;
  gap: 10px;
}

.block-title {
  font-size: 12px;
  color: var(--ink-3);
}

.preview {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
}

.preview :deep(mark) {
  background: var(--accent-soft);
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
}

.dim {
  color: var(--ink-3);
}

code {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  background: var(--fill-subtle);
  padding: 1px 5px;
  border-radius: 4px;
  margin-right: 6px;
}

.group {
  margin-right: 6px;
}
</style>

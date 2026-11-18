<template>
  <div class="tool-steps">
    <div
      v-for="(s, i) in steps"
      :key="i"
      class="tool-step"
      :class="{ fail: !s.ok, open: openIdx === i }"
      @click="openIdx = openIdx === i ? -1 : i"
    >
      <el-icon class="step-icon">
        <CircleCheck v-if="s.ok" />
        <CircleClose v-else />
      </el-icon>
      <span class="step-label">{{ s.label }}</span>
      <span v-if="argsPreview(s)" class="step-args">{{ argsPreview(s) }}</span>
      <span class="step-time">{{ s.durationMs }}ms</span>
    </div>
    <div v-if="openIdx >= 0 && steps[openIdx]" class="step-detail">
      <div class="detail-row">
        <span class="detail-key">参数</span>
        <pre class="detail-val">{{ prettyArgs(steps[openIdx]) }}</pre>
      </div>
      <div class="detail-row">
        <span class="detail-key">结果</span>
        <pre class="detail-val">{{ steps[openIdx].summary || '（无返回内容）' }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CircleCheck, CircleClose } from '@element-plus/icons-vue'
import type { AiToolStep } from '../../../../types/agent'

defineProps<{ steps: AiToolStep[] }>()

const openIdx = ref(-1)

/** 参数一行预览：去掉 JSON 的花括号与引号，只留关键值 */
function argsPreview(step: AiToolStep): string {
  const entries = Object.entries(step.args)
  if (!entries.length) return ''
  const text = entries
    .map(([k, v]) => (typeof v === 'string' ? v : JSON.stringify(v)))
    .filter(Boolean)
    .join(' · ')
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

function prettyArgs(step: AiToolStep): string {
  const entries = Object.entries(step.args)
  if (!entries.length) return '（无）'
  try {
    return JSON.stringify(step.args, null, 2)
  } catch {
    return String(entries)
  }
}
</script>

<style scoped>
.tool-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}
.tool-step {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-2);
  background: var(--fill-subtle);
  border: 1px solid var(--divider);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.tool-step:hover { background: var(--fill-hover); }
.tool-step.fail { color: var(--el-color-danger); }
.tool-icon { font-size: 12px; flex-shrink: 0; }
.tool-step:not(.fail) .step-icon { color: var(--el-color-success); }
.step-label { font-weight: 600; flex-shrink: 0; }
.step-args {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-3);
}
.step-time { margin-left: auto; flex-shrink: 0; font-size: 10px; color: var(--ink-3); }

.step-detail {
  padding: 8px 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--divider);
  border-radius: 6px;
}
.detail-row { display: flex; gap: 8px; align-items: flex-start; }
.detail-row + .detail-row { margin-top: 6px; }
.detail-key { flex-shrink: 0; font-size: 10px; color: var(--ink-3); width: 28px; padding-top: 2px; }
.detail-val {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--el-font-family, monospace);
  max-height: 220px;
  overflow-y: auto;
}
</style>

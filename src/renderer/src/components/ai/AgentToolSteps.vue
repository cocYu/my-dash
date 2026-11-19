<template>
  <div class="tool-steps">
    <div v-for="(s, i) in steps" :key="i" class="step-block">
      <div
        class="tool-step"
        :class="{ fail: !s.ok && !s.skipped, skipped: s.skipped, open: openIdx === i }"
        @click="openIdx = openIdx === i ? -1 : i"
      >
        <el-icon class="step-icon">
          <CircleCheck v-if="s.ok" />
          <Warning v-else-if="s.skipped" />
          <CircleClose v-else />
        </el-icon>
        <span class="step-label">{{ s.label }}</span>
        <span v-if="s.skipped" class="step-rejected">已拒绝</span>
        <span v-if="argsPreview(s)" class="step-args">{{ argsPreview(s) }}</span>
        <span class="step-time">{{ s.durationMs }}ms</span>
      </div>

      <!-- 生图工具产出的图片：不依赖模型复述 Markdown，直接展示 -->
      <div v-if="imageRefs(s).length" class="step-images" @click.stop>
        <el-image
          v-for="(name, idx) in imageRefs(s)"
          :key="name"
          :src="imageCache[name] || ''"
          :preview-src-list="previewList(s)"
          :initial-index="idx"
          fit="cover"
          class="step-image"
          preview-teleported
        >
          <template #placeholder>
            <div class="img-loading">加载中…</div>
          </template>
        </el-image>
      </div>
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
import { ref, watch } from 'vue'
import { CircleCheck, CircleClose, Warning } from '@element-plus/icons-vue'
import type { AiToolStep } from '../../../../types/agent'

const props = defineProps<{ steps: AiToolStep[] }>()

const openIdx = ref(-1)

/** attach:// 附件名 → dataUrl（attach 协议不保证能直接被 <img> 加载，统一走 IPC 读取） */
const imageCache = ref<Record<string, string>>({})

/** 从工具结果里提取附件图片名（生图工具会返回 Markdown 图片链接） */
function imageRefs(step: AiToolStep): string[] {
  const text = step.summary || ''
  const names = [...text.matchAll(/attach:\/\/([A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+)/g)].map((m) => m[1])
  return [...new Set(names)]
}

function previewList(step: AiToolStep): string[] {
  return imageRefs(step)
    .map((n) => imageCache.value[n])
    .filter((x): x is string => Boolean(x))
}

async function ensureImages(): Promise<void> {
  for (const step of props.steps) {
    for (const name of imageRefs(step)) {
      if (imageCache.value[name]) continue
      try {
        const url = await window.api.attachments.readDataUrl(name)
        if (url) imageCache.value = { ...imageCache.value, [name]: url }
      } catch {
        /* 附件缺失时保持占位，不影响步骤展示 */
      }
    }
  }
}

watch(() => props.steps.map((s) => `${s.name}:${s.summary}`).join('|'), ensureImages, { immediate: true })

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
.step-block { display: flex; flex-direction: column; gap: 4px; }
.step-images { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 8px; }
.step-image {
  width: 132px;
  height: 132px;
  border-radius: 6px;
  border: 1px solid var(--divider);
  background: var(--fill-subtle);
  cursor: zoom-in;
  overflow: hidden;
}
.img-loading {
  width: 132px;
  height: 132px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--ink-3);
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
.tool-step.skipped { color: var(--el-color-warning); }
.tool-step.skipped .step-icon { color: var(--el-color-warning); }
.step-rejected { flex-shrink: 0; font-size: 10px; color: var(--el-color-warning); }
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

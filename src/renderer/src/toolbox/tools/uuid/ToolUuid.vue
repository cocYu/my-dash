<!-- UUID 生成器：批量 v4（crypto.randomUUID，非安全上下文回退 getRandomValues 手搓）+ 常用格式选项 -->
<template>
  <div class="uu">
    <div class="ops">
      <span class="label">数量</span>
      <el-input-number v-model="count" :min="1" :max="500" size="small" />
      <el-checkbox v-model="uppercase" size="small">大写</el-checkbox>
      <el-checkbox v-model="noDashes" size="small">去连字符</el-checkbox>
      <el-checkbox v-model="braces" size="small">花括号包裹</el-checkbox>
      <el-button type="primary" size="small" @click="generate">生成</el-button>
      <el-button size="small" :disabled="!list.length" @click="copyAll">复制全部</el-button>
    </div>
    <el-input v-model="output" type="textarea" :rows="16" readonly placeholder="点击「生成」…（回车或快捷键重生成）" class="out" />
    <div class="meta-hint">UUID v4 · crypto 随机源{{ fallback ? '（回退 getRandomValues）' : '' }} · 共 {{ list.length }} 条</div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-uuid' })
import { computed, onActivated, ref } from 'vue'
import { ElMessage } from 'element-plus'

const count = ref(10)
const uppercase = ref(false)
const noDashes = ref(false)
const braces = ref(false)
const list = ref<string[]>([])
const fallback = !('randomUUID' in crypto)

function v4(): string {
  if (!fallback) return crypto.randomUUID()
  // 非安全上下文回退：getRandomValues 手工拼 v4
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function formatOne(u: string): string {
  let s = uppercase.value ? u.toUpperCase() : u
  if (noDashes.value) s = s.replaceAll('-', '')
  if (braces.value) s = `{${s}}`
  return s
}

function generate(): void {
  list.value = Array.from({ length: count.value }, () => formatOne(v4()))
}

const output = computed(() => list.value.join('\n'))

async function copyAll(): Promise<void> {
  await navigator.clipboard.writeText(output.value)
  ElMessage.success(`已复制 ${list.value.length} 条`)
}

// keep-alive 回访页面顺手重生成一批，避免陈旧列表误导
onActivated(generate)
generate()
</script>

<style scoped>
.uu {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ops {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.label {
  font-size: 12px;
  color: var(--ink-3);
}

.out :deep(textarea) {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
}

.meta-hint {
  font-size: 12px;
  color: var(--ink-3);
}
</style>

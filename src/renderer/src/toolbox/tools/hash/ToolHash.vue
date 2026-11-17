<!-- 哈希计算：MD5（自实现，WebCrypto 不支持）/ SHA-1 / SHA-256（WebCrypto）。
     文本 300ms 防抖；文件 ≤50MB，分块读入后一次性计算 -->
<template>
  <div class="hh">
    <el-tabs v-model="mode">
      <el-tab-pane label="文本" name="text">
        <el-input v-model="text" type="textarea" :rows="8" placeholder="输入要计算哈希的文本…" />
      </el-tab-pane>
      <el-tab-pane label="文件" name="file">
        <div class="file-row">
          <el-button @click="pickFile">选择文件（≤50MB）</el-button>
          <span v-if="file" class="file-meta">{{ file.name }} · {{ formatSize(file.size) }}</span>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="ops">
      <span class="label">算法</span>
      <el-checkbox-group v-model="algos" size="small">
        <el-checkbox-button value="MD5">MD5</el-checkbox-button>
        <el-checkbox-button value="SHA-1">SHA-1</el-checkbox-button>
        <el-checkbox-button value="SHA-256">SHA-256</el-checkbox-button>
      </el-checkbox-group>
    </div>

    <el-alert v-if="error" :title="error" type="error" :closable="false" />

    <div class="results">
      <div v-for="a in algos" :key="a" class="result-line">
        <span class="algo">{{ a }}</span>
        <code class="digest">{{ digests[a] || '计算中…' }}</code>
        <el-button size="small" text type="primary" :disabled="!digests[a]" @click="copy(digests[a])">复制</el-button>
      </div>
      <div v-if="!algos.length" class="dim">请至少选择一种算法</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-hash' })
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { md5 } from '../../shared/md5'

type Algo = 'MD5' | 'SHA-1' | 'SHA-256'

const mode = ref<'text' | 'file'>('text')
const text = ref('')
const file = ref<File | null>(null)
const algos = ref<Algo[]>(['MD5', 'SHA-256'])
const digests = ref<Record<string, string>>({})
const error = ref('')
let fileBuf: Uint8Array | null = null

async function compute(): Promise<void> {
  error.value = ''
  const next: Record<string, string> = {}
  const bytes: Uint8Array =
    mode.value === 'text'
      ? new TextEncoder().encode(text.value)
      : fileBuf ?? new Uint8Array()
  if (mode.value === 'file' && !fileBuf) {
    digests.value = {}
    return
  }
  for (const algo of algos.value) {
    if (algo === 'MD5') {
      next[algo] = md5(bytes)
    } else {
      const buf = await crypto.subtle.digest(algo, bytes as unknown as ArrayBuffer)
      next[algo] = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
    }
  }
  digests.value = next
}

// 文本 300ms 防抖
let timer: ReturnType<typeof setTimeout> | null = null
watch([text, mode, algos], () => {
  if (mode.value !== 'text') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(compute, 300)
})

async function pickFile(): Promise<void> {
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    if (f.size > 50 * 1024 * 1024) {
      error.value = '文件超过 50MB 上限'
      file.value = null
      fileBuf = null
      digests.value = {}
      return
    }
    file.value = f
    error.value = ''
    fileBuf = new Uint8Array(await f.arrayBuffer())
    await compute()
  }
  input.click()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}
</script>

<style scoped>
.hh {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-meta {
  font-size: 12.5px;
  color: var(--ink-2);
}

.ops {
  display: flex;
  align-items: center;
  gap: 12px;
}

.label {
  font-size: 12px;
  color: var(--ink-3);
}

.results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-line {
  display: flex;
  align-items: center;
  gap: 10px;
}

.algo {
  width: 70px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ink-3);
}

.digest {
  flex: 1;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
  background: var(--fill-subtle);
  border-radius: 6px;
  padding: 6px 10px;
  word-break: break-all;
}

.dim {
  color: var(--ink-3);
  font-size: 12px;
}
</style>

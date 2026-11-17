<!-- 编解码工具：URL（encodeURIComponent/decodeURIComponent，可选整链 encodeURI）与 Base64（UTF-8 安全） -->
<template>
  <div class="cc">
    <el-radio-group v-model="mode" size="small">
      <el-radio-button value="url">URL</el-radio-button>
      <el-radio-button value="base64">Base64</el-radio-button>
    </el-radio-group>

    <div class="row">
      <div class="pane">
        <div class="pane-title">
          原文
          <el-button size="small" text type="primary" @click="encode">编码 ↓</el-button>
        </div>
        <el-input v-model="plain" type="textarea" :rows="7" placeholder="输入要编码的内容…" />
      </div>
      <div class="swap">
        <el-button circle @click="swap"><el-icon><Sort /></el-icon></el-button>
      </div>
      <div class="pane">
        <div class="pane-title">
          编码后
          <el-button size="small" text type="primary" @click="decode">解码 ↑</el-button>
          <el-button size="small" text @click="copy(encoded)">复制</el-button>
        </div>
        <el-input v-model="encoded" type="textarea" :rows="7" placeholder="输入要解码的内容…" />
      </div>
    </div>

    <div v-if="mode === 'url'" class="opts">
      <el-checkbox v-model="urlFull" size="small">保留 URL 结构字符（encodeURI，:?/&= 不转义）</el-checkbox>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-codec' })
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Sort } from '@element-plus/icons-vue'

const mode = ref<'url' | 'base64'>('url')
const plain = ref('')
const encoded = ref('')
const urlFull = ref(false)
const error = ref('')

watch(mode, () => {
  error.value = ''
  plain.value = ''
  encoded.value = ''
})

function encode(): void {
  error.value = ''
  try {
    encoded.value = mode.value === 'url' ? (urlFull.value ? encodeURI(plain.value) : encodeURIComponent(plain.value)) : toBase64(plain.value)
  } catch (err) {
    error.value = `编码失败：${err instanceof Error ? err.message : String(err)}`
  }
}

function decode(): void {
  error.value = ''
  try {
    plain.value = mode.value === 'url' ? (urlFull.value ? decodeURI(encoded.value) : decodeURIComponent(encoded.value)) : fromBase64(encoded.value)
  } catch (err) {
    error.value = `解码失败：${err instanceof Error ? err.message : String(err)}（Base64 需合法字符且 4 的倍数长度）`
  }
}

function swap(): void {
  ;[plain.value, encoded.value] = [encoded.value, plain.value]
  error.value = ''
}

async function copy(text: string): Promise<void> {
  if (!text) return
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

/** UTF-8 安全 Base64（btoa 仅支持 Latin1，先走字节序列） */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64.trim())
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
</script>

<style scoped>
.cc {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 40px 1fr;
  gap: 8px;
  align-items: start;
}

.swap {
  display: flex;
  justify-content: center;
  padding-top: 22px;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pane-title {
  font-size: 12px;
  color: var(--ink-3);
  display: flex;
  align-items: center;
  gap: 4px;
}

.opts {
  font-size: 12px;
}
</style>

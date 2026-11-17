<!-- 简易 Postman：经本机 Go 后端 /api/tools/proxy 转发（渲染层 CORS 无法直连任意域）。
     支持 method/URL/请求头(动态行)/请求体；响应展示状态/耗时/头/体（JSON 自动美化，二进制可下载） -->
<template>
  <div class="pm">
    <div class="req-row">
      <el-select v-model="method" class="method" size="default">
        <el-option v-for="m in METHODS" :key="m" :label="m" :value="m" />
      </el-select>
      <el-input v-model="url" placeholder="https://httpbin.org/get" class="url-input" @keydown.enter="send" />
      <el-button type="primary" :loading="sending" @click="send">发送</el-button>
    </div>

    <el-tabs v-model="tab" class="req-tabs">
      <el-tab-pane label="请求头" name="headers">
        <div v-for="(h, i) in headers" :key="i" class="kv-row">
          <el-input v-model="h.k" placeholder="Header" size="small" class="kv-k" />
          <el-input v-model="h.v" placeholder="值" size="small" class="kv-v" />
          <el-button size="small" text type="danger" @click="headers.splice(i, 1)">删</el-button>
        </div>
        <el-button size="small" text type="primary" @click="headers.push({ k: '', v: '' })">+ 添加请求头</el-button>
      </el-tab-pane>
      <el-tab-pane :label="`请求体${hasBody ? '' : '（GET/HEAD 不可用）'}`" name="body">
        <el-input
          v-model="body"
          type="textarea"
          :rows="6"
          :disabled="!hasBody"
          placeholder="请求体（原样发送；JSON/表单请自行配好 Content-Type）"
        />
      </el-tab-pane>
    </el-tabs>

    <div class="resp-head">
      <span class="pane-title">响应</span>
      <template v-if="result">
        <el-tag :type="statusType" size="small" effect="plain">{{ result.status }} {{ result.statusText }}</el-tag>
        <span class="meta">{{ result.durationMs }}ms · {{ formatSize(result.size) }}{{ result.truncated ? ' · 已截断(10MB)' : '' }}</span>
        <el-button v-if="result.bodyBase64" size="small" @click="downloadBinary">下载二进制</el-button>
      </template>
    </div>

    <el-alert v-if="error" :title="error" type="error" :closable="false" class="resp-error" />

    <template v-if="result">
      <el-collapse class="resp-collapse">
        <el-collapse-item :title="`响应头 (${Object.keys(result.headers).length})`" name="h">
          <div v-for="(v, k) in result.headers" :key="k" class="resp-header-line">
            <b>{{ k }}:</b> {{ v }}
          </div>
        </el-collapse-item>
      </el-collapse>
      <div class="resp-body">
        <template v-if="result.bodyBase64">
          <el-empty description="二进制响应，点击上方「下载二进制」保存" :image-size="60" />
        </template>
        <CodeEditor v-else v-model="prettyBody" :language="bodyIsJson ? 'json' : 'text'" readonly min-height="120px" class="fill" />
      </div>
    </template>
    <el-empty v-else-if="!error && !sending" description="发送请求查看响应" :image-size="60" class="resp-empty" />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-postman' })
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import CodeEditor from '../../shared/CodeEditor.vue'
import { sendProxyRequest, type ProxyResult } from '../../../api/tools'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

const method = ref('GET')
const url = ref('')
const headers = ref<Array<{ k: string; v: string }>>([])
const body = ref('')
const tab = ref<'headers' | 'body'>('headers')
const sending = ref(false)
const result = ref<ProxyResult | null>(null)
const error = ref('')

const hasBody = computed(() => !['GET', 'HEAD'].includes(method.value))
const bodyIsJson = computed(() => {
  const ct = Object.entries(result.value?.headers ?? {})
    .find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  if (ct.toLowerCase().includes('json')) return true
  try {
    JSON.parse(result.value?.bodyText ?? '')
    return true
  } catch {
    return false
  }
})
const prettyBody = computed(() => {
  const text = result.value?.bodyText ?? ''
  if (!bodyIsJson.value) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
})
const statusType = computed(() => {
  const s = result.value?.status ?? 0
  if (s >= 200 && s < 300) return 'success'
  if (s >= 300 && s < 400) return 'warning'
  return 'danger'
})

/** axios 错误优先取后端响应体里的 message（如 SSRF 拒绝原因） */
function errDetail(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string }
  return e?.response?.data?.message ?? e?.message ?? String(err)
}

async function send(): Promise<void> {
  if (!url.value.trim()) {
    ElMessage.warning('请输入 URL')
    return
  }
  sending.value = true
  error.value = ''
  result.value = null
  try {
    const hs: Record<string, string> = {}
    for (const h of headers.value) {
      if (h.k.trim()) hs[h.k.trim()] = h.v
    }
    result.value = await sendProxyRequest({
      url: url.value.trim(),
      method: method.value,
      headers: hs,
      body: hasBody.value ? body.value : undefined
    })
  } catch (err) {
    error.value = errDetail(err)
  } finally {
    sending.value = false
  }
}

function downloadBinary(): void {
  if (!result.value?.bodyBase64) return
  const bytes = Uint8Array.from(atob(result.value.bodyBase64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes])
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'response.bin'
  a.click()
  URL.revokeObjectURL(a.href)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
</script>

<style scoped>
.pm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}

.req-row {
  display: flex;
  gap: 8px;
}

.method {
  width: 118px;
}

.url-input {
  flex: 1;
}

.req-tabs :deep(.el-tabs__content) {
  max-height: 180px;
  overflow: auto;
}

.kv-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.kv-k {
  width: 200px;
}

.kv-v {
  flex: 1;
}

.pane-title {
  font-size: 12px;
  color: var(--ink-3);
}

.resp-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta {
  font-size: 12px;
  color: var(--ink-3);
}

.resp-error {
  flex-shrink: 0;
}

.resp-collapse {
  flex-shrink: 0;
}

.resp-header-line {
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
  padding: 2px 0;
  word-break: break-all;
}

.resp-body,
.fill {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.resp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

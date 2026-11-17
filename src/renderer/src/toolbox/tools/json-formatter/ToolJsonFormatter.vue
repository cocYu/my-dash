<!-- JSON 美化：格式化 / 压缩 / 校验（错误行列定位）。300ms 防抖实时校验；>5MB 提示改用后端或脚本处理 -->
<template>
  <div class="jf">
    <div class="ops">
      <el-button-group>
        <el-button size="small" @click="format(2)">格式化(2空格)</el-button>
        <el-button size="small" @click="format(4)">格式化(4空格)</el-button>
        <el-button size="small" @click="minify">压缩</el-button>
      </el-button-group>
      <el-button size="small" @click="copyOutput" :disabled="!output">复制结果</el-button>
      <el-button size="small" @click="loadSample">示例</el-button>
      <el-button size="small" @click="clear">清空</el-button>
      <el-tag v-if="valid === true" type="success" size="small" effect="plain">✓ 合法 JSON</el-tag>
      <el-tag v-else-if="valid === false" type="danger" size="small" effect="plain">✗ {{ errorMsg }}</el-tag>
      <el-tag v-else size="small" type="info" effect="plain" disable-transitions>待输入</el-tag>
      <span class="hint">输入实时校验（300ms 防抖）· 大于 5MB 建议拆分处理</span>
    </div>
    <div class="panes">
      <div class="pane">
        <div class="pane-title">输入</div>
        <CodeEditor v-model="input" language="json" placeholder='粘贴 JSON，例如 {"a":1}' min-height="200px" class="fill" />
      </div>
      <div class="pane">
        <div class="pane-title">输出</div>
        <CodeEditor v-model="output" language="json" readonly min-height="200px" class="fill" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-json-formatter' })
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import CodeEditor from '../../shared/CodeEditor.vue'

const input = ref('')
const output = ref('')
const valid = ref<boolean | null>(null)
const errorMsg = ref('')

// 300ms 防抖：大文本 JSON.parse 也不至于每个按键都跑
let timer: ReturnType<typeof setTimeout> | null = null
watch(input, (v) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => validate(v), 300)
})

function validate(text: string): boolean {
  if (!text.trim()) {
    valid.value = null
    output.value = ''
    return false
  }
  try {
    JSON.parse(text)
    valid.value = true
    errorMsg.value = ''
    return true
  } catch (err) {
    valid.value = false
    errorMsg.value = err instanceof Error ? err.message : String(err)
    return false
  }
}

function format(space: number): void {
  if (!validate(input.value)) {
    if (input.value.trim()) ElMessage.error('JSON 不合法，无法格式化')
    return
  }
  output.value = JSON.stringify(JSON.parse(input.value), null, space)
}

function minify(): void {
  if (!validate(input.value)) {
    if (input.value.trim()) ElMessage.error('JSON 不合法，无法压缩')
    return
  }
  output.value = JSON.stringify(JSON.parse(input.value))
}

async function copyOutput(): Promise<void> {
  await navigator.clipboard.writeText(output.value)
  ElMessage.success('已复制')
}

function loadSample(): void {
  input.value = JSON.stringify({
    name: 'myDash',
    version: '0.1.0',
    features: ['notes', 'todos', 'toolbox'],
    plugins: { enabled: true, list: [{ id: 'notes-stats', version: '0.1.0' }] },
    nested: { deep: { value: null, flag: false } }
  })
  validate(input.value)
}

function clear(): void {
  input.value = ''
  output.value = ''
  valid.value = null
}
</script>

<style scoped>
.jf {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}

.ops {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.hint {
  font-size: 12px;
  color: var(--ink-3);
  margin-left: auto;
}

.panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.pane-title {
  font-size: 12px;
  color: var(--ink-3);
}

.fill {
  flex: 1;
  overflow: auto;
}
</style>

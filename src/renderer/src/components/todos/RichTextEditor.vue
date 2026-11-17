<template>
  <div class="rte" :class="{ focused }">
    <div class="rte-toolbar">
      <button type="button" title="加粗 (Ctrl+B)" @mousedown.prevent @click="exec('bold')"><b>B</b></button>
      <button type="button" title="斜体 (Ctrl+I)" @mousedown.prevent @click="exec('italic')"><i>I</i></button>
      <button type="button" title="下划线 (Ctrl+U)" @mousedown.prevent @click="exec('underline')"><u>U</u></button>
      <button type="button" title="删除线" @mousedown.prevent @click="exec('strikeThrough')"><s>S</s></button>
      <span class="rte-sep" />
      <button type="button" title="无序列表" @mousedown.prevent @click="exec('insertUnorderedList')">
        <el-icon><ListIcon /></el-icon>
      </button>
      <button type="button" title="有序列表" @mousedown.prevent @click="exec('insertOrderedList')">
        <span class="ol-mark">1.</span>
      </button>
      <span class="rte-sep" />
      <button type="button" title="链接" @mousedown.prevent @click="addLink">
        <el-icon><LinkIcon /></el-icon>
      </button>
      <button type="button" title="清除格式" @mousedown.prevent @click="exec('removeFormat')">
        <el-icon><DeleteIcon /></el-icon>
      </button>
    </div>
    <div
      ref="body"
      class="rte-body"
      contenteditable="true"
      :data-placeholder="placeholder"
      @input="onInput"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Delete as DeleteIcon, Link as LinkIcon, List as ListIcon } from '@element-plus/icons-vue'
import { sanitizeHtml } from '../../utils/rich-text'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
  }>(),
  { placeholder: '填写描述…' }
)

const emit = defineEmits<{
  'update:modelValue': [html: string]
}>()

const body = ref<HTMLElement>()
const focused = ref(false)
let applying = false

onMounted(() => {
  if (body.value) body.value.innerHTML = sanitizeHtml(props.modelValue)
})

// 外部值变化（切换待办/还原）时同步进编辑器；聚焦中不覆盖，避免打断输入
watch(
  () => props.modelValue,
  (html) => {
    if (!body.value) return
    if (focused.value) return
    const clean = sanitizeHtml(html)
    if (body.value.innerHTML !== clean) body.value.innerHTML = clean
  }
)

function onInput(): void {
  if (!body.value || applying) return
  emit('update:modelValue', sanitizeHtml(body.value.innerHTML))
}

function exec(cmd: string, value?: string): void {
  body.value?.focus()
  document.execCommand(cmd, false, value)
  onInput()
}

async function addLink(): Promise<void> {
  const { value } = await ElMessageBox.prompt('链接地址（http/https）', '插入链接', {
    inputValue: 'https://',
    confirmButtonText: '插入',
    cancelButtonText: '取消'
  })
  const url = (value ?? '').trim()
  if (!url || !/^https?:\/\//i.test(url)) return
  exec('createLink', url)
}
</script>

<style scoped>
.rte {
  border: 1px solid var(--divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--fill-subtle);
  transition: border-color 0.2s ease;
}

.rte.focused,
.rte:focus-within {
  border-color: var(--accent);
}

.rte-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--divider);
  background: var(--fill-hover);
}

.rte-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 24px;
  padding: 0 5px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-2);
  font-size: 12px;
  cursor: pointer;
}

.rte-toolbar button:hover {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.ol-mark {
  font-size: 11px;
  font-weight: 600;
}

.rte-sep {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--divider);
}

.rte-body {
  min-height: 120px;
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-1);
  outline: none;
  word-break: break-word;
}

.rte-body:empty::before {
  content: attr(data-placeholder);
  color: var(--ink-3);
  pointer-events: none;
}

.rte-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}

.rte-body :deep(ul),
.rte-body :deep(ol) {
  padding-left: 1.5em;
  margin: 4px 0;
}

.rte-body :deep(pre) {
  background: var(--fill-hover);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
</style>

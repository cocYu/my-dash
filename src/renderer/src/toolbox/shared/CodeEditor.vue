<!-- 工具箱共用 CodeMirror 6 编辑器：受控 v-model，可选 json 高亮 / 只读 / 占位。
     basicSetup 等代码已随笔记模块打包，此处零新增主包体积。 -->
<template>
  <div ref="host" class="tool-editor"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: 'json' | 'text'
    readonly?: boolean
    placeholder?: string
    minHeight?: string
  }>(),
  { language: 'text', readonly: false, placeholder: '', minHeight: '160px' }
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
/** 编辑器自身输入触发的变更不走 watch（避免光标重置） */
let inner = false

function buildExtensions(): Extension[] {
  const ext = [
    basicSetup,
    EditorView.theme({
      '&': { minHeight: props.minHeight, backgroundColor: 'transparent' },
      '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' },
      '.cm-gutters': { backgroundColor: 'transparent' }
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        inner = true
        emit('update:modelValue', u.state.doc.toString())
      }
    })
  ]
  if (props.language === 'json') ext.push(json())
  if (props.readonly) ext.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
  return ext
}

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({ doc: props.modelValue, extensions: buildExtensions() }),
    parent: host.value!
  })
})

watch(
  () => props.modelValue,
  (val) => {
    if (inner) {
      inner = false
      return
    }
    if (view && val !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: val } })
    }
  }
)

watch(
  () => props.readonly,
  () => {
    // 只读切换较少见，直接重建视图最稳妥
    if (!view) return
    const doc = view.state.doc.toString()
    view.destroy()
    view = new EditorView({
      state: EditorState.create({ doc, extensions: buildExtensions() }),
      parent: host.value!
    })
  }
)

onBeforeUnmount(() => view?.destroy())
</script>

<style scoped>
.tool-editor {
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.tool-editor :deep(.cm-editor) {
  font-size: 12.5px;
}

.tool-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>

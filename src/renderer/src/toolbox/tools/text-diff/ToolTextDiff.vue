<!-- 文本比较：上方双输入，下方 @codemirror/merge 双栏差异视图（复用已打包的 CM6 运行时） -->
<template>
  <div class="td">
    <div class="inputs">
      <div class="pane">
        <div class="pane-title">原始文本</div>
        <CodeEditor v-model="left" min-height="110px" placeholder="原始文本…" class="fill" />
      </div>
      <div class="pane">
        <div class="pane-title">修改文本</div>
        <CodeEditor v-model="right" min-height="110px" placeholder="修改后的文本…" class="fill" />
      </div>
    </div>
    <div class="ops">
      <el-button size="small" type="primary" @click="updateDiff">比较</el-button>
      <el-switch v-model="live" size="small" active-text="自动比较" />
      <span class="hint">双栏视图可直接编辑；两侧一致的行自动折叠对齐</span>
    </div>
    <div ref="mergeHost" class="merge-host"></div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-text-diff' })
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import CodeEditor from '../../shared/CodeEditor.vue'

const left = ref('')
const right = ref('')
const live = ref(true)
const mergeHost = ref<HTMLElement | null>(null)
let mv: MergeView | null = null

const ro = [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping]

function render(): void {
  if (!mergeHost.value) return
  mv?.destroy()
  mergeHost.value.innerHTML = ''
  mv = new MergeView({
    a: { doc: left.value, extensions: ro },
    b: { doc: right.value, extensions: ro },
    parent: mergeHost.value,
    gutter: true
  })
}

function updateDiff(): void {
  render()
}

let timer: ReturnType<typeof setTimeout> | null = null
watch([left, right, live], () => {
  if (!live.value) return
  if (timer) clearTimeout(timer)
  // 300ms 防抖；过大文本不自动跑，点「比较」手动触发
  timer = setTimeout(() => {
    if (left.value.length + right.value.length > 500_000) return
    render()
  }, 300)
})

onMounted(render)
onBeforeUnmount(() => mv?.destroy())
</script>

<style scoped>
.td {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}

.inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* min-width: 0 防止长不可断行内容把 1fr 轨道撑宽挤扁邻列 */
  min-width: 0;
}

.pane-title {
  font-size: 12px;
  color: var(--ink-3);
}

.ops {
  display: flex;
  align-items: center;
  gap: 14px;
}

.hint {
  font-size: 12px;
  color: var(--ink-3);
}

.merge-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
}

.merge-host :deep(.cm-mergeView) {
  height: 100%;
  overflow: auto;
}

.merge-host :deep(.cm-editor) {
  font-size: 12.5px;
}
</style>

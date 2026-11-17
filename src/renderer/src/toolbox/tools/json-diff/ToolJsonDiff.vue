<!-- JSON 比较：两侧 JSON 解析后按键名递归排序规范化，再走 @codemirror/merge 双栏对比；
     一侧不合法时回退为原始文本 diff 并给出错误提示 -->
<template>
  <div class="jd">
    <div class="inputs">
      <div class="pane">
        <div class="pane-title">
          JSON A
          <el-tag v-if="errA" type="danger" size="small" effect="plain">✗ {{ errA }}</el-tag>
          <el-tag v-else-if="aText.trim()" type="success" size="small" effect="plain">✓</el-tag>
        </div>
        <CodeEditor v-model="aText" language="json" min-height="100px" placeholder='{"a":1}' class="fill" />
      </div>
      <div class="pane">
        <div class="pane-title">
          JSON B
          <el-tag v-if="errB" type="danger" size="small" effect="plain">✗ {{ errB }}</el-tag>
          <el-tag v-else-if="bText.trim()" type="success" size="small" effect="plain">✓</el-tag>
        </div>
        <CodeEditor v-model="bText" language="json" min-height="100px" placeholder='{"a":2}' class="fill" />
      </div>
    </div>
    <div class="ops">
      <el-button size="small" type="primary" @click="updateDiff">比较</el-button>
      <el-switch v-model="normalize" size="small" active-text="键名排序规范化" />
      <span class="hint">规范化后键序差异不再干扰，只看结构与值的差异</span>
    </div>
    <div ref="mergeHost" class="merge-host"></div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'tool-json-diff' })
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import CodeEditor from '../../shared/CodeEditor.vue'

const aText = ref('')
const bText = ref('')
const normalize = ref(true)
const errA = ref('')
const errB = ref('')
const mergeHost = ref<HTMLElement | null>(null)
let mv: MergeView | null = null

const ro = [EditorState.readOnly.of(true), EditorView.editable.of(false)]

/** 递归排序对象键并序列化，消除键序噪声；数组保持原序 */
function canonicalize(text: string): string {
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortValue)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([k1], [k2]) => k1.localeCompare(k2))
          .map(([k, val]) => [k, sortValue(val)])
      )
    }
    return v
  }
  return JSON.stringify(sortValue(JSON.parse(text)), null, 2)
}

function updateDiff(): void {
  if (!mergeHost.value) return
  let docA = aText.value
  let docB = bText.value
  errA.value = ''
  errB.value = ''
  if (normalize.value) {
    try {
      if (docA.trim()) docA = canonicalize(docA)
    } catch (err) {
      errA.value = err instanceof Error ? err.message.slice(0, 60) : 'JSON 不合法'
    }
    try {
      if (docB.trim()) docB = canonicalize(docB)
    } catch (err) {
      errB.value = err instanceof Error ? err.message.slice(0, 60) : 'JSON 不合法'
    }
  }
  mv?.destroy()
  mergeHost.value.innerHTML = ''
  mv = new MergeView({
    a: { doc: docA, extensions: ro },
    b: { doc: docB, extensions: ro },
    parent: mergeHost.value,
    gutter: true
  })
}

onMounted(updateDiff)
onBeforeUnmount(() => mv?.destroy())
</script>

<style scoped>
.jd {
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
}

.pane-title {
  font-size: 12px;
  color: var(--ink-3);
  display: flex;
  align-items: center;
  gap: 8px;
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

<template>
  <el-dialog
    v-model="visible"
    title="插件开发文档"
    width="82%"
    top="4vh"
    class="plugin-docs-dialog"
  >
    <div class="docs-layout">
      <aside class="docs-toc">
        <div class="toc-title">目录</div>
        <template v-if="toc.length">
          <div
            v-for="item in toc"
            :key="item.id"
            class="toc-item"
            :class="{ lv3: item.level === 3, active: item.id === activeId }"
            @click="jump(item.id)"
          >{{ item.text }}</div>
        </template>
        <div v-else class="toc-empty">…</div>
      </aside>
      <div ref="bodyRef" class="docs-body" @scroll.passive="onScroll">
        <div class="md-body" :class="mdClass" v-html="html" />
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { renderMarkdown } from '../markdown/renderer'
import { getMdThemeId, USER_THEME_PREFIX } from '../markdown/themes'
// Vite ?raw：文档以真实 .md 源文件随包内置（dev 与打包后均可读，无需 IPC）
import docsRaw from '../plugins/plugin-dev-docs.md?raw'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const html = renderMarkdown(docsRaw)

// 复用笔记渲染主题；用户自定义主题的 CSS 只在笔记编辑器内注入，这里回退内置主题
const mdClass = computed(() => {
  const id = getMdThemeId()
  return id.startsWith(USER_THEME_PREFIX) ? 'theme-github' : `theme-${id}`
})

interface TocItem {
  id: string
  text: string
  level: number
}

const toc = ref<TocItem[]>([])
const activeId = ref('')
const bodyRef = ref<HTMLElement>()

// 弹窗打开后再提取标题（el-dialog 懒渲染）；anchor 插件已为 h2/h3 生成 id
watch(visible, async (open) => {
  if (!open) return
  await nextTick()
  await nextTick()
  const root = bodyRef.value
  if (!root) return
  toc.value = Array.from(root.querySelectorAll('h2, h3')).map((h) => ({
    id: h.id,
    text: (h.textContent ?? '').trim(),
    level: h.tagName === 'H3' ? 3 : 2
  }))
  activeId.value = toc.value[0]?.id ?? ''
  root.scrollTop = 0
})

function jump(id: string): void {
  // slug 经 encodeURIComponent，属性选择器最稳
  bodyRef.value?.querySelector(`[id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 滚动高亮：取视口上方最近的标题
function onScroll(): void {
  const root = bodyRef.value
  if (!root || toc.value.length === 0) return
  const st = root.scrollTop + 28
  let current = toc.value[0]!.id
  for (const item of toc.value) {
    const top = root.querySelector<HTMLElement>(`[id="${item.id}"]`)?.offsetTop ?? 0
    if (top <= st) current = item.id
  }
  activeId.value = current
}
</script>

<style scoped>
.plugin-docs-dialog :deep(.el-dialog__body) {
  padding-top: 4px;
}

.docs-layout {
  display: flex;
  gap: 18px;
  height: 70vh;
}

.docs-toc {
  width: 208px;
  flex-shrink: 0;
  overflow-y: auto;
  padding-right: 12px;
  border-right: 1px solid var(--divider);
}

.toc-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 8px;
  padding-left: 8px;
}

.toc-empty {
  color: var(--ink-3);
  font-size: 12px;
  padding-left: 8px;
}

.toc-item {
  font-size: 13px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--ink-2);
  line-height: 1.4;
}

.toc-item:hover {
  background: var(--fill-hover);
}

.toc-item.lv3 {
  padding-left: 22px;
  font-size: 12px;
  color: var(--ink-3);
}

.toc-item.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.docs-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  position: relative; /* 标题 offsetTop 的包含块 */
  padding: 2px 8px 24px 2px;
}
</style>

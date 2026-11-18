<template>
  <!-- 复用笔记的 markdown-it 管线（html:false 保证安全），并覆盖主题变量以贴合气泡配色 -->
  <div class="chat-md md-body" v-html="html" @click="onClick" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../../markdown/renderer'

const props = defineProps<{ content: string }>()

const html = computed(() => renderMarkdown(props.content))

/** 外链交给系统浏览器，避免把整个应用导航走 */
function onClick(e: MouseEvent): void {
  const anchor = (e.target as HTMLElement | null)?.closest?.('a')
  if (!anchor) return
  e.preventDefault()
  const href = anchor.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) void window.api.shell.openExternal(href)
}
</script>

<style scoped>
.chat-md {
  /* 覆盖 .md-body 的默认主题变量，跟随应用明暗主题 */
  --md-bg: transparent;
  --md-fg: var(--ink-1);
  --md-muted: var(--ink-3);
  --md-border: var(--divider);
  --md-accent: var(--accent-strong);
  --md-code-bg: var(--fill-hover);
  --md-pre-bg: var(--fill-subtle);
  --md-quote-bg: var(--fill-subtle);

  font-size: 13px;
  line-height: 1.72;
  padding: 0;
}
.chat-md :deep(> :first-child) { margin-top: 0; }
.chat-md :deep(> :last-child) { margin-bottom: 0; }
.chat-md :deep(h1) { font-size: 1.35em; margin: 0.9em 0 0.5em; }
.chat-md :deep(h2) { font-size: 1.2em; margin: 0.85em 0 0.45em; }
.chat-md :deep(h3) { font-size: 1.08em; margin: 0.8em 0 0.4em; }
.chat-md :deep(p) { margin: 0.55em 0; }
.chat-md :deep(ul),
.chat-md :deep(ol) { padding-left: 1.35em; margin: 0.5em 0; }
.chat-md :deep(pre) {
  margin: 0.6em 0;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.55;
}
.chat-md :deep(code) { font-size: 12px; }
.chat-md :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 0.7em 0;
  font-size: 12px;
}
.chat-md :deep(blockquote) { margin: 0.6em 0; padding: 0.2em 0.9em; }
.chat-md :deep(img) { max-width: 100%; border-radius: 6px; }
.chat-md :deep(.katex-display) { overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
</style>

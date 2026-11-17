<template>
  <div class="md-preview">
    <div class="md-body" :class="themeClass" v-html="html" />
    <!-- 排版微调（字号/行高/段距/页宽/字体），位于主题之上 -->
    <component :is="'style'" v-text="tuneCss" />
    <!-- Typora 主题 CSS（已映射 #write/body → .md-body），位于排版之上 -->
    <component :is="'style'" v-text="typoraCss" />
    <!-- 用户自定义 CSS（以 .md-body 为根选择器书写），优先级最高 -->
    <component :is="'style'" v-text="customCss" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../../markdown/renderer'
import { typographyCss, type MdTypography } from '../../markdown/typography'
import { USER_THEME_PREFIX } from '../../markdown/themes'

const props = defineProps<{
  content: string
  theme: string
  customCss?: string
  typography?: MdTypography | null
  /** 已作用域化的 Typora 主题 CSS */
  typoraCss?: string
}>()

const html = computed(() => renderMarkdown(props.content))
const tuneCss = computed(() => (props.typography ? typographyCss(props.typography) : ''))
const themeClass = computed(() =>
  props.theme.startsWith(USER_THEME_PREFIX) ? 'theme-custom' : `theme-${props.theme}`
)
</script>

<style scoped>
.md-preview {
  height: 100%;
  overflow-y: auto;
  background: transparent;
}

.md-preview :deep(.md-body) {
  min-height: 100%;
  box-sizing: border-box;
  padding: 18px 22px;
}
</style>

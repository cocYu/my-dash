import { ref } from 'vue'

// 笔记左面板模式：进入默认「目录」；应用会话内切换后路由切回仍保留，重启回到默认
export const notesPanelMode = ref<'tree' | 'outline'>('tree')

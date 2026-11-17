import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/700.css'
import './styles/main.css'
import { MD_THEMES_CSS } from './markdown/md-themes-css'
import App from './App.vue'
import router from './router'
import { initHttp } from './api/http'
import { bootstrapPlugins } from './plugins/host'
import { initTheme } from './theme'

initTheme() // 挂载前恢复主题，避免闪屏

// Markdown 渲染主题样式（.md-body 作用域，全局只注入一次；导出 HTML 时复用同一份字符串）
{
  const style = document.createElement('style')
  style.textContent = MD_THEMES_CSS
  document.head.appendChild(style)
}

async function bootstrap(): Promise<void> {
  // 先从 preload 拿后端地址与 token，再加载插件，最后挂载应用
  await initHttp()
  try {
    await bootstrapPlugins()
  } catch (err) {
    // 插件加载失败不阻塞应用启动（单个插件的失败在 host 内部已隔离）
    console.error('[plugins] 插件系统初始化失败:', err)
  }

  const app = createApp(App)
  app.use(router)
  app.use(ElementPlus, { locale: zhCn })
  app.mount('#app')
}

bootstrap().catch((err) => {
  console.error('应用初始化失败:', err)
  document.getElementById('app')!.textContent = '应用初始化失败，请重启。'
})

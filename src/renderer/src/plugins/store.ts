// 插件注册表：侧边栏页面与仪表盘组件的响应式汇聚点。
// App.vue（侧边栏）与 DashboardView.vue（组件宿主）只消费这里，与插件加载逻辑解耦。
import { reactive, type Component } from 'vue'

export interface RegisteredPage {
  pluginId: string
  /** 完整路由路径（/p/<pluginId>/...） */
  path: string
  title: string
  icon?: Component
  component: Component
}

export interface RegisteredWidget {
  pluginId: string
  id: string
  title: string
  component: Component
}

export interface PluginError {
  id: string
  message: string
}

export const pluginRegistry = reactive({
  pages: [] as RegisteredPage[],
  widgets: [] as RegisteredWidget[],
  errors: [] as PluginError[]
})

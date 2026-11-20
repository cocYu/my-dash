// PluginHost：插件加载、上下文工厂与重载。
// 模型：渲染层主世界 ES 模块。插件通过 activate(ctx) 注册页面/组件/KV/受限 HTTP/事件。
// 已知边界：主世界插件可互访彼此数据，permissions 是声明式约束而非硬安全边界
// （分发不可信插件时演进为 iframe 沙箱，本文件 API 形态已按该方向收敛）。
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  resolveComponent,
  shallowRef,
  toRefs,
  watch,
  watchEffect,
  type Component
} from 'vue'
import {
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCheckboxGroup,
  ElCollapse,
  ElCollapseItem,
  ElDatePicker,
  ElDivider,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElProgress,
  ElRadio,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElOption,
  ElSlider,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  ElStatistic
} from 'element-plus'
import router from '../router'
import { request } from '../api/http'
import { pluginRegistry, type RegisteredPage, type RegisteredWidget } from './store'
import { clearPluginTools, toolboxRegistry } from '../toolbox/registry'

/** 插件可见的 Vue 常用 API（避免插件裸 import 'vue'——打包后无裸模块可解析） */
const vueApis = {
  h, ref, reactive, shallowRef, computed, watch, watchEffect, toRefs, defineComponent,
  onMounted, onUnmounted, onBeforeUnmount, onActivated, onDeactivated, nextTick, resolveComponent
}

/** 插件可见的 Element Plus 组件（渲染函数里直接作为标签对象使用） */
const uiComponents = {
  ElAlert, ElButton, ElCard, ElCheckbox, ElCheckboxGroup, ElCollapse, ElCollapseItem,
  ElDatePicker, ElDivider, ElDropdown, ElDropdownItem, ElDropdownMenu, ElDialog, ElEmpty,
  ElForm, ElFormItem, ElInput, ElInputNumber, ElRadio, ElRadioButton, ElRadioGroup,
  ElSelect, ElOption, ElSlider, ElStatistic, ElSwitch, ElTabPane, ElTabs,
  ElTable, ElTableColumn, ElTag, ElTooltip,
  message: ElMessage,
  messageBox: ElMessageBox
}

/** 权限 → HTTP 白名单（方法 + URL 前缀）。新增业务数据权限在这里扩表。 */
const PERMISSION_RULES: Record<string, { methods: string[]; prefix: string }> = {
  'notes:read': { methods: ['GET'], prefix: '/api/notes' }
}

interface PluginMeta {
  id: string
  name: string
  version: string
  permissions: string[]
}

interface PluginContext {
  meta: PluginMeta
  vue: typeof vueApis
  /** Element Plus 常用组件（已随主应用打包，插件渲染函数直接用） */
  ui: typeof uiComponents
  registerPage(page: { path: string; title: string; icon?: Component; component: Component }): void
  registerWidget(widget: { id: string; title: string; component: Component }): void
  /** 注册工具箱工具：id 自动加 <pluginId>: 前缀，与内置工具在工具箱页混排 */
  registerTool(tool: {
    id: string
    name: string
    icon?: Component
    category?: string
    description?: string
    component: Component
  }): void
  storage: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<boolean>
    remove(key: string): Promise<boolean>
    keys(): Promise<string[]>
  }
  http: {
    get<T = unknown>(url: string): Promise<T>
    post<T = unknown>(url: string, data?: unknown): Promise<T>
  }
  events: {
    on(name: string, cb: (payload?: unknown) => void): () => void
    emit(name: string, payload?: unknown): void
  }
  log(...args: unknown[]): void
}

// ---------------- 事件总线 ----------------
type Listener = (payload?: unknown) => void
const busListeners = new Map<string, Set<Listener>>()

const events = {
  on(name: string, cb: Listener): () => void {
    const set = busListeners.get(name) ?? new Set()
    set.add(cb)
    busListeners.set(name, set)
    return () => set.delete(cb)
  },
  emit(name: string, payload?: unknown): void {
    busListeners.get(name)?.forEach((cb) => cb(payload))
  }
}

// ---------------- 生命周期 ----------------
let bootId = Date.now().toString(36)
/** 已注册的路由名（重载时移除） */
const addedRouteNames: string[] = []

function hasPermission(meta: PluginMeta, permission: string): boolean {
  return meta.permissions.includes(permission)
}

function assertHttpPermission(meta: PluginMeta, method: string, url: string): void {
  const ok = meta.permissions.some((p) => {
    const rule = PERMISSION_RULES[p]
    return rule && rule.methods.includes(method) && url.startsWith(rule.prefix)
  })
  if (!ok) {
    throw new Error(`插件 ${meta.id} 未声明访问 ${method} ${url} 的权限（permissions: [${meta.permissions.join(', ')}]）`)
  }
}

function createContext(meta: PluginMeta): PluginContext {
  return {
    meta,
    vue: vueApis,
    ui: uiComponents,
    registerPage(page) {
      const routePath = `/p/${meta.id}${page.path.startsWith('/') ? page.path : `/${page.path}`}`
      const name = `plugin-${meta.id}-${routePath}`
      if (addedRouteNames.includes(name)) {
        throw new Error(`页面路径重复: ${routePath}`)
      }
      router.addRoute({ path: routePath, name, component: page.component })
      addedRouteNames.push(name)
      const entry: RegisteredPage = { pluginId: meta.id, path: routePath, title: page.title, icon: page.icon, component: page.component }
      pluginRegistry.pages.push(entry)
    },
    registerWidget(widget) {
      const entry: RegisteredWidget = {
        pluginId: meta.id,
        id: `${meta.id}:${widget.id}`,
        title: widget.title,
        component: widget.component
      }
      pluginRegistry.widgets.push(entry)
    },
    registerTool(tool) {
      const id = `${meta.id}:${tool.id}`
      if (toolboxRegistry.tools.some((t) => t.id === id)) {
        throw new Error(`工具重复注册: ${id}`)
      }
      toolboxRegistry.tools.push({
        id,
        name: tool.name,
        icon: tool.icon,
        category: tool.category ?? '其他',
        description: tool.description,
        component: tool.component,
        fromPlugin: true
      })
    },
    storage: {
      get: <T,>(key: string) => window.api.plugins.kv(meta.id, 'get', key) as Promise<T | null>,
      set: (key, value) => window.api.plugins.kv(meta.id, 'set', key, value) as Promise<boolean>,
      remove: (key) => window.api.plugins.kv(meta.id, 'remove', key) as Promise<boolean>,
      keys: () => window.api.plugins.kv(meta.id, 'keys') as Promise<string[]>
    },
    http: {
      get: async <T,>(url: string) => {
        assertHttpPermission(meta, 'GET', url)
        return request<T>({ url, method: 'GET' })
      },
      post: async <T,>(url: string, data?: unknown) => {
        assertHttpPermission(meta, 'POST', url)
        return request<T>({ url, method: 'POST', data })
      }
    },
    events,
    log: (...args: unknown[]) => console.log(`[plugin:${meta.id}]`, ...args)
  }
}

/** 加载全部启用的插件。单插件失败互相隔离并记录到管理页。 */
export async function bootstrapPlugins(): Promise<void> {
  const records = (await window.api.plugins.list()) as Array<{
    id: string
    name: string
    version: string
    main: string
    permissions: string[]
    enabled: boolean
    error?: string
  }>

  pluginRegistry.errors = records.filter((r) => r.error).map((r) => ({ id: r.id, message: r.error ?? '未知错误' }))

  for (const rec of records) {
    if (rec.error || !rec.enabled) continue
    try {
      // 缓存穿透参数：重载时换 bootId，强制重新拉取模块
      const url = `plugin://${rec.id}/${rec.main}?t=${bootId}`
      const mod = (await import(/* @vite-ignore */ url)) as { activate?: (ctx: PluginContext) => void | Promise<void> }
      if (typeof mod.activate !== 'function') throw new Error('入口缺少 activate 导出')
      await mod.activate(
        createContext({ id: rec.id, name: rec.name, version: rec.version, permissions: rec.permissions })
      )
      console.log(`[plugins] 已加载: ${rec.id}@${rec.version}`)
    } catch (err) {
      console.error(`[plugins] 加载失败: ${rec.id}`, err)
      pluginRegistry.errors.push({ id: rec.id, message: err instanceof Error ? err.message : String(err) })
    }
  }
}

/** 重载全部插件：清空注册表与路由后重新加载（管理页"重载"按钮）。 */
export async function reloadPlugins(): Promise<void> {
  for (const name of addedRouteNames.splice(0)) {
    if (router.hasRoute(name)) router.removeRoute(name)
  }
  pluginRegistry.pages = []
  pluginRegistry.widgets = []
  pluginRegistry.errors = []
  clearPluginTools()
  bootId = Date.now().toString(36)
  await bootstrapPlugins()
}

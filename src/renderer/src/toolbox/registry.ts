// 工具箱注册表：内置工具与插件工具的统一契约。
// 内置工具用 defineAsyncComponent 懒加载——未打开的工具零代码执行；
// 插件工具由 PluginHost 经 ctx.registerTool 推入同一注册表，与内置混排。
// 内存有界：ToolboxView 工作区对工具组件套 keep-alive :max=6（LRU 淘汰）。
import { defineAsyncComponent, reactive, type Component } from 'vue'
import {
  Clock,
  Collection,
  Connection,
  CreditCard,
  Files,
  Lock,
  MagicStick,
  Promotion,
  Search,
  Switch,
  Timer
} from '@element-plus/icons-vue'

export interface ToolMeta {
  /** 全局唯一 id：内置为纯 id（如 json-formatter），插件为 <pluginId>:<toolId> */
  id: string
  name: string
  icon?: Component
  /** 分类（侧栏分组展示），插件工具可传任意字符串 */
  category: string
  description?: string
  component: Component
  /** true = 插件注册（reloadPlugins 时随注册表清空） */
  fromPlugin?: boolean
}

export const toolboxRegistry = reactive<{ tools: ToolMeta[] }>({
  tools: [
    {
      id: 'json-formatter',
      name: 'JSON 美化',
      icon: MagicStick,
      category: 'JSON',
      description: '格式化 / 压缩 / 校验 JSON',
      component: defineAsyncComponent(() => import('./tools/json-formatter/ToolJsonFormatter.vue'))
    },
    {
      id: 'json-diff',
      name: 'JSON 比较',
      icon: Files,
      category: 'JSON',
      description: '两侧 JSON 键排序规范化后对比差异',
      component: defineAsyncComponent(() => import('./tools/json-diff/ToolJsonDiff.vue'))
    },
    {
      id: 'text-diff',
      name: '文本比较',
      icon: Files,
      category: '文本',
      description: '双栏文本差异对比',
      component: defineAsyncComponent(() => import('./tools/text-diff/ToolTextDiff.vue'))
    },
    {
      id: 'regex-tester',
      name: '正则测试',
      icon: Search,
      category: '文本',
      description: '实时匹配高亮与分组提取',
      component: defineAsyncComponent(() => import('./tools/regex-tester/ToolRegexTester.vue'))
    },
    {
      id: 'postman',
      name: 'Postman',
      icon: Promotion,
      category: '网络',
      description: '简易 HTTP 请求调试（经本机后端代理）',
      component: defineAsyncComponent(() => import('./tools/postman/ToolPostman.vue'))
    },
    {
      id: 'websocket-tester',
      name: 'WebSocket',
      icon: Connection,
      category: '网络',
      description: 'WS/WSS 连接与消息收发测试',
      component: defineAsyncComponent(() => import('./tools/websocket-tester/ToolWsTester.vue'))
    },
    {
      id: 'timestamp',
      name: '时间戳',
      icon: Clock,
      category: '时间',
      description: '时间戳与日期双向转换',
      component: defineAsyncComponent(() => import('./tools/timestamp/ToolTimestamp.vue'))
    },
    {
      id: 'cron',
      name: 'Cron 表达式',
      icon: Timer,
      category: '时间',
      description: '解析表达式并预览后续执行时间',
      component: defineAsyncComponent(() => import('./tools/cron/ToolCron.vue'))
    },
    {
      id: 'codec',
      name: '编解码',
      icon: Switch,
      category: '编码加密',
      description: 'URL / Base64 互转（UTF-8 安全）',
      component: defineAsyncComponent(() => import('./tools/codec/ToolCodec.vue'))
    },
    {
      id: 'hash',
      name: '哈希计算',
      icon: Lock,
      category: '编码加密',
      description: 'MD5 / SHA-1 / SHA-256（文本与文件）',
      component: defineAsyncComponent(() => import('./tools/hash/ToolHash.vue'))
    },
    {
      id: 'uuid',
      name: 'UUID 生成',
      icon: CreditCard,
      category: '生成',
      description: '批量生成 UUID v4',
      component: defineAsyncComponent(() => import('./tools/uuid/ToolUuid.vue'))
    }
  ]
})

/** 卸载/重载插件时清掉插件注册的工具，内置工具保留 */
export function clearPluginTools(): void {
  toolboxRegistry.tools = toolboxRegistry.tools.filter((t) => !t.fromPlugin)
}

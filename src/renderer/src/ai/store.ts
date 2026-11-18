// AI 供应商渲染层共享状态（单例）：列表加载、保存、拉取模型。
// 两个面板（供应商管理 / AI 生图）共用同一份列表，避免各拉各的。
import { ref } from 'vue'
import type { AiModel, AiProvider } from '../../../types/ai'
import { toPlain } from './plain'

const providers = ref<AiProvider[]>([])
const loading = ref(false)
let loaded = false

/** preload 未加载新版（旧进程 / 普通浏览器打开）时给出可读提示 */
function aiApi(): NonNullable<Window['api']['ai']> {
  const ai = window.api?.ai
  if (!ai) {
    throw new Error('AI 接口未就绪：请完全退出应用后重新启动（旧版进程未加载 AI 模块）')
  }
  return ai
}

async function reload(): Promise<void> {
  loading.value = true
  try {
    providers.value = await aiApi().providers.list()
    loaded = true
  } finally {
    loading.value = false
  }
}

/** 首次进入时加载一次；其余场景手动 reload */
async function ensureLoaded(): Promise<void> {
  if (!loaded) await reload()
}

/**
 * 保存完整列表（供应商管理面板编辑后调用），返回服务端视图。
 * 关键：list 来自 reactive 数组（[...providers.value]），元素是 Vue Proxy，
 * Electron IPC 用结构化克隆无法传输 Proxy，必须先在边界转成纯 JSON 对象。
 */
async function save(list: AiProvider[]): Promise<AiProvider[]> {
  const next = await aiApi().providers.save(toPlain(list))
  providers.value = next
  return next
}

/** 拉模型并回写缓存到本地列表 */
async function fetchModels(id: string): Promise<AiModel[]> {
  const models = await aiApi().providers.fetchModels(id)
  const p = providers.value.find((x) => x.id === id)
  if (p) {
    p.models = models
    p.modelsFetchedAt = new Date().toISOString()
  }
  return models
}

function find(id: string): AiProvider | undefined {
  return providers.value.find((x) => x.id === id)
}

function enabledProviders(): AiProvider[] {
  return providers.value.filter((p) => p.enabled)
}

export function useAiProviders() {
  return { providers, loading, reload, ensureLoaded, save, fetchModels, find, enabledProviders }
}

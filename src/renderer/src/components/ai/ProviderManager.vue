<template>
  <div class="provider-manager">
    <div class="section-head">
      <div>
        <div class="row-title">模型供应商</div>
        <div class="row-desc">
          配置 OpenAI / Anthropic 等兼容接口。协议自动匹配：chat（OpenAI Chat Completions）、responses（OpenAI Responses）、messages（Anthropic Messages）。
        </div>
      </div>
      <el-button type="primary" size="small" @click="openEditor(null)">
        <el-icon><Plus /></el-icon>&nbsp;新增供应商
      </el-button>
    </div>

    <div class="sync-note">
      <el-icon><InfoFilled /></el-icon>
      <span>
        供应商配置（含 API Key）会随「数据同步」备份到云端：本地加密存储，备份包内为明文（与数据库快照同一信任级别），换机还原时按新设备重新加密。请妥善保管云同步账号。
      </span>
    </div>

    <div v-loading="loading" class="provider-list">
      <el-empty v-if="!providers.length && !loading" description="还没有供应商，点右上角新增" :image-size="70" />

      <div v-for="p in providers" :key="p.id" class="provider-card">
        <div class="pc-head">
          <div class="pc-title">
            <span class="pc-name">{{ p.name }}</span>
            <el-tag size="small" :type="protocolTagType(p.protocol)" effect="plain">{{ protocolLabel(p.protocol) }}</el-tag>
            <el-tag v-if="!p.enabled" size="small" type="info" effect="plain">已停用</el-tag>
          </div>
          <div class="pc-actions">
            <el-switch :model-value="p.enabled" size="small" @change="(v: boolean | string | number) => toggleEnabled(p, Boolean(v))" />
            <el-button link size="small" @click="openEditor(p)">编辑</el-button>
            <el-button link size="small" type="primary" :loading="modelLoading[p.id]" @click="doFetchModels(p)">
              拉取模型
            </el-button>
            <el-button link size="small" :loading="testLoading[p.id]" @click="doTest(p)">测试</el-button>
            <el-button link size="small" type="danger" @click="doRemove(p)">删除</el-button>
          </div>
        </div>

        <div class="pc-info-grid">
          <div class="pc-meta">
            <span class="k">接口地址</span>
            <span class="v mono">{{ p.baseUrl || '—' }}</span>
          </div>
          <div class="pc-meta">
            <span class="k">API Key</span>
            <span class="v">{{ p.hasApiKey ? '已配置（加密存储）' : '未配置' }}</span>
          </div>
          <div class="pc-meta">
            <span class="k">最近调用</span>
            <span class="v">{{ formatLastCall(lastCalls[p.id]) }}</span>
          </div>
          <div class="pc-meta quota-meta">
            <span class="k">额度</span>
            <span class="v">
              <template v-if="quotaLoading[p.id]">
                <span class="muted">查询中…</span>
              </template>
              <template v-else-if="quotas[p.id]">
                <template v-if="quotas[p.id].limit !== null || quotas[p.id].used !== null">
                  <span class="quota-strong">{{ formatMoney(quotas[p.id].remaining, quotas[p.id].currency) }}</span>
                  <span class="quota-sub">
                    / 上限 {{ formatMoney(quotas[p.id].limit, quotas[p.id].currency) }}
                    · 已用 {{ formatMoney(quotas[p.id].used, quotas[p.id].currency) }}
                  </span>
                </template>
                <span v-else class="muted">
                  {{ quotas[p.id].currency === '未知' ? '仅探测到货币信息' : `货币 ${quotas[p.id].currency}` }}
                </span>
                <span class="quota-src" :title="quotas[p.id].source">{{ quotas[p.id].source }}</span>
                <span class="quota-time">· {{ formatTime(quotas[p.id].checkedAt) }}</span>
              </template>
              <template v-else-if="quotaErrors[p.id]">
                <span class="muted" :title="quotaErrors[p.id]">不支持额度查询</span>
              </template>
              <template v-else>
                <span class="muted">未查询</span>
              </template>
              <el-button link size="small" class="quota-refresh" :loading="quotaLoading[p.id]" @click="refreshQuota(p)">
                刷新
              </el-button>
            </span>
          </div>
        </div>

        <div class="pc-meta model-row">
          <span class="k">可用模型</span>
          <span class="v">
            <template v-if="visibleModels(p).length">
              <el-tag
                v-for="m in visibleModels(p).slice(0, 8)"
                :key="m.id"
                size="small"
                effect="plain"
                class="model-tag"
                :title="m.id"
              >{{ m.name || m.id }}</el-tag>
              <span v-if="visibleModels(p).length > 8" class="more">+{{ visibleModels(p).length - 8 }}</span>
              <span v-if="p.visibleModelIds && p.visibleModelIds.length < p.models.length" class="filtered-note">
                （已筛选 {{ p.visibleModelIds.length }}/{{ p.models.length }}，点「选择模型」调整）
              </span>
              <span v-if="p.modelsFetchedAt" class="fetched-at">更新于 {{ formatTime(p.modelsFetchedAt) }}</span>
            </template>
            <span v-else class="muted">尚未拉取，点「拉取模型」获取</span>
            <el-button v-if="p.models.length" link size="small" class="model-select-btn" @click="openModelPicker(p)">
              选择模型
            </el-button>
          </span>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editorOpen" :title="editing ? '编辑供应商' : '新增供应商'" width="540px" :close-on-click-modal="false">
      <el-form :model="form" label-width="92px" class="editor-form">
        <el-form-item label="预设">
          <el-select v-model="form.preset" placeholder="选择预设后自动填入地址与协议" @change="onPresetChange">
            <el-option v-for="opt in presets" :key="opt.id" :value="opt.id" :label="opt.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如：OpenAI / 我的中转站" />
        </el-form-item>
        <el-form-item label="协议">
          <el-select v-model="form.protocol">
            <el-option value="chat" label="chat — OpenAI Chat Completions" />
            <el-option value="responses" label="responses — OpenAI Responses API" />
            <el-option value="messages" label="messages — Anthropic Messages API" />
          </el-select>
        </el-form-item>
        <el-form-item label="接口地址">
          <el-input v-model="form.baseUrl" placeholder="https://api.openai.com（根地址，自动补 /v1）" />
          <div class="form-tip">填写根地址即可，网关自动补版本路径；已带 /v1 则不重复。</div>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password :placeholder="form.hasApiKey ? '已配置，留空表示不修改' : ' sk-...'" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 模型选择弹窗 -->
    <el-dialog v-model="pickerOpen" :title="`选择展示模型 — ${pickerProvider?.name || ''}`" width="560px">
      <div class="picker-toolbar">
        <el-button size="small" @click="selectAllModels">全选</el-button>
        <el-button size="small" @click="selectNoModels">清空</el-button>
        <span class="picker-count">已选 {{ pickerSelected.length }} / {{ pickerProvider?.models.length || 0 }}</span>
      </div>
      <div class="picker-tip">勾选的模型会出现在「AI 生图」和提示词增强的模型下拉框中；不勾选表示全部展示。</div>
      <el-checkbox-group v-model="pickerSelected" class="picker-list">
        <el-checkbox v-for="m in pickerProvider?.models || []" :key="m.id" :value="m.id" class="picker-item">
          <span class="picker-model">{{ m.name || m.id }}</span>
          <span v-if="m.name && m.name !== m.id" class="picker-id mono">{{ m.id }}</span>
        </el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="pickerOpen = false">取消</el-button>
        <el-button type="primary" :loading="pickerSaving" @click="saveModelSelection">保存选择</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled, Plus } from '@element-plus/icons-vue'
import type {
  AiModel,
  AiProvider,
  AiProtocol,
  AiQuotaInfo,
  AiVendorPreset
} from '../../../../types/ai'
import { AI_PRESETS } from '../../../../types/ai'
import { useAiProviders } from '../../ai/store'

const { providers, loading, save, fetchModels, reload } = useAiProviders()

const presets = AI_PRESETS
const modelLoading = reactive<Record<string, boolean>>({})
const testLoading = reactive<Record<string, boolean>>({})
const saving = ref(false)
const editorOpen = ref(false)
const editing = ref<AiProvider | null>(null)

/** 额度：5 分钟定时刷新，也支持手动 */
const quotas = reactive<Record<string, AiQuotaInfo>>({})
const quotaErrors = reactive<Record<string, string>>({})
const quotaLoading = reactive<Record<string, boolean>>({})
const lastCalls = reactive<Record<string, string | null>>({})
let quotaTimer: ReturnType<typeof setInterval> | null = null
const QUOTA_INTERVAL = 5 * 60 * 1000

/** 模型选择 */
const pickerOpen = ref(false)
const pickerProvider = ref<AiProvider | null>(null)
const pickerSelected = ref<string[]>([])
const pickerSaving = ref(false)

interface FormState {
  id: string
  name: string
  preset: AiVendorPreset
  protocol: AiProtocol
  baseUrl: string
  apiKey: string
  enabled: boolean
  hasApiKey: boolean
  models: AiModel[]
  visibleModelIds?: string[]
  createdAt: string
}

const form = ref<FormState>({
  id: '', name: '', preset: 'custom', protocol: 'chat', baseUrl: '', apiKey: '', enabled: true,
  hasApiKey: false, models: [], createdAt: ''
})

function openEditor(p: AiProvider | null): void {
  editing.value = p
  if (p) {
    Object.assign(form.value, {
      id: p.id, name: p.name, preset: p.preset, protocol: p.protocol, baseUrl: p.baseUrl,
      apiKey: '', enabled: p.enabled, hasApiKey: Boolean(p.hasApiKey), models: p.models,
      visibleModelIds: p.visibleModelIds, createdAt: p.createdAt
    })
  } else {
    Object.assign(form.value, {
      id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: '', preset: 'custom', protocol: 'chat', baseUrl: '', apiKey: '', enabled: true,
      hasApiKey: false, models: [], createdAt: new Date().toISOString()
    })
  }
  editorOpen.value = true
}

function onPresetChange(id: AiVendorPreset): void {
  const opt = presets.find((x) => x.id === id)
  if (!opt) return
  form.value.protocol = opt.protocol
  if (id !== 'custom') {
    form.value.baseUrl = opt.baseUrl
    if (!form.value.name || isPresetName(form.value.name)) form.value.name = opt.name
  }
}

function isPresetName(name: string): boolean {
  return presets.some((x) => x.name === name)
}

async function doSave(): Promise<void> {
  if (!form.value.name.trim()) { ElMessage.warning('请填写名称'); return }
  if (!form.value.baseUrl.trim()) { ElMessage.warning('请填写接口地址'); return }
  saving.value = true
  try {
    const item: AiProvider = {
      id: form.value.id, name: form.value.name.trim(), preset: form.value.preset, protocol: form.value.protocol,
      baseUrl: form.value.baseUrl.trim(), apiKey: form.value.apiKey, enabled: form.value.enabled,
      models: form.value.models, createdAt: form.value.createdAt,
      ...(form.value.visibleModelIds ? { visibleModelIds: form.value.visibleModelIds } : {}),
      ...(form.value.hasApiKey ? { hasApiKey: true } : {})
    }
    const next = [...providers.value]
    const idx = next.findIndex((x) => x.id === item.id)
    if (idx >= 0) next[idx] = item
    else next.push(item)
    await save(next)
    editorOpen.value = false
    ElMessage.success('供应商已保存')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(p: AiProvider, enabled: boolean): Promise<void> {
  const next = providers.value.map((x) => (x.id === p.id ? { ...x, enabled } : x))
  try {
    await save(next)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
    await reload()
  }
}

async function doFetchModels(p: AiProvider): Promise<void> {
  modelLoading[p.id] = true
  try {
    const models = await fetchModels(p.id)
    // 拉取成功后弹选择框，让用户勾选要展示的模型
    pickerProvider.value = providers.value.find((x) => x.id === p.id) ?? p
    const ids = pickerProvider.value?.visibleModelIds
    pickerSelected.value = Array.isArray(ids) ? [...ids] : models.map((m) => m.id)
    pickerOpen.value = true
    ElMessage.success(`已拉取 ${models.length} 个模型，请勾选要展示的`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '拉取模型失败')
  } finally {
    modelLoading[p.id] = false
  }
}

function openModelPicker(p: AiProvider): void {
  pickerProvider.value = p
  const ids = p.visibleModelIds
  pickerSelected.value = Array.isArray(ids) ? [...ids] : p.models.map((m) => m.id)
  pickerOpen.value = true
}

function selectAllModels(): void {
  pickerSelected.value = (pickerProvider.value?.models ?? []).map((m) => m.id)
}

function selectNoModels(): void {
  pickerSelected.value = []
}

async function saveModelSelection(): Promise<void> {
  const p = pickerProvider.value
  if (!p) return
  pickerSaving.value = true
  try {
    const next = providers.value.map((x) =>
      x.id === p.id ? { ...x, visibleModelIds: [...pickerSelected.value] } : x
    )
    await save(next)
    pickerOpen.value = false
    ElMessage.success(`已保存：展示 ${pickerSelected.value.length} 个模型`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存模型选择失败')
  } finally {
    pickerSaving.value = false
  }
}

/** 按用户勾选过滤展示的模型；未配置 visibleModelIds 时全部展示 */
function visibleModels(p: AiProvider): AiModel[] {
  if (!Array.isArray(p.visibleModelIds)) return p.models
  const ids = new Set(p.visibleModelIds)
  return p.models.filter((m) => ids.has(m.id))
}

async function refreshQuota(p: AiProvider, silent = false): Promise<void> {
  if (quotaLoading[p.id]) return
  quotaLoading[p.id] = true
  try {
    quotas[p.id] = await window.api.ai.quota(p.id)
    delete quotaErrors[p.id]
  } catch (err) {
    const msg = err instanceof Error ? err.message : '额度查询失败'
    quotaErrors[p.id] = msg
    if (!silent) ElMessage.warning(msg)
  } finally {
    quotaLoading[p.id] = false
  }
}

async function loadQuotasAndLastCalls(silent = true): Promise<void> {
  for (const p of providers.value) {
    if (!p.enabled) continue
    try {
      lastCalls[p.id] = await window.api.ai.lastCall(p.id)
    } catch {
      lastCalls[p.id] = null
    }
    void refreshQuota(p, silent)
  }
}

onMounted(() => {
  void loadQuotasAndLastCalls()
  quotaTimer = setInterval(() => void loadQuotasAndLastCalls(), QUOTA_INTERVAL)
})

// 供应商列表在 AIWorkbenchView 里异步加载，首次就绪时立即刷新额度，不用等 5 分钟
watch(
  () => providers.value.filter((p) => p.enabled).map((p) => p.id).join(','),
  () => void loadQuotasAndLastCalls()
)

onBeforeUnmount(() => {
  if (quotaTimer) clearInterval(quotaTimer)
})

async function doTest(p: AiProvider): Promise<void> {
  testLoading[p.id] = true
  try {
    const r = await window.api.ai.providers.test(p.id)
    ElMessage.success(`连接正常，可用 ${r.models} 个模型`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '连接失败')
  } finally {
    testLoading[p.id] = false
  }
}

async function doRemove(p: AiProvider): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除「${p.name}」？`, '删除供应商', { type: 'warning' })
  } catch {
    return
  }
  const next = providers.value.filter((x) => x.id !== p.id)
  try {
    await save(next)
    ElMessage.success('已删除')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

function protocolLabel(p: AiProtocol): string {
  return p === 'chat' ? 'chat' : p === 'responses' ? 'responses' : 'messages'
}
function protocolTagType(p: AiProtocol): 'success' | 'warning' | 'primary' {
  return p === 'chat' ? 'success' : p === 'responses' ? 'warning' : 'primary'
}
function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function formatLastCall(iso: string | null | undefined): string {
  if (!iso) return '暂无调用记录'
  return formatTime(iso)
}
function formatMoney(v: number | null, currency: string): string {
  if (v === null || v === undefined) return '—'
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  const n = v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4)
  return `${symbol}${n}`
}
</script>

<style scoped>
.provider-manager {
  width: 100%;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.row-title { font-size: 14px; font-weight: 600; }
.row-desc { margin-top: 4px; font-size: 12px; color: var(--ink-3); max-width: 620px; line-height: 1.5; }

.sync-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 0;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-2);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
}
.sync-note .el-icon { flex-shrink: 0; margin-top: 2px; color: var(--accent-strong); }

.provider-list { display: flex; flex-direction: column; gap: 12px; }

.provider-card {
  padding: 14px 16px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: var(--fill-subtle);
}
.pc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--divider);
}
.pc-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pc-name { font-size: 14px; font-weight: 600; }
.pc-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.pc-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
.pc-meta {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-top: 8px;
  font-size: 12px;
}
.pc-meta .k { width: 64px; flex-shrink: 0; color: var(--ink-3); }
.pc-meta .v { flex: 1; min-width: 0; word-break: break-all; }
.mono { font-family: 'Outfit', monospace; }
.muted { color: var(--ink-3); }
.model-tag { margin: 0 5px 4px 0; }
.more { color: var(--ink-3); }
.fetched-at { margin-left: 8px; color: var(--ink-3); font-size: 11px; }
.filtered-note { margin-left: 6px; font-size: 11px; color: var(--accent-strong); }
.model-select-btn { margin-left: 6px; }

.quota-strong { font-weight: 600; color: var(--ink-1); }
.quota-sub { margin-left: 6px; font-size: 11px; color: var(--ink-3); }
.quota-src { margin-left: 6px; font-size: 11px; color: var(--ink-3); }
.quota-time { margin-left: 4px; font-size: 11px; color: var(--ink-3); }
.quota-refresh { margin-left: 6px; }
.model-row { padding-bottom: 4px; }

.editor-form .form-tip { font-size: 11px; color: var(--ink-3); line-height: 1.4; margin-top: 2px; }

.picker-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.picker-count { margin-left: auto; font-size: 12px; color: var(--ink-2); }
.picker-tip { font-size: 11px; color: var(--ink-3); line-height: 1.5; margin-bottom: 10px; }
.picker-list {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;
  max-height: 340px; overflow-y: auto; padding: 4px;
  border: 1px solid var(--divider); border-radius: var(--radius-sm);
}
.picker-item { display: flex; align-items: center; gap: 6px; margin-right: 0; }
.picker-model { font-size: 12px; }
.picker-id { font-size: 10px; color: var(--ink-3); }
</style>

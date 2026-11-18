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

        <div class="pc-meta">
          <span class="k">接口地址</span>
          <span class="v mono">{{ p.baseUrl || '—' }}</span>
        </div>
        <div class="pc-meta">
          <span class="k">API Key</span>
          <span class="v">{{ p.hasApiKey ? '已配置（加密存储）' : '未配置' }}</span>
        </div>
        <div class="pc-meta">
          <span class="k">可用模型</span>
          <span class="v">
            <template v-if="p.models.length">
              <el-tag
                v-for="m in p.models.slice(0, 8)"
                :key="m.id"
                size="small"
                effect="plain"
                class="model-tag"
                :title="m.id"
              >{{ m.name || m.id }}</el-tag>
              <span v-if="p.models.length > 8" class="more">+{{ p.models.length - 8 }}</span>
              <span v-if="p.modelsFetchedAt" class="fetched-at">更新于 {{ formatTime(p.modelsFetchedAt) }}</span>
            </template>
            <span v-else class="muted">尚未拉取，点「拉取模型」获取</span>
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
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled, Plus } from '@element-plus/icons-vue'
import { AI_PRESETS, type AiModel, type AiProvider, type AiProtocol, type AiVendorPreset } from '../../../../types/ai'
import { useAiProviders } from '../../ai/store'

const { providers, loading, save, fetchModels, reload } = useAiProviders()

const presets = AI_PRESETS
const modelLoading = reactive<Record<string, boolean>>({})
const testLoading = reactive<Record<string, boolean>>({})
const saving = ref(false)
const editorOpen = ref(false)
const editing = ref<AiProvider | null>(null)

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
      apiKey: '', enabled: p.enabled, hasApiKey: Boolean(p.hasApiKey), models: p.models, createdAt: p.createdAt
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
    ElMessage.success(`已拉取 ${models.length} 个模型`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '拉取模型失败')
  } finally {
    modelLoading[p.id] = false
  }
}

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

.editor-form .form-tip { font-size: 11px; color: var(--ink-3); line-height: 1.4; margin-top: 2px; }
</style>

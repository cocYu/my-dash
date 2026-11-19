<template>
  <el-dialog
    :model-value="visible"
    :title="agent ? '编辑助手' : '新建助手'"
    width="620px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <el-form label-width="92px" class="agent-form">
      <el-form-item label="头像">
        <div class="emoji-row">
          <el-input v-model="form.emoji" class="emoji-input" maxlength="4" placeholder="🤖" />
          <div class="emoji-presets">
            <span
              v-for="e in EMOJI_PRESETS"
              :key="e"
              class="emoji-chip"
              :class="{ active: form.emoji === e }"
              @click="form.emoji = e"
            >{{ e }}</span>
          </div>
        </div>
      </el-form-item>
      <el-form-item label="名称">
        <el-input v-model="form.name" placeholder="如：笔记管家 / 写作助手" maxlength="24" show-word-limit />
      </el-form-item>
      <el-form-item label="简介">
        <el-input v-model="form.description" placeholder="一句话说明它能做什么（显示在列表和空会话里）" maxlength="60" />
      </el-form-item>
      <el-form-item label="系统提示词">
        <el-input
          v-model="form.systemPrompt"
          type="textarea"
          :rows="7"
          placeholder="定义它的身份、语气、能力边界。例如：你是一位熟悉我全部笔记的助理，回答时优先引用笔记原文…"
        />
        <div class="form-tip">这是 Agent 的核心。描述越具体，输出越稳定。</div>
      </el-form-item>
      <el-form-item label="供应商">
        <el-select v-model="form.providerId" placeholder="选择供应商" @change="onProviderChange">
          <el-option v-for="p in enabledProviders()" :key="p.id" :value="p.id" :label="p.name" />
        </el-select>
      </el-form-item>
      <el-form-item label="模型">
        <el-select
          v-model="form.model"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入模型名"
          :disabled="!form.providerId"
        >
          <el-option v-for="m in modelsOfProvider" :key="m.id" :value="m.id" :label="m.name || m.id" />
        </el-select>
        <div v-if="form.providerId && !modelsOfProvider.length" class="form-tip">
          该供应商未缓存模型，可直接输入模型名，或到「供应商管理」拉取。
        </div>
      </el-form-item>
      <el-form-item label="温度">
        <div class="slider-row">
          <el-slider v-model="form.temperature" :min="0" :max="2" :step="0.1" show-input :show-input-controls="false" input-size="small" />
        </div>
        <div class="form-tip">越低越稳定严谨，越高越发散。写作 0.7~0.9，事实问答 0.2~0.4。</div>
      </el-form-item>
      <el-form-item label="最大输出">
        <el-input-number v-model="form.maxTokens" :min="256" :max="32768" :step="256" size="small" />
        <span class="inline-tip">tokens</span>
      </el-form-item>
      <el-form-item label="上下文窗口">
        <el-input-number v-model="form.contextWindow" :min="8000" :max="2000000" :step="16000" size="small" />
        <span class="inline-tip">tokens · 超出预算后自动压缩早期对话</span>
      </el-form-item>
      <el-form-item label="默认思考">
        <el-select v-model="form.reasoningEffort" size="small" class="effort-select">
          <el-option value="off" label="默认（不传参数）" />
          <el-option value="low" label="低" />
          <el-option value="medium" label="中" />
          <el-option value="high" label="高" />
        </el-select>
        <div class="form-tip">会话内可随时切换；仅对支持思考的模型生效，部分模型会忽略该参数。</div>
      </el-form-item>
      <el-form-item label="工具权限">
        <div class="tool-list">
          <label v-for="t in toolCatalog" :key="t.name" class="tool-row">
            <el-checkbox
              :model-value="form.tools.includes(t.name)"
              @update:model-value="(v: unknown) => toggleTool(t.name, Boolean(v))"
            />
            <div class="tool-info">
              <div class="tool-name">
                {{ t.label }}
                <span class="tool-badge" :class="t.level">{{ levelLabel(t.level) }}</span>
              </div>
              <div class="tool-desc">{{ t.description }}</div>
            </div>
          </label>
          <div v-if="!toolCatalog.length" class="form-tip">未获取到工具目录，请重启应用后重试。</div>
        </div>
        <div class="form-tip">
          只读工具直接执行；「写入 / 删除 / 付费」类工具每次执行前都会弹窗让你确认，拒绝后不会改动任何数据。工具调用需要供应商使用 chat 协议。
        </div>
      </el-form-item>
      <el-form-item v-if="showImageConfig" label="生图配置">
        <div class="image-config">
          <el-select
            v-model="form.imageProviderId"
            placeholder="生图供应商"
            clearable
            @change="onImageProviderChange"
          >
            <el-option v-for="p in enabledProviders()" :key="p.id" :value="p.id" :label="p.name" />
          </el-select>
          <el-select
            v-model="form.imageModel"
            placeholder="生图模型（如 gpt-image-1）"
            filterable
            allow-create
            default-first-option
            clearable
          >
            <el-option v-for="m in imageModels" :key="m.id" :value="m.id" :label="m.name || m.id" />
          </el-select>
          <el-select v-model="form.imageSize" placeholder="默认尺寸" clearable>
            <el-option value="" label="默认（由模型决定）" />
            <el-option value="1024x1024" label="1024 × 1024" />
            <el-option value="1536x1024" label="1536 × 1024" />
            <el-option value="1024x1536" label="1024 × 1536" />
            <el-option value="512x512" label="512 × 512" />
          </el-select>
        </div>
        <div class="form-tip">
          生图工具会调用这里的供应商与模型（需支持 Images API）。未选择供应商时沿用上面的对话供应商；每次生成前都会弹窗确认并提示费用。
        </div>
      </el-form-item>
      <el-form-item label="快捷指令">
        <el-input
          v-model="quickPromptsText"
          type="textarea"
          :rows="3"
          placeholder="每行一条，空会话时以按钮展示。例如：&#10;总结我最近的笔记&#10;帮我起个标题"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { AiAgent, AiToolInfo, AiToolLevel } from '../../../../types/agent'
import { useAiProviders } from '../../ai/store'
import { toPlain } from '../../ai/plain'

const props = defineProps<{
  visible: boolean
  agent: AiAgent | null
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  saved: []
}>()

const { providers, enabledProviders, ensureLoaded } = useAiProviders()

const EMOJI_PRESETS = ['🤖', '✍️', '📝', '🔍', '📊', '💡', '🧠', '🗂️']
const saving = ref(false)
const quickPromptsText = ref('')

// 工具目录：主进程注册表是唯一真源，这里只做展示与勾选
const toolCatalog = ref<AiToolInfo[]>([])
const defaultTools = ref<string[]>([])
let toolsLoaded = false

const LEVEL_LABEL: Record<AiToolLevel, string> = {
  read: '只读',
  write: '写入',
  destructive: '删除',
  paid: '付费'
}

function levelLabel(level: AiToolLevel): string {
  return LEVEL_LABEL[level] ?? level
}

function toggleTool(name: string, on: boolean): void {
  const set = new Set(form.value.tools)
  if (on) set.add(name)
  else set.delete(name)
  form.value.tools = [...set]
  // 首次勾选生图工具时给出默认供应商，减少必填项
  if (name === 'generate_image' && on && !form.value.imageProviderId) {
    form.value.imageProviderId = form.value.providerId || enabledProviders()[0]?.id || ''
  }
}

async function ensureToolCatalog(): Promise<void> {
  if (toolsLoaded) return
  try {
    const res = await window.api.ai.tools.list()
    toolCatalog.value = res.tools
    defaultTools.value = res.defaults
    toolsLoaded = true
  } catch {
    // 旧版 preload 没有该通道，保持空列表并提示
  }
}

const form = ref<AiAgent>(newAgent())

function newAgent(): AiAgent {
  const now = new Date().toISOString()
  return {
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    emoji: '🤖',
    description: '',
    systemPrompt: '',
    providerId: '',
    model: '',
    temperature: 0.7,
    maxTokens: 4096,
    contextWindow: 128000,
    reasoningEffort: 'off',
    tools: [],
    imageProviderId: '',
    imageModel: '',
    imageSize: '',
    knowledgeFolderIds: [],
    quickPrompts: [],
    createdAt: now,
    updatedAt: now
  }
}

const modelsOfProvider = computed(() => {
  const p = providers.value.find((x) => x.id === form.value.providerId)
  if (!p) return []
  if (!Array.isArray(p.visibleModelIds)) return p.models
  const ids = new Set(p.visibleModelIds)
  return p.models.filter((m) => ids.has(m.id))
})

/** 勾选生图工具后才显示生图配置，避免普通助手被无关字段干扰 */
const showImageConfig = computed(() => form.value.tools.includes('generate_image'))

/** 生图供应商候选模型：优先选中的生图供应商，未选则沿用对话供应商 */
const imageModels = computed(() => {
  const id = form.value.imageProviderId || form.value.providerId
  const p = providers.value.find((x) => x.id === id)
  if (!p) return []
  if (!Array.isArray(p.visibleModelIds)) return p.models
  const ids = new Set(p.visibleModelIds)
  return p.models.filter((m) => ids.has(m.id))
})

function onImageProviderChange(): void {
  form.value.imageModel = imageModels.value[0]?.id ?? ''
}

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    await Promise.all([ensureLoaded(), ensureToolCatalog()])
    if (props.agent) {
      form.value = {
        ...props.agent,
        tools: [...props.agent.tools],
        imageProviderId: props.agent.imageProviderId ?? '',
        imageModel: props.agent.imageModel ?? '',
        imageSize: props.agent.imageSize ?? '',
        knowledgeFolderIds: [...props.agent.knowledgeFolderIds],
        quickPrompts: [...props.agent.quickPrompts]
      }
      quickPromptsText.value = props.agent.quickPrompts.join('\n')
    } else {
      form.value = newAgent()
      form.value.tools = [...defaultTools.value]
      quickPromptsText.value = ''
      const first = enabledProviders().find((p) => p.models.length) ?? enabledProviders()[0]
      if (first) {
        form.value.providerId = first.id
        form.value.model = first.models[0]?.id ?? ''
      }
    }
  }
)

function onProviderChange(): void {
  form.value.model = modelsOfProvider.value[0]?.id ?? ''
}

async function doSave(): Promise<void> {
  if (!form.value.name.trim()) { ElMessage.warning('请填写名称'); return }
  if (!form.value.providerId) { ElMessage.warning('请选择供应商'); return }
  if (!form.value.model.trim()) { ElMessage.warning('请选择或输入模型'); return }
  if (!form.value.systemPrompt.trim()) { ElMessage.warning('建议填写系统提示词，否则它只是个普通聊天窗口'); return }

  saving.value = true
  try {
    form.value.quickPrompts = quickPromptsText.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6)
    // form 是 ref 深层代理，直接展开仍有嵌套 Proxy，必须先转纯对象再走 IPC
    const payload = toPlain<AiAgent>({
      ...form.value,
      name: form.value.name.trim(),
      model: form.value.model.trim()
    })
    await window.api.ai.agents.save(payload)
    ElMessage.success('助手已保存')
    emit('saved')
    emit('update:visible', false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.agent-form :deep(.el-form-item) { margin-bottom: 16px; }
.form-tip { font-size: 11px; line-height: 1.5; color: var(--ink-3); margin-top: 2px; }
.inline-tip { margin-left: 8px; font-size: 11px; color: var(--ink-3); }
.effort-select { width: 176px; }

.emoji-row { display: flex; align-items: center; gap: 10px; width: 100%; }
.emoji-input { width: 64px; flex-shrink: 0; }
.emoji-input :deep(input) { text-align: center; font-size: 18px; }
.emoji-presets { display: flex; flex-wrap: wrap; gap: 4px; }
.emoji-chip {
  width: 28px; height: 28px; line-height: 28px; text-align: center; font-size: 16px;
  border-radius: 6px; cursor: pointer; border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.emoji-chip:hover { background: var(--fill-hover); }
.emoji-chip.active { background: var(--accent-soft); border-color: var(--accent-border); }

.slider-row { width: 100%; padding-right: 8px; }

.tool-list { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.tool-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--divider);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.tool-row:hover { background: var(--fill-hover); }
.tool-info { min-width: 0; flex: 1; }
.tool-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-1);
}
.tool-badge {
  padding: 0 5px;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  border-radius: 3px;
  background: var(--fill-hover);
  color: var(--ink-3);
}
.tool-badge.read { background: var(--accent-soft); color: var(--accent-strong); }
.tool-badge.write { background: rgba(230, 162, 60, 0.16); color: var(--el-color-warning); }
.tool-badge.destructive { background: rgba(245, 108, 108, 0.14); color: var(--el-color-danger); }
.tool-badge.paid { background: rgba(192, 132, 252, 0.18); color: #a855f7; }
.tool-desc { margin-top: 1px; font-size: 11px; line-height: 1.5; color: var(--ink-3); }

.image-config { width: 100%; display: flex; flex-direction: column; gap: 8px; }
</style>

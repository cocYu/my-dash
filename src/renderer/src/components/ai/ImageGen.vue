<template>
  <div class="image-gen">
    <div class="section-head">
      <div>
        <div class="row-title">AI 生图</div>
        <div class="row-desc">文生图与图生图，生成的图片自动存入笔记附件库，可在笔记中引用；历史记录保留提示词与尺寸。</div>
      </div>
    </div>

    <div v-if="!enabledProviders().length" class="empty-hint">
      <el-empty description="请先在「供应商管理」添加并启用一个 OpenAI 兼容的供应商" :image-size="80" />
    </div>

    <div v-else class="gen-layout">
      <!-- 左：参数 -->
      <div class="gen-form">
        <el-form label-width="76px">
          <el-form-item label="模式">
            <el-radio-group v-model="mode">
              <el-radio-button value="text2image">文生图</el-radio-button>
              <el-radio-button value="image2image">图生图</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="供应商">
            <el-select v-model="providerId" placeholder="选择供应商" @change="onProviderChange">
              <el-option
                v-for="p in imageCapableProviders"
                :key="p.id"
                :value="p.id"
                :label="p.name"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="模型">
            <el-select v-model="model" filterable allow-create default-first-option placeholder="选择或输入模型名" :disabled="!providerId">
              <el-option v-for="m in currentModels" :key="m.id" :value="m.id" :label="m.name || m.id" />
            </el-select>
            <div v-if="providerId && !currentModels.length" class="form-tip">
              该供应商未缓存模型，请到「供应商管理」点「拉取模型」，或直接输入模型名。
            </div>
          </el-form-item>
          <el-form-item label="提示词">
            <el-input v-model="prompt" type="textarea" :rows="4" placeholder="描述你想生成的画面…" />
            <div class="prompt-actions">
              <el-button size="small" :loading="enhancing" @click="openEnhance">
                <el-icon><MagicStick /></el-icon>
                <span>AI 增强</span>
              </el-button>
              <span class="form-tip">可选用任意已启用供应商的模型优化提示词</span>
            </div>
          </el-form-item>
          <el-form-item label="尺寸">
            <el-select v-model="size" placeholder="默认">
              <el-option value="" label="默认（由模型决定）" />
              <el-option value="1024x1024" label="1024 × 1024" />
              <el-option value="1536x1024" label="1536 × 1024" />
              <el-option value="1024x1536" label="1024 × 1536" />
              <el-option value="512x512" label="512 × 512" />
              <el-option value="auto" label="auto" />
            </el-select>
          </el-form-item>
          <el-form-item label="数量">
            <el-input-number v-model="n" :min="1" :max="4" size="small" />
          </el-form-item>

          <template v-if="mode === 'image2image'">
            <el-form-item label="输入图片">
              <el-button size="small" @click="pickImages">选择图片</el-button>
              <div v-if="inputImages.length" class="input-thumbs">
                <div v-for="(img, i) in inputImages" :key="i" class="thumb">
                  <img :src="img" alt="输入图" />
                  <span class="thumb-del" @click="removeImage(i)">×</span>
                </div>
              </div>
              <div v-if="!inputImages.length" class="form-tip">图生图至少需要一张输入图片。</div>
            </el-form-item>
          </template>

          <el-form-item>
            <el-button type="primary" :loading="generating" @click="doGenerate">生成</el-button>
            <el-button v-if="results.length" @click="clearResults">清空结果</el-button>
          </el-form-item>
        </el-form>

        <div v-if="imageProtocolWarning" class="warn-note">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ imageProtocolWarning }}</span>
        </div>
      </div>

      <!-- 右：本次结果 -->
      <div class="gen-results">
        <div v-if="!results.length" class="result-empty">
          <el-icon><PictureFilled /></el-icon>
          <span>生成结果会显示在这里，点击图片可预览与复制</span>
        </div>
        <div v-else class="result-grid">
          <div v-for="(r, i) in results" :key="r.name + i" class="result-card">
            <img
              :src="r.dataUrl"
              class="result-img"
              alt="生成结果"
              title="点击预览 / 复制"
              @click="openResultPreview(i)"
            />
            <div class="result-foot">
              <span class="mono" :title="r.name">{{ r.name.slice(0, 14) }}…</span>
              <span v-if="r.width && r.height" class="size-tag">{{ r.width }}×{{ r.height }}</span>
              <el-button link size="small" @click="copyMarkdownRef(r.name)">复制引用</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 生图历史 -->
    <div class="history-section">
      <div class="history-head">
        <div class="row-title">生图历史 <span class="history-count">共 {{ history.length }} 条</span></div>
        <div class="history-head-actions">
          <span class="history-hint">右键可复制图片 / 提示词</span>
          <el-button v-if="history.length" size="small" text type="danger" :loading="historyClearing" @click="clearAllHistory">
            清空历史
          </el-button>
        </div>
      </div>
      <div v-if="!history.length" class="history-empty">暂无生图历史，生成图片后会自动记录在这里</div>
      <div v-else class="history-list">
        <div
          v-for="item in history"
          :key="item.id"
          class="history-card"
          @contextmenu="onHistoryCtxMenu($event, item)"
        >
          <div class="history-images">
            <img
              v-for="(img, i) in item.images"
              :key="`${img.name}-${i}`"
              :src="attachUrl(img.name)"
              class="history-thumb"
              alt="历史图"
              title="点击预览 / 右键复制"
              @click="openHistoryPreview(item, i)"
              @contextmenu="onHistoryCtxMenu($event, item, img.name)"
            />
          </div>
          <div class="history-meta">
            <div class="history-prompt" :title="item.prompt">{{ item.prompt }}</div>
            <div class="history-info">
              <span>{{ formatTime(item.createdAt) }}</span>
              <span class="size-tag">{{ displaySize(item) }}</span>
            </div>
            <div class="history-sub" :title="`${item.providerName} · ${item.model}`">
              {{ item.providerName }} · {{ item.model }}
            </div>
          </div>
          <el-button class="history-del" link size="small" type="danger" @click="removeHistory(item.id)">删除</el-button>
        </div>
      </div>
      <div class="history-tip">历史仅保存元信息，图片本体在附件库中；删除历史不会删除图片，但图片不再受清理保护。</div>
    </div>

    <!-- 历史右键菜单 -->
    <teleport to="body">
      <div
        v-if="ctxMenu.visible"
        class="ctx-menu glass"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <div class="ctx-item" @click="ctxPreview">预览大图</div>
        <div class="ctx-divider" />
        <div class="ctx-item" @click="ctxCopyImage">复制图片</div>
        <div class="ctx-item" @click="ctxCopyPrompt">复制提示词</div>
        <div class="ctx-item" @click="ctxCopyDetail">复制详细信息</div>
        <div class="ctx-item" @click="ctxCopyRef">复制 Markdown 引用</div>
        <div class="ctx-divider" />
        <div class="ctx-item danger" @click="ctxDelete">删除这条记录</div>
      </div>
    </teleport>

    <!-- 图片预览 -->
    <el-dialog
      v-model="previewVisible"
      width="min(920px, 94vw)"
      top="5vh"
      class="img-preview-dialog"
      append-to-body
      destroy-on-close
    >
      <template #header>
        <div class="preview-title">图片预览</div>
      </template>
      <div v-if="previewCurrent" class="preview-body">
        <div class="preview-stage">
          <img :src="previewCurrent.src" alt="预览" />
        </div>
        <div class="preview-meta">
          <div class="preview-prompt" :title="previewCurrent.prompt">{{ previewCurrent.prompt }}</div>
          <div class="preview-sub">
            <span>{{ previewCurrent.providerName }} · {{ previewCurrent.model }}</span>
            <span>{{ previewCurrent.sizeText }}</span>
            <span v-if="previewCurrent.createdAt">{{ formatTime(previewCurrent.createdAt) }}</span>
            <span v-if="previewList.length > 1" class="preview-idx">{{ previewIndex + 1 }} / {{ previewList.length }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="preview-footer">
          <div class="preview-nav">
            <el-button v-if="previewList.length > 1" size="small" @click="previewStep(-1)">上一张</el-button>
            <el-button v-if="previewList.length > 1" size="small" @click="previewStep(1)">下一张</el-button>
          </div>
          <div class="preview-actions">
            <el-button size="small" @click="previewCopyPrompt">复制提示词</el-button>
            <el-button size="small" @click="previewCopyRef">复制引用</el-button>
            <el-button size="small" type="primary" @click="previewCopyImage">复制图片</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 提示词增强 -->
    <el-dialog v-model="enhanceVisible" title="AI 提示词增强" width="560px" class="enhance-dialog">
      <el-form label-width="76px">
        <el-form-item label="供应商">
          <el-select v-model="enhanceProviderId" placeholder="选择增强用供应商" @change="onEnhanceProviderChange">
            <el-option v-for="p in enabledProviders()" :key="p.id" :value="p.id" :label="p.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-select
            v-model="enhanceModel"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入模型名"
            :disabled="!enhanceProviderId"
          >
            <el-option v-for="m in enhanceModels" :key="m.id" :value="m.id" :label="m.name || m.id" />
          </el-select>
          <div v-if="enhanceProviderId && !enhanceModels.length" class="form-tip">
            该供应商未缓存模型，可直接输入模型名。
          </div>
        </el-form-item>
        <el-form-item label="原提示词">
          <div class="origin-prompt">{{ prompt || '（尚未输入）' }}</div>
        </el-form-item>
      </el-form>
      <div class="enhance-result">
        <div class="enhance-label">增强结果（可直接编辑）</div>
        <el-input v-model="enhancedText" type="textarea" :rows="6" placeholder="点击「开始增强」后显示在这里" />
      </div>
      <template #footer>
        <el-button @click="enhanceVisible = false">取消</el-button>
        <el-button :loading="enhancing" @click="doEnhance">开始增强</el-button>
        <el-button :disabled="!enhancedText.trim()" @click="applyEnhanced(true)">追加</el-button>
        <el-button type="primary" :disabled="!enhancedText.trim()" @click="applyEnhanced(false)">替换提示词</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, PictureFilled, WarningFilled } from '@element-plus/icons-vue'
import type { AiImageHistoryItem, AiImageMode, AiImageResult } from '../../../../types/ai'
import { useAiProviders } from '../../ai/store'

const { providers, ensureLoaded, enabledProviders } = useAiProviders()

const mode = ref<AiImageMode>('text2image')
const providerId = ref('')
const model = ref('')
const prompt = ref('')
const size = ref('')
const n = ref(1)
const inputImages = ref<string[]>([])
const generating = ref(false)

/** 本次结果：附带生成时的提示词快照，后续复制信息不会随输入框变化而失真 */
interface ResultItem extends AiImageResult {
  promptSnapshot: string
  modelSnapshot: string
  providerNameSnapshot: string
  createdAt: string
}
const results = ref<ResultItem[]>([])

const history = ref<AiImageHistoryItem[]>([])
const historyClearing = ref(false)

/** 提示词增强弹窗状态 */
const enhanceVisible = ref(false)
const enhanceProviderId = ref('')
const enhanceModel = ref('')
const enhancedText = ref('')
const enhancing = ref(false)

/** 图片预览状态 */
interface PreviewImage {
  name: string
  src: string
  prompt: string
  model: string
  providerName: string
  sizeText: string
  createdAt: string
}
const previewVisible = ref(false)
const previewList = ref<PreviewImage[]>([])
const previewIndex = ref(0)
const previewCurrent = computed(() => previewList.value[previewIndex.value] ?? null)

/** 历史右键菜单状态 */
const ctxMenu = ref<{
  visible: boolean
  x: number
  y: number
  item: AiImageHistoryItem | null
  imageName: string
}>({ visible: false, x: 0, y: 0, item: null, imageName: '' })

/** 只有非 messages 协议的供应商支持 OpenAI Images API */
const imageCapableProviders = computed(() =>
  enabledProviders().filter((p) => p.protocol !== 'messages')
)

const currentProvider = computed(() => providers.value.find((p) => p.id === providerId.value))
const currentModels = computed(() => {
  const p = currentProvider.value
  if (!p) return []
  if (!Array.isArray(p.visibleModelIds)) return p.models
  const ids = new Set(p.visibleModelIds)
  return p.models.filter((m) => ids.has(m.id))
})

const enhanceProvider = computed(() => providers.value.find((p) => p.id === enhanceProviderId.value))
const enhanceModels = computed(() => enhanceProvider.value?.models ?? [])

const imageProtocolWarning = computed(() => {
  const disabled = enabledProviders().filter((p) => p.protocol === 'messages')
  if (disabled.length && !imageCapableProviders.value.length) {
    return '当前启用的供应商使用 messages 协议（Anthropic），不提供 Images 生图接口。请新增一个 OpenAI 兼容供应商。'
  }
  return ''
})

onMounted(async () => {
  document.addEventListener('click', closeCtxMenu)
  await Promise.all([ensureLoaded(), loadHistory()])
  if (!providerId.value && imageCapableProviders.value.length) {
    providerId.value = imageCapableProviders.value[0].id
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeCtxMenu)
})

watch(imageCapableProviders, (list) => {
  if (!list.some((p) => p.id === providerId.value)) {
    providerId.value = list[0]?.id ?? ''
    model.value = ''
  }
})

function onProviderChange(): void {
  model.value = currentModels.value[0]?.id ?? ''
}

async function pickImages(): Promise<void> {
  try {
    const names = await window.api.attachments.pickImage()
    if (!names?.length) return
    for (const { name } of names) {
      const dataUrl = await window.api.attachments.readDataUrl(name)
      if (dataUrl) inputImages.value.push(dataUrl)
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '选择图片失败')
  }
}

function removeImage(i: number): void {
  inputImages.value.splice(i, 1)
}

async function doGenerate(): Promise<void> {
  if (!providerId.value) { ElMessage.warning('请选择供应商'); return }
  if (!model.value.trim()) { ElMessage.warning('请选择或输入模型'); return }
  if (!prompt.value.trim()) { ElMessage.warning('请输入提示词'); return }
  if (mode.value === 'image2image' && !inputImages.value.length) { ElMessage.warning('图生图至少选择一张输入图片'); return }

  generating.value = true
  try {
    const out = await window.api.ai.generateImage({
      providerId: providerId.value,
      model: model.value.trim(),
      mode: mode.value,
      prompt: prompt.value.trim(),
      size: size.value || undefined,
      n: n.value,
      ...(mode.value === 'image2image' ? { inputImages: [...inputImages.value] } : {})
    })
    const snapshot = {
      promptSnapshot: prompt.value.trim(),
      modelSnapshot: model.value.trim(),
      providerNameSnapshot: currentProvider.value?.name ?? '',
      createdAt: new Date().toISOString()
    }
    results.value = [...out.map((r) => ({ ...r, ...snapshot })), ...results.value]
    // 生图成功后静默刷新历史
    try {
      history.value = await window.api.ai.history.list()
    } catch {
      /* 历史刷新失败不影响本次生图结果 */
    }
    ElMessage.success(`已生成 ${out.length} 张图片并存入附件库`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '生图失败')
  } finally {
    generating.value = false
  }
}

function clearResults(): void {
  results.value = []
}

// ---- 复制能力 ----

/** 复制附件图片到系统剪贴板（主进程 nativeImage + clipboard） */
async function copyImage(name: string): Promise<void> {
  if (!name) return
  try {
    const r = await window.api.attachments.copyImage(name)
    if (r.ok) ElMessage.success('图片已复制到剪贴板')
    else ElMessage.error(r.message || '复制图片失败')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '复制图片失败')
  }
}

async function copyText(text: string, okMsg: string): Promise<void> {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(okMsg)
  } catch {
    ElMessage.info(text)
  }
}

async function copyMarkdownRef(name: string): Promise<void> {
  await copyText(`![生成图](attach://${name})`, 'Markdown 引用已复制')
}

/** 历史条目的完整信息（提示词 / 模型 / 尺寸 / 时间 / 引用） */
function detailText(item: AiImageHistoryItem): string {
  return [
    `提示词：${item.prompt}`,
    `模型：${item.model}`,
    `供应商：${item.providerName}`,
    `尺寸：${displaySize(item)}`,
    `时间：${formatTime(item.createdAt)}`,
    `图片：${item.images.map((x) => `attach://${x.name}`).join('、')}`
  ].join('\n')
}

// ---- 预览 ----

function openResultPreview(index: number): void {
  closeCtxMenu()
  previewList.value = results.value.map((r) => ({
    name: r.name,
    src: r.dataUrl,
    prompt: r.promptSnapshot,
    model: r.modelSnapshot,
    providerName: r.providerNameSnapshot,
    sizeText: r.width && r.height ? `${r.width} × ${r.height}` : '尺寸未知',
    createdAt: r.createdAt
  }))
  previewIndex.value = index
  previewVisible.value = true
}

function openHistoryPreview(item: AiImageHistoryItem, index: number): void {
  closeCtxMenu()
  previewList.value = item.images.map((img) => ({
    name: img.name,
    src: attachUrl(img.name),
    prompt: item.prompt,
    model: item.model,
    providerName: item.providerName,
    sizeText: img.width && img.height ? `${img.width} × ${img.height}` : (item.size || '尺寸未知'),
    createdAt: item.createdAt
  }))
  previewIndex.value = index
  previewVisible.value = true
}

function previewStep(delta: number): void {
  const len = previewList.value.length
  if (len < 2) return
  previewIndex.value = (previewIndex.value + delta + len) % len
}

function previewCopyImage(): void {
  const cur = previewCurrent.value
  if (cur) void copyImage(cur.name)
}

function previewCopyPrompt(): void {
  const cur = previewCurrent.value
  if (cur) void copyText(cur.prompt, '提示词已复制')
}

function previewCopyRef(): void {
  const cur = previewCurrent.value
  if (cur) void copyMarkdownRef(cur.name)
}

// ---- 历史右键菜单 ----

const CTX_WIDTH = 190
const CTX_HEIGHT = 240

function onHistoryCtxMenu(e: MouseEvent, item: AiImageHistoryItem, imageName?: string): void {
  e.preventDefault()
  e.stopPropagation()
  ctxMenu.value = {
    visible: true,
    x: Math.min(e.clientX, Math.max(8, window.innerWidth - CTX_WIDTH - 8)),
    y: Math.min(e.clientY, Math.max(8, window.innerHeight - CTX_HEIGHT - 8)),
    item,
    imageName: imageName || item.images[0]?.name || ''
  }
}

function closeCtxMenu(): void {
  if (ctxMenu.value.visible) ctxMenu.value.visible = false
}

function ctxPreview(): void {
  const item = ctxMenu.value.item
  const name = ctxMenu.value.imageName
  closeCtxMenu()
  if (!item) return
  const idx = Math.max(0, item.images.findIndex((x) => x.name === name))
  openHistoryPreview(item, idx)
}

function ctxCopyImage(): void {
  const name = ctxMenu.value.imageName
  closeCtxMenu()
  if (name) void copyImage(name)
}

function ctxCopyPrompt(): void {
  const item = ctxMenu.value.item
  closeCtxMenu()
  if (item) void copyText(item.prompt, '提示词已复制')
}

function ctxCopyDetail(): void {
  const item = ctxMenu.value.item
  closeCtxMenu()
  if (item) void copyText(detailText(item), '详细信息已复制')
}

function ctxCopyRef(): void {
  const name = ctxMenu.value.imageName
  closeCtxMenu()
  if (name) void copyMarkdownRef(name)
}

function ctxDelete(): void {
  const item = ctxMenu.value.item
  closeCtxMenu()
  if (item) void removeHistory(item.id)
}

// ---- 提示词增强 ----

function openEnhance(): void {
  if (!prompt.value.trim()) { ElMessage.warning('请先输入原始提示词'); return }
  // 优先沿用当前生图供应商（需有模型），否则取第一个有模型的启用供应商
  const withModels = enabledProviders().filter((p) => p.models.length)
  const preferred = providers.value.find((p) => p.id === providerId.value && p.models.length) ?? withModels[0] ?? enabledProviders()[0]
  enhanceProviderId.value = preferred?.id ?? ''
  enhanceModel.value = preferred?.models[0]?.id ?? ''
  enhancedText.value = ''
  enhanceVisible.value = true
}

function onEnhanceProviderChange(): void {
  enhanceModel.value = enhanceProvider.value?.models[0]?.id ?? ''
}

async function doEnhance(): Promise<void> {
  if (!enhanceProviderId.value) { ElMessage.warning('请选择增强用供应商'); return }
  if (!enhanceModel.value.trim()) { ElMessage.warning('请选择或输入增强用模型'); return }
  enhancing.value = true
  try {
    enhancedText.value = await window.api.ai.enhancePrompt({
      providerId: enhanceProviderId.value,
      model: enhanceModel.value.trim(),
      prompt: prompt.value.trim()
    })
    ElMessage.success('提示词已增强，可编辑后应用')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '提示词增强失败')
  } finally {
    enhancing.value = false
  }
}

function applyEnhanced(append: boolean): void {
  const text = enhancedText.value.trim()
  if (!text) return
  prompt.value = append ? `${prompt.value.trim()}\n${text}` : text
  enhanceVisible.value = false
  ElMessage.success(append ? '已追加到提示词' : '已替换提示词')
}

// ---- 生图历史 ----

async function loadHistory(): Promise<void> {
  try {
    history.value = await window.api.ai.history.list()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载生图历史失败')
  }
}

function attachUrl(name: string): string {
  return `attach://${name}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function displaySize(item: AiImageHistoryItem): string {
  const img = item.images[0]
  if (img?.width && img?.height) return `${img.width} × ${img.height}`
  return item.size || '尺寸未知'
}

async function removeHistory(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('删除这条历史记录？图片仍保留在附件库中。', '提示', { type: 'warning' })
  } catch {
    return
  }
  try {
    history.value = await window.api.ai.history.delete(id)
    ElMessage.success('已删除历史记录')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除历史失败')
  }
}

async function clearAllHistory(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空全部生图历史？图片仍保留在附件库中。', '提示', { type: 'warning' })
  } catch {
    return
  }
  historyClearing.value = true
  try {
    history.value = await window.api.ai.history.clear()
    ElMessage.success('已清空生图历史')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '清空历史失败')
  } finally {
    historyClearing.value = false
  }
}
</script>

<style scoped>
.image-gen { width: 100%; }
.section-head { display: flex; align-items: center; justify-content: space-between; }
.row-title { font-size: 14px; font-weight: 600; }
.row-desc { margin-top: 4px; font-size: 12px; color: var(--ink-3); }

.empty-hint { margin-top: 20px; }

.gen-layout { display: flex; gap: 20px; margin-top: 16px; align-items: flex-start; }
.gen-form { width: 360px; flex-shrink: 0; }
.form-tip { font-size: 11px; color: var(--ink-3); line-height: 1.4; margin-top: 2px; }
.prompt-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.prompt-actions .el-icon { margin-right: 4px; }

.input-thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.thumb { position: relative; width: 64px; height: 64px; }
.thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; border: 1px solid var(--divider); }
.thumb-del {
  position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; line-height: 16px;
  text-align: center; border-radius: 50%; background: var(--fill-hover); color: var(--ink-1);
  font-size: 14px; cursor: pointer; border: 1px solid var(--divider);
}

.warn-note {
  display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 10px 12px;
  font-size: 12px; line-height: 1.6; color: var(--ink-2);
  background: var(--fill-subtle); border: 1px solid var(--divider); border-radius: var(--radius-sm);
}
.warn-note .el-icon { flex-shrink: 0; margin-top: 2px; color: var(--accent-strong); }

.gen-results { flex: 1; min-width: 0; min-height: 320px; }
.result-empty {
  height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--ink-3); font-size: 13px;
  border: 1px dashed var(--divider); border-radius: var(--radius-sm);
}
.result-empty .el-icon { font-size: 40px; }
.result-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.result-card {
  border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
  background: var(--fill-subtle); overflow: hidden;
}
.result-img {
  width: 100%; height: 200px; object-fit: cover; display: block;
  cursor: zoom-in; transition: opacity 0.15s ease;
}
.result-img:hover { opacity: 0.9; }
.result-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 6px 8px; font-size: 11px; color: var(--ink-3);
}
.mono { font-family: 'Outfit', monospace; }
.size-tag { font-family: 'Outfit', monospace; color: var(--ink-3); white-space: nowrap; }

/* ---- 生图历史 ---- */
.history-section { margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--divider); }
.history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; }
.history-head-actions { display: flex; align-items: center; gap: 10px; }
.history-hint { font-size: 11px; color: var(--ink-3); }
.history-count { margin-left: 6px; font-size: 11px; font-weight: 400; color: var(--ink-3); }
.history-empty {
  padding: 26px; text-align: center; font-size: 12px; color: var(--ink-3);
  border: 1px dashed var(--divider); border-radius: var(--radius-sm);
}
.history-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.history-card {
  position: relative; display: flex; gap: 10px; padding: 10px;
  border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
  background: var(--fill-subtle);
}
.history-images { display: flex; gap: 4px; flex-shrink: 0; }
.history-thumb {
  width: 64px; height: 64px; border-radius: 6px; object-fit: cover;
  background: var(--fill-hover); cursor: zoom-in; display: block;
  transition: opacity 0.15s ease;
}
.history-thumb:hover { opacity: 0.85; }
.history-meta { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; padding-right: 32px; }
.history-prompt {
  font-size: 12px; color: var(--ink-1); line-height: 1.4; word-break: break-all;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.history-info { display: flex; gap: 10px; font-size: 11px; color: var(--ink-3); }
.history-sub {
  font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.history-del { position: absolute; top: 6px; right: 6px; }
.history-tip { margin-top: 10px; font-size: 11px; line-height: 1.5; color: var(--ink-3); }

/* ---- 右键菜单 ---- */
.ctx-menu {
  position: fixed; z-index: 4000; min-width: 176px; padding: 4px;
  border-radius: var(--radius-sm); border: 1px solid var(--glass-border);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
}
.ctx-item {
  padding: 7px 10px; font-size: 12px; line-height: 1.4; border-radius: 4px;
  color: var(--ink-1); cursor: pointer; white-space: nowrap;
}
.ctx-item:hover { background: var(--fill-hover); }
.ctx-item.danger { color: var(--el-color-danger); }
.ctx-divider { height: 1px; margin: 4px 6px; background: var(--divider); }

/* ---- 图片预览 ---- */
.preview-title { font-size: 14px; font-weight: 600; }
.preview-body { display: flex; flex-direction: column; gap: 12px; }
.preview-stage {
  display: flex; align-items: center; justify-content: center;
  max-height: 64vh; min-height: 180px; overflow: hidden;
  background: var(--fill-subtle); border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
}
.preview-stage img {
  max-width: 100%; max-height: 64vh; object-fit: contain; display: block;
}
.preview-meta { min-width: 0; }
.preview-prompt {
  font-size: 12px; line-height: 1.55; color: var(--ink-1); word-break: break-all;
  max-height: 56px; overflow-y: auto;
}
.preview-sub {
  display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px;
  font-size: 11px; color: var(--ink-3);
}
.preview-idx { margin-left: auto; font-family: 'Outfit', monospace; }
.preview-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.preview-nav, .preview-actions { display: flex; gap: 8px; }

/* ---- 提示词增强弹窗 ---- */
.origin-prompt {
  padding: 8px 10px; border-radius: 6px; background: var(--fill-subtle);
  font-size: 12px; color: var(--ink-2); line-height: 1.5; word-break: break-all;
  max-height: 88px; overflow: auto; width: 100%; box-sizing: border-box;
}
.enhance-result { margin-top: 4px; }
.enhance-label { margin-bottom: 6px; font-size: 12px; color: var(--ink-2); }
</style>

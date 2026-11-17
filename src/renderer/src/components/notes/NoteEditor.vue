<template>
  <div class="note-editor">
    <!-- 工具栏 -->
    <div class="editor-toolbar glass">
      <el-input
        v-model="title"
        class="title-input"
        placeholder="笔记标题"
        @input="onTitleInput"
        @keydown="onTitleKeydown"
      />

      <el-radio-group v-model="viewMode" size="small" class="view-switch">
        <el-radio-button value="edit" title="源码视图">
          <el-icon><EditPen /></el-icon>
        </el-radio-button>
        <el-radio-button value="split" title="分屏（源码/预览）">
          <el-icon><Grid /></el-icon>
        </el-radio-button>
        <el-radio-button value="preview" title="预览视图">
          <el-icon><View /></el-icon>
        </el-radio-button>
      </el-radio-group>

      <el-select
        v-model="mdThemeId"
        size="small"
        class="theme-select"
        placeholder="渲染主题"
        title="Markdown 渲染主题"
      >
        <el-option-group label="预设主题">
          <el-option v-for="t in MD_THEMES" :key="t.id" :value="t.id" :label="t.name" />
        </el-option-group>
        <el-option-group v-if="userThemes.length" label="Typora 主题">
          <el-option
            v-for="t in userThemes"
            :key="t.name"
            :value="`${USER_THEME_PREFIX}${t.name}`"
            :label="t.name"
          />
        </el-option-group>
      </el-select>

      <el-button size="small" title="Typora 主题（导入 / 管理）" @click="openTyporaDialog">
        <el-icon><Brush /></el-icon>
      </el-button>
      <el-button size="small" title="排版微调（字号/行高/段距/页宽）" @click="typoDialogVisible = true">
        <el-icon><Operation /></el-icon>
      </el-button>
      <el-button size="small" title="自定义渲染 CSS" @click="openCssDialog">
        <el-icon><MagicStick /></el-icon>
      </el-button>
      <el-button size="small" title="版本历史" @click="drawerVisible = true">
        <el-icon><Clock /></el-icon>
      </el-button>

      <el-dropdown trigger="click" @command="onExport">
        <el-button size="small" title="导出">
          <el-icon><Download /></el-icon>
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="md">导出 Markdown (.md)</el-dropdown-item>
            <el-dropdown-item command="html">导出 HTML (.html)</el-dropdown-item>
            <el-dropdown-item command="pdf" divided>导出 PDF (.pdf)</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <span class="save-state" :data-state="saveState">{{ saveStateText }}</span>
    </div>

    <!-- 内容区 -->
    <div class="editor-body glass">
      <div
        class="panes"
        :class="`mode-${viewMode}`"
        :style="viewMode === 'split' ? { gridTemplateColumns: `${splitRatio}% 6px 1fr` } : undefined"
      >
        <div v-show="viewMode !== 'preview'" ref="editorContainer" class="editor-pane" />
        <div
          v-if="viewMode === 'split'"
          class="split-divider"
          @mousedown="startDividerDrag"
        />
        <div v-show="viewMode !== 'edit'" class="preview-pane">
          <MdPreview
            :content="content"
            :theme="mdThemeId"
            :custom-css="customCss"
            :typography="typography"
            :typora-css="typoraCss"
          />
        </div>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="editor-status glass">
      <span class="stat-group" title="字数统计与预计阅读时间">
        <el-icon><Document /></el-icon>
        {{ statsText }}
      </span>
      <span class="stat-spacer" />
      <span class="stat-group muted" title="创建时间 / 最近更新时间">
        <el-icon><Calendar /></el-icon>
        创建 {{ fmtTime(createdAt) }} · 更新 {{ fmtTime(updatedAt) }}
      </span>
    </div>

    <!-- 排版微调 -->
    <el-dialog v-model="typoDialogVisible" title="排版微调" width="560px" :append-to-body="true">
      <div class="css-hint">作用于预览与导出，叠加在所选渲染主题之上；改动即时生效并自动保存。</div>
      <div class="typo-grid">
        <label>正文字号</label>
        <el-slider
          v-model="typography.fontSize"
          :min="12"
          :max="24"
          :step="1"
          show-input
          :show-input-controls="false"
          input-size="small"
        />
        <label>行高</label>
        <el-slider
          v-model="typography.lineHeight"
          :min="1.2"
          :max="3"
          :step="0.05"
          show-input
          :show-input-controls="false"
          input-size="small"
        />
        <label>段落间距</label>
        <el-slider
          v-model="typography.paraSpacing"
          :min="0"
          :max="32"
          :step="1"
          show-input
          :show-input-controls="false"
          input-size="small"
        />
        <label>正文宽度</label>
        <div class="typo-width">
          <el-checkbox v-model="typography.fullWidth">铺满容器</el-checkbox>
          <el-slider
            v-model="typography.maxWidth"
            class="typo-width-slider"
            :min="480"
            :max="1600"
            :step="20"
            :disabled="typography.fullWidth"
          />
        </div>
        <label>正文字体</label>
        <el-select v-model="typography.fontFamily" size="small">
          <el-option v-for="f in FONT_OPTIONS" :key="f.value" :value="f.value" :label="f.label" />
        </el-select>
      </div>
      <template #footer>
        <el-button @click="resetTypography">恢复默认</el-button>
        <el-button type="primary" @click="typoDialogVisible = false">完成</el-button>
      </template>
    </el-dialog>

    <!-- Typora 主题管理 -->
    <el-dialog v-model="typoraDialogVisible" title="Typora 主题" width="560px" :append-to-body="true">
      <div class="css-hint">
        导入 Typora 的主题文件（<code>.css</code>，通常在 Typora「偏好设置 → 外观 → 打开主题文件夹」的
        <code>themes</code> 目录里），自动把 <code>#write</code> / <code>body</code> 等选择器映射到预览容器。
        导入后在上方主题下拉的「Typora 主题」分组中切换。
      </div>
      <div class="typora-actions">
        <el-button type="primary" size="small" @click="importTypora">导入 .css 主题…</el-button>
      </div>
      <el-table
        :data="userThemes"
        size="small"
        empty-text="尚未导入主题"
        max-height="300"
        class="typora-table"
      >
        <el-table-column prop="name" label="主题" min-width="160" show-overflow-tooltip />
        <el-table-column label="大小" width="90">
          <template #default="{ row }">{{ (row.size / 1024).toFixed(1) }} KB</template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-button
              size="small"
              text
              type="primary"
              :disabled="mdThemeId === `${USER_THEME_PREFIX}${row.name}`"
              @click="applyTypora(row.name)"
            >
              {{ mdThemeId === `${USER_THEME_PREFIX}${row.name}` ? '使用中' : '使用' }}
            </el-button>
            <el-button size="small" text type="danger" @click="removeTypora(row.name)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button type="primary" @click="typoraDialogVisible = false">完成</el-button>
      </template>
    </el-dialog>

    <!-- 自定义渲染 CSS -->
    <el-dialog v-model="cssDialogVisible" title="自定义渲染 CSS" width="640px" :append-to-body="true">
      <div class="css-hint">
        作用于预览/导出的 <code>.md-body</code>（Markdown 渲染容器），叠加在所选主题之上。示例：
        <code>.md-body p { line-height: 2; }</code>
      </div>
      <el-input
        v-model="cssDraft"
        type="textarea"
        :rows="14"
        spellcheck="false"
        class="css-editor"
        placeholder=".md-body { ... }"
      />
      <template #footer>
        <el-button @click="cssDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          @click="saveCustomCss"
        >保存并应用</el-button>
      </template>
    </el-dialog>

    <!-- 版本抽屉 -->
    <VersionDrawer v-model:visible="drawerVisible" :note-id="note?.id ?? null" @restored="onRestored" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import {
  ArrowDown,
  Brush,
  Calendar,
  Clock,
  Document,
  Download,
  EditPen,
  Grid,
  MagicStick,
  Operation,
  View
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MdPreview from './MdPreview.vue'
import VersionDrawer from './VersionDrawer.vue'
import { getNote, updateNote, type NoteFull } from '../../api/notes'
import {
  DEFAULT_MD_THEME,
  getCustomCss,
  getMdThemeId,
  MD_THEMES,
  setCustomCss,
  setMdThemeId,
  USER_THEME_PREFIX,
  userThemeName
} from '../../markdown/themes'
import {
  DEFAULT_TYPOGRAPHY,
  FONT_OPTIONS,
  getTypography,
  setTypography,
  typographyCss,
  type MdTypography
} from '../../markdown/typography'
import { invalidateUserTheme, loadUserThemeCss, scopeTyporaCss, type UserMdTheme } from '../../markdown/typora'
import type { OutlineItem } from '../../markdown/outline'
import { MD_THEMES_CSS } from '../../markdown/md-themes-css'
import { renderMarkdown } from '../../markdown/renderer'
import katexCss from 'katex/dist/katex.min.css?inline'

const props = defineProps<{
  note: NoteFull | null
}>()

const emit = defineEmits<{
  saved: [noteId: number]
  /** 内容变化（防抖后），供左侧大纲面板更新 */
  'content-change': [content: string]
}>()

// ---- 状态 ----
const title = ref('')
const content = ref('')
const saveState = ref<'none' | 'saved' | 'saving' | 'dirty'>('none')

const VIEW_KEY = 'mydash:md-viewmode'
const SPLIT_KEY = 'mydash:md-split'
const viewMode = ref<'edit' | 'split' | 'preview'>(
  (localStorage.getItem(VIEW_KEY) as 'edit' | 'split' | 'preview') ?? 'split'
)
watch(viewMode, (v) => localStorage.setItem(VIEW_KEY, v))

const splitRatio = ref(Number(localStorage.getItem(SPLIT_KEY)) || 50)
watch(splitRatio, (v) => localStorage.setItem(SPLIT_KEY, String(v)))

const mdThemeId = ref(getMdThemeId())
const userThemes = ref<UserMdTheme[]>([])
const typoraCss = ref('')
const typoraDialogVisible = ref(false)

watch(mdThemeId, async (id) => {
  setMdThemeId(id)
  if (id.startsWith(USER_THEME_PREFIX)) {
    const name = userThemeName(id)
    try {
      typoraCss.value = scopeTyporaCss(await loadUserThemeCss(name))
      ElMessage.success(`Typora 主题：${name}`)
    } catch {
      typoraCss.value = ''
      ElMessage.error(`主题 CSS 读取失败：${name}`)
    }
    return
  }
  typoraCss.value = ''
  ElMessage.success(`渲染主题：${MD_THEMES.find((t) => t.id === id)?.name ?? id}`)
})

async function refreshUserThemes(): Promise<void> {
  userThemes.value = await window.api.mdThemes.list()
}

function openTyporaDialog(): void {
  typoraDialogVisible.value = true
  void refreshUserThemes()
}

async function importTypora(): Promise<void> {
  const list = await window.api.mdThemes.importThemes()
  if (list === null) return // 取消
  invalidateUserTheme()
  userThemes.value = list
  ElMessage.success('已导入 Typora 主题')
}

function applyTypora(name: string): void {
  mdThemeId.value = `${USER_THEME_PREFIX}${name}`
}

async function removeTypora(name: string): Promise<void> {
  userThemes.value = await window.api.mdThemes.remove(name)
  invalidateUserTheme(name)
  if (mdThemeId.value === `${USER_THEME_PREFIX}${name}`) {
    mdThemeId.value = DEFAULT_MD_THEME
    typoraCss.value = ''
  }
  ElMessage.success('已删除')
}

const customCss = ref(getCustomCss())
const cssDialogVisible = ref(false)
const cssDraft = ref('')

// 排版微调：改动即时生效并持久化
const typoDialogVisible = ref(false)
const typography = ref<MdTypography>(getTypography())
watch(typography, (t) => setTypography(t), { deep: true })

function resetTypography(): void {
  typography.value = { ...DEFAULT_TYPOGRAPHY }
}

// ---- 状态栏：字数 / 阅读时间 / 创建与更新时间 ----
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uf900-\ufaff]/g

function textStats(text: string): { chars: number; minutes: number } {
  const cjk = (text.match(CJK_RE) ?? []).length
  const latinWords = text
    .replace(CJK_RE, ' ')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length
  return {
    chars: cjk + latinWords,
    minutes: Math.max(1, Math.round(cjk / 400 + latinWords / 200))
  }
}

const statsText = computed(() => {
  const { chars, minutes } = textStats(content.value)
  if (chars === 0) return '0 字'
  return `${chars.toLocaleString()} 字 · 约 ${minutes} 分钟`
})

const createdAt = ref(props.note?.created_at ?? '')
const updatedAt = ref(props.note?.updated_at ?? '')

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const drawerVisible = ref(false)

const saveStateText = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'dirty') return '未保存'
  if (saveState.value === 'saved' && lastSavedAt.value) {
    return `已保存 ${lastSavedAt.value.toLocaleTimeString()}`
  }
  return ''
})
const lastSavedAt = ref<Date | null>(null)

// ---- 大纲联动：内容变化（含装载/还原）防抖上报，左侧大纲面板据此刷新 ----
let outlineTimer: ReturnType<typeof setTimeout> | null = null
watch(content, () => {
  if (outlineTimer) clearTimeout(outlineTimer)
  outlineTimer = setTimeout(() => emit('content-change', content.value), 300)
})

// ---- CodeMirror ----
const editorContainer = ref<HTMLElement>()
let editorView: EditorView | null = null
let applyingNote = false

const cmHighlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--accent-strong)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700', color: 'var(--ink-1)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--ink-3)' },
  { tag: t.monospace, color: 'var(--ink-1)' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--ink-1)' },
  { tag: t.meta, color: 'var(--ink-3)' }
])

const cmTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '14px',
      color: 'var(--ink-1)',
      backgroundColor: 'transparent'
    },
    '.cm-content': {
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      caretColor: 'var(--accent)',
      lineHeight: '1.75'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--ink-3)'
    },
    '.cm-activeLine': { backgroundColor: 'var(--fill-subtle)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--fill-subtle)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--accent-soft)'
    }
  },
  { dark: document.documentElement.classList.contains('dark') }
)

function createEditor(): void {
  if (!editorContainer.value || editorView) return
  // 首挂载即同步当前笔记内容（组件按 key 重建，watch 不会触发）
  content.value = props.note?.content ?? ''
  title.value = props.note?.title ?? ''
  editorView = new EditorView({
    parent: editorContainer.value,
    state: EditorState.create({
      doc: props.note?.content ?? '',
      extensions: [
        basicSetup,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        cmTheme,
        syntaxHighlighting(cmHighlight),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void saveNow()
              return true
            }
          }
        ]),
        EditorView.updateListener.of((update) => {
          if (applyingNote || !update.docChanged) return
          content.value = update.state.doc.toString()
          markDirty()
          scheduleSave()
        })
      ]
    })
  })
}

onMounted(createEditor)

// 挂载时若上次选中的是 Typora 主题，恢复其 CSS
onMounted(() => {
  void refreshUserThemes()
  const id = mdThemeId.value
  if (id.startsWith(USER_THEME_PREFIX)) {
    const name = userThemeName(id)
    void loadUserThemeCss(name)
      .then((css) => {
        typoraCss.value = scopeTyporaCss(css)
      })
      .catch(() => {
        ElMessage.error(`主题 CSS 读取失败：${name}`)
      })
  }
})

// ---- 大纲跳转：源码视图滚到对应行，预览/分屏滚到对应标题元素 ----
function revealHeading(item: OutlineItem): void {
  if (viewMode.value !== 'preview' && editorView) {
    const lineNo = Math.min(item.line + 1, editorView.state.doc.lines)
    const line = editorView.state.doc.line(lineNo)
    editorView.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' })
    })
  }
  if (viewMode.value !== 'edit') {
    const root = document.querySelector('.preview-pane .md-body')
    const el = root?.querySelectorAll('h1,h2,h3,h4,h5,h6')[item.index] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

defineExpose({ revealHeading })

// ---- 笔记切换：先落盘旧笔记，再装载新笔记 ----
watch(
  () => props.note?.id,
  async (newId, oldId) => {
    if (newId === oldId) return
    if (oldId != null && saveState.value === 'dirty') {
      await saveNow(oldId)
    }
    applyingNote = true
    content.value = props.note?.content ?? ''
    title.value = props.note?.title ?? ''
    createdAt.value = props.note?.created_at ?? ''
    updatedAt.value = props.note?.updated_at ?? ''
    saveState.value = props.note ? 'saved' : 'none'
    lastSavedAt.value = null
    editorView?.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: content.value }
    })
    applyingNote = false
    editorView?.focus()
  }
)

// ---- 自动保存 ----
let saveTimer: ReturnType<typeof setTimeout> | null = null

function markDirty(): void {
  if (!props.note) return
  saveState.value = 'dirty'
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveNow(), 800)
}

async function saveNow(targetId?: number): Promise<void> {
  const id = targetId ?? props.note?.id
  if (!id) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  saveState.value = 'saving'
  try {
    const saved = await updateNote(id, {
      title: title.value.trim() || '未命名笔记',
      content: content.value
    })
    updatedAt.value = saved.updated_at
    saveState.value = 'saved'
    lastSavedAt.value = new Date()
    emit('saved', id)
  } catch (err) {
    saveState.value = 'dirty'
    const detail =
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
      (err instanceof Error ? err.message : String(err))
    ElMessage.error(`保存失败：${detail}`)
  }
}

function onTitleInput(): void {
  markDirty()
  scheduleSave()
}

function onTitleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    editorView?.focus()
  }
}

// 全局 Ctrl/Cmd+S
function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && props.note) {
    e.preventDefault()
    void saveNow()
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  if (saveTimer) clearTimeout(saveTimer)
  if (outlineTimer) clearTimeout(outlineTimer)
})

// ---- 分屏拖条 ----
function startDividerDrag(e: MouseEvent): void {
  const panes = (e.target as HTMLElement).closest('.panes') as HTMLElement
  const rect = panes.getBoundingClientRect()
  const onMove = (ev: MouseEvent): void => {
    const percent = ((ev.clientX - rect.left) / rect.width) * 100
    splitRatio.value = Math.min(80, Math.max(20, Math.round(percent)))
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// ---- 自定义 CSS ----
function openCssDialog(): void {
  cssDraft.value = customCss.value
  cssDialogVisible.value = true
}

function saveCustomCss(): void {
  setCustomCss(cssDraft.value)
  customCss.value = cssDraft.value
  cssDialogVisible.value = false
  ElMessage.success('自定义 CSS 已应用')
}

// ---- 版本还原后重载笔记 ----
async function onRestored(noteId: number): Promise<void> {
  const fresh = await getNote(noteId)
  applyingNote = true
  content.value = fresh.content
  editorView?.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: fresh.content }
  })
  applyingNote = false
  markDirty()
  void saveNow()
}

// ---- 导出 ----
function safeName(): string {
  return (title.value.trim() || '未命名笔记').replace(/[\\/:*?"<>|]/g, '_')
}

function buildExportHtml(): string {
  const body = renderMarkdown(content.value)
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title.value}</title>` +
    `<style>${katexCss}</style><style>${MD_THEMES_CSS}</style>` +
    `<style>body{margin:0;background:#fff}.md-body{max-width:860px;margin:0 auto;padding:40px 32px}</style>` +
    `<style>${typographyCss(typography.value)}</style>` +
    `<style>${typoraCss.value}</style>` +
    `<style>${customCss.value}</style>` +
    `</head><body><div class="md-body ${mdThemeId.value.startsWith(USER_THEME_PREFIX) ? 'theme-custom' : `theme-${mdThemeId.value}`}">${body}</div></body></html>`
  )
}

async function onExport(command: string): Promise<void> {
  if (!props.note) return
  const name = safeName()
  if (command === 'md') {
    const r = await window.api.exporter.saveText({
      defaultName: `${name}.md`,
      filterName: 'Markdown',
      ext: 'md',
      data: content.value
    })
    reportExport(r)
    return
  }
  if (command === 'html') {
    const r = await window.api.exporter.saveText({
      defaultName: `${name}.html`,
      filterName: 'HTML',
      ext: 'html',
      data: buildExportHtml()
    })
    reportExport(r)
    return
  }
  if (command === 'pdf') {
    const r = await window.api.exporter.savePdf({ defaultName: `${name}.pdf`, html: buildExportHtml() })
    reportExport(r)
  }
}

function reportExport(r: { saved: boolean; filePath?: string }): void {
  if (r.saved) ElMessage.success(`已导出：${r.filePath}`)
  else ElMessage.info('已取消导出')
}
</script>

<style scoped>
.note-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 10px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  flex-shrink: 0;
}

.title-input {
  flex: 1;
  min-width: 150px;
  max-width: 320px;
}

.view-switch {
  flex-shrink: 0;
}

.view-switch :deep(.el-radio-button__inner) {
  padding: 6px 10px;
}

.theme-select {
  width: 150px;
  flex-shrink: 0;
}

.save-state {
  font-size: 12px;
  color: var(--ink-3);
  min-width: 90px;
  text-align: right;
}

.editor-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.editor-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--ink-2);
  flex-shrink: 0;
}

.stat-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.stat-group.muted {
  color: var(--ink-3);
}

.stat-spacer {
  flex: 1;
}

/* 排版微调对话框 */
.typo-grid {
  display: grid;
  grid-template-columns: 76px 1fr;
  align-items: center;
  gap: 12px 14px;
  padding: 4px 2px;
}

.typo-grid > label {
  font-size: 13px;
  color: var(--ink-2);
}

.typo-width {
  display: flex;
  align-items: center;
  gap: 12px;
}

.typo-width-slider {
  flex: 1;
}

.typo-grid :deep(.el-slider__input) {
  width: 56px;
}

/* Typora 主题管理 */
.typora-actions {
  margin-bottom: 10px;
}

.typora-table {
  --el-table-border-color: var(--divider);
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: var(--fill-subtle);
}

.panes {
  display: grid;
  height: 100%;
}

.panes.mode-edit {
  grid-template-columns: 1fr;
}

.panes.mode-preview {
  grid-template-columns: 1fr;
}

.editor-pane {
  overflow: hidden;
  border-radius: 0 0 var(--radius) var(--radius);
}

.editor-pane :deep(.cm-editor) {
  height: 100%;
}

.preview-pane {
  overflow: hidden;
  border-radius: 0 0 var(--radius) var(--radius);
}

.split-divider {
  cursor: col-resize;
  background: var(--divider);
  transition: background 0.2s ease;
}

.split-divider:hover {
  background: var(--accent);
}

.css-hint {
  font-size: 12px;
  color: var(--ink-2);
  margin-bottom: 10px;
}

.css-hint code,
.css-editor :deep(textarea) {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12.5px;
}
</style>

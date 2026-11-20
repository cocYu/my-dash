// 主题系统：预设主题元数据与应用/持久化。
// 主题本体是 styles/main.css 里 html[data-theme='<id>'] 的 token 集合；
// 这里负责切换 data-theme、同步 Element Plus 的 html.dark 基底并记住选择。
export interface ThemeMeta {
  id: string
  name: string
  mode: 'dark' | 'light'
  /** 管理界面里的三色预览（背景/面板/主色） */
  preview: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'aurora-dark',
    name: '墨夜',
    mode: 'dark',
    preview: ['#0d0e10', '#16181c', '#6e8bff']
  },
  {
    id: 'ember-dark',
    name: '焦糖',
    mode: 'dark',
    preview: ['#12100e', '#1b1815', '#e0a45e']
  },
  {
    id: 'morning-light',
    name: '宣纸',
    mode: 'light',
    preview: ['#f6f4ef', '#fffefb', '#2e5a87']
  },
  {
    id: 'jade-light',
    name: '青瓷',
    mode: 'light',
    preview: ['#f1f4f0', '#fffefa', '#3a6a4f']
  }
]

export const DEFAULT_THEME = 'aurora-dark'
const STORAGE_KEY = 'mydash:theme'
const CHANGE_EVENT = 'mydash:theme-change'

export function getSavedThemeId(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  return THEMES.some((t) => t.id === saved) ? (saved as string) : DEFAULT_THEME
}

export function getThemeMeta(id: string): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** 应用主题：设置 data-theme、同步 EP 深色基底类、持久化，并广播变更 */
export function applyTheme(id: string): void {
  const theme = getThemeMeta(id)
  const el = document.documentElement
  el.dataset.theme = theme.id
  el.classList.toggle('dark', theme.mode === 'dark')
  localStorage.setItem(STORAGE_KEY, theme.id)
  window.dispatchEvent(new CustomEvent<string>(CHANGE_EVENT, { detail: theme.id }))
}

/** 应用启动时同步一次（无动画、无闪屏） */
export function initTheme(): void {
  applyTheme(getSavedThemeId())
}

/** 在深/浅之间切换，保留当前色系：墨夜↔宣纸、焦糖↔青瓷 */
export function toggleThemeMode(): string {
  const current = getThemeMeta(getSavedThemeId())
  const targetMode = current.mode === 'dark' ? 'light' : 'dark'
  const peer =
    (current.id === 'ember-dark' && THEMES.find((t) => t.id === 'jade-light')) ||
    (current.id === 'jade-light' && THEMES.find((t) => t.id === 'ember-dark')) ||
    THEMES.find((t) => t.mode === targetMode)!
  applyTheme(peer.id)
  return peer.id
}

/** 订阅主题变更，返回取消订阅函数 */
export function onThemeChange(handler: (id: string) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<string>).detail)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

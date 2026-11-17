// 主题系统：预设主题元数据与应用/持久化。
// 主题本体是 styles/main.css 里 html[data-theme='<id>'] 的 token 集合；
// 这里负责切换 data-theme、同步 Element Plus 的 html.dark 基底并记住选择。
export interface ThemeMeta {
  id: string
  name: string
  mode: 'dark' | 'light'
  /** 管理界面里的三色预览（背景/玻璃/主色） */
  preview: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'aurora-dark',
    name: '暮色极光',
    mode: 'dark',
    preview: ['#0e1428', 'rgba(148,172,224,0.16)', '#38bdf8']
  },
  {
    id: 'ember-dark',
    name: '熔金暮色',
    mode: 'dark',
    preview: ['#1b0f12', 'rgba(224,164,120,0.16)', '#fbbf24']
  },
  {
    id: 'morning-light',
    name: '晨雾',
    mode: 'light',
    preview: ['#eef2f7', 'rgba(255,255,255,0.9)', '#0369a1']
  },
  {
    id: 'jade-light',
    name: '竹青',
    mode: 'light',
    preview: ['#edf3ef', 'rgba(255,255,255,0.9)', '#047857']
  }
]

export const DEFAULT_THEME = 'aurora-dark'
const STORAGE_KEY = 'mydash:theme'

export function getSavedThemeId(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  return THEMES.some((t) => t.id === saved) ? (saved as string) : DEFAULT_THEME
}

/** 应用主题：设置 data-theme、同步 EP 深色基底类、持久化 */
export function applyTheme(id: string): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]
  const el = document.documentElement
  el.dataset.theme = theme.id
  el.classList.toggle('dark', theme.mode === 'dark')
  localStorage.setItem(STORAGE_KEY, theme.id)
}

/** 应用启动时同步一次（无动画、无闪屏） */
export function initTheme(): void {
  applyTheme(getSavedThemeId())
}

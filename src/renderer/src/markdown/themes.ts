// Markdown 渲染主题：预设元数据 + 当前选择与自定义 CSS 的持久化。
// 主题 id 可以是预设（github/minimal/sepia/dark）或用户导入的 Typora 主题（'user:<名称>'）。
export interface MdTheme {
  id: string
  name: string
}

export const MD_THEMES: MdTheme[] = [
  { id: 'github', name: 'GitHub' },
  { id: 'minimal', name: '极简' },
  { id: 'sepia', name: '书卷' },
  { id: 'dark', name: '暗夜' }
]

export const DEFAULT_MD_THEME = 'github'
export const USER_THEME_PREFIX = 'user:'
const THEME_KEY = 'mydash:md-theme'
const CUSTOM_CSS_KEY = 'mydash:md-custom-css'

export function isValidThemeId(id: string): boolean {
  return MD_THEMES.some((t) => t.id === id) || id.startsWith(USER_THEME_PREFIX)
}

export function getMdThemeId(): string {
  const saved = localStorage.getItem(THEME_KEY)
  return saved && isValidThemeId(saved) ? saved : DEFAULT_MD_THEME
}

export function setMdThemeId(id: string): void {
  if (isValidThemeId(id)) localStorage.setItem(THEME_KEY, id)
}

export function userThemeName(themeId: string): string {
  return themeId.startsWith(USER_THEME_PREFIX) ? themeId.slice(USER_THEME_PREFIX.length) : ''
}

export function getCustomCss(): string {
  return localStorage.getItem(CUSTOM_CSS_KEY) ?? ''
}

export function setCustomCss(css: string): void {
  if (css) localStorage.setItem(CUSTOM_CSS_KEY, css)
  else localStorage.removeItem(CUSTOM_CSS_KEY)
}

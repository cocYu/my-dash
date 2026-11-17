// Typora 主题兼容：从应用数据目录 md-themes/ 读取用户导入的 .css 主题，
// 将 Typora 的选择器（#write / body / html / :root）映射到预览容器 .md-body 上。
export interface UserMdTheme {
  name: string
  size: number
}

const cache = new Map<string, string>()

export async function listUserThemes(): Promise<UserMdTheme[]> {
  return window.api.mdThemes.list()
}

export async function loadUserThemeCss(name: string): Promise<string> {
  const hit = cache.get(name)
  if (hit != null) return hit
  const css = await window.api.mdThemes.read(name)
  cache.set(name, css)
  return css
}

export function invalidateUserTheme(name?: string): void {
  if (name) cache.delete(name)
  else cache.clear()
}

/** Typora 主题 CSS → 预览容器作用域（官方主题以 #write 为正文容器） */
export function scopeTyporaCss(css: string): string {
  return css
    .replace(/#write\b/g, '.md-body')
    .replace(/\.md-content\b/g, '.md-body')
    .replace(/(^|[{}()\s,>+~])body\b/g, '$1.md-body')
    .replace(/(^|[{}()\s,>+~])html\b/g, '$1.md-body')
    .replace(/:root\b/g, '.md-body')
}

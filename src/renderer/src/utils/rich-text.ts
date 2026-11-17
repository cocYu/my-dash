// 富文本消毒：白名单标签 + 去事件属性/危险 URL（本地自用内容，防粘贴入的脏 HTML）。
const ALLOWED = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
])

export function sanitizeHtml(html: string): string {
  let s = html ?? ''
  // 整块剔除脚本/样式/嵌入
  s = s.replace(/<(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\1\s*>/gi, '')
  s = s.replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
  // 事件属性
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // 危险 URL
  s = s.replace(/(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m) => {
    if (/^\s*(href|src)\s*=\s*("|')?\s*(javascript|vbscript|data):/i.test(m)) return 'href="#"'
    return m
  })
  // 非白名单标签：去标签留内容
  s = s.replace(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi, (m, tag: string) =>
    ALLOWED.has(tag.toLowerCase()) ? m : ''
  )
  return s
}

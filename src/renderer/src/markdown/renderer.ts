// markdown-it 单例：GFM 基础 + 任务列表 + 代码高亮 + KaTeX 公式 + 锚点/目录。
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import anchor from 'markdown-it-anchor'
import tableOfContents from 'markdown-it-table-of-contents'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import hljs from 'highlight.js'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlight(str: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
    } catch {
      // 高亮失败退回转义
    }
  }
  return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`
}

const md = new MarkdownIt({
  html: false, // 安全：不透传原始 HTML
  linkify: true,
  breaks: false,
  highlight
})

// GFM 任务列表：渲染勾选框（只读展示，不回写内容）
md.use(taskLists, { enabled: false })

// 标题锚点（支持中文 slug）
md.use(anchor, {
  slugify: (s: string) => encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-')),
  permalink: false
} as unknown as Parameters<typeof anchor>[1])

// [[toc]] 自动目录（marker 默认 [[toc]]，支持中文标题 slug）
md.use(tableOfContents, { containerClass: 'md-toc' })

// KaTeX 数学公式：$行内 / $$块级
md.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: { output: 'html' }
})

// 顶层块级元素标注源码行号（data-line），供分屏视图滚动同步定位
md.core.ruler.push('source_line', (state) => {
  for (const token of state.tokens) {
    // nesting 1 = 开标签（p/标题/列表/表格…），0 = 自闭合（代码块/分隔线）；只标顶层块
    if (token.map && token.level === 0 && token.nesting >= 0) {
      token.attrSet('data-line', String(token.map[0]))
    }
  }
})

export function renderMarkdown(source: string): string {
  return md.render(source ?? '')
}

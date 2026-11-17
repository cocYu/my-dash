// Markdown 渲染主题样式（字符串导出：应用内注入 + 导出 HTML 复用同一份）。
// 主题 = .md-body.theme-<id> 上的一组 CSS 变量；结构与排版规则共享。
export const MD_THEMES_CSS = String.raw`
.md-body {
  --md-bg: transparent;
  --md-fg: #1f2328;
  --md-muted: #656d76;
  --md-border: #d8dee4;
  --md-accent: #0969da;
  --md-code-bg: rgba(175, 184, 193, 0.2);
  --md-pre-bg: #f6f8fa;
  --md-quote-bg: rgba(175, 184, 193, 0.12);
  --md-mark: #fff8c5;

  background: var(--md-bg);
  color: var(--md-fg);
  font-size: 15px;
  line-height: 1.75;
  word-break: break-word;
  padding: 4px 6px;
}
.md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6 {
  margin: 1.4em 0 0.6em;
  font-weight: 700;
  line-height: 1.3;
}
.md-body h1 { font-size: 1.9em; padding-bottom: 0.3em; border-bottom: 1px solid var(--md-border); }
.md-body h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--md-border); }
.md-body h3 { font-size: 1.25em; }
.md-body h4 { font-size: 1.1em; }
.md-body p { margin: 0.7em 0; }
.md-body a { color: var(--md-accent); text-decoration: none; }
.md-body a:hover { text-decoration: underline; }
.md-body ul, .md-body ol { padding-left: 1.6em; margin: 0.6em 0; }
.md-body li { margin: 0.25em 0; }
.md-body blockquote {
  margin: 0.9em 0;
  padding: 0.4em 1em;
  border-left: 4px solid var(--md-accent);
  background: var(--md-quote-bg);
  border-radius: 4px;
  color: var(--md-muted);
}
.md-body code {
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 0.875em;
  background: var(--md-code-bg);
  padding: 0.2em 0.4em;
  border-radius: 5px;
}
.md-body pre.hljs {
  margin: 0.9em 0;
  padding: 14px 16px;
  background: var(--md-pre-bg);
  border: 1px solid var(--md-border);
  border-radius: 10px;
  overflow-x: auto;
  font-size: 13.5px;
  line-height: 1.6;
}
.md-body pre.hljs code { background: transparent; padding: 0; font-size: inherit; }
.md-body table { border-collapse: collapse; margin: 0.9em 0; width: auto; max-width: 100%; display: block; overflow-x: auto; }
.md-body th, .md-body td { border: 1px solid var(--md-border); padding: 6px 14px; }
.md-body th { background: var(--md-fill, rgba(128,128,128,0.08)); font-weight: 600; }
.md-body hr { border: none; border-top: 1px solid var(--md-border); margin: 1.6em 0; }
.md-body img { max-width: 100%; border-radius: 6px; }
.md-body .task-list-item { list-style: none; margin-left: -1.2em; }
.md-body .task-list-item input { margin-right: 0.5em; pointer-events: none; }
.md-body .md-toc {
  background: var(--md-quote-bg);
  border: 1px solid var(--md-border);
  border-radius: 10px;
  padding: 12px 18px;
  margin: 1em 0;
}
.md-body .md-toc p { margin: 0.3em 0; font-weight: 600; }
.md-body .md-toc ul { margin: 0.2em 0; }
.md-body .katex-display { overflow-x: auto; padding: 6px 0; }
.md-body .katex { color: inherit; }

/* 代码高亮配色：浅色系（github/minimal/sepia 共用基色，主题可微调） */
.md-body .hljs-comment, .md-body .hljs-quote { color: #6e7781; font-style: italic; }
.md-body .hljs-keyword, .md-body .hljs-selector-tag, .md-body .hljs-literal { color: #cf222e; }
.md-body .hljs-string, .md-body .hljs-regexp, .md-body .hljs-addition { color: #0a3069; }
.md-body .hljs-number, .md-body .hljs-symbol, .md-body .hljs-bullet { color: #0550ae; }
.md-body .hljs-title, .md-body .hljs-section { color: #8250df; font-weight: 600; }
.md-body .hljs-attr, .md-body .hljs-attribute, .md-body .hljs-variable, .md-body .hljs-template-variable { color: #953800; }
.md-body .hljs-type, .md-body .hljs-built_in, .md-body .hljs-class { color: #116329; }
.md-body .hljs-tag, .md-body .hljs-name { color: #116329; }
.md-body .hljs-meta { color: #57606a; }
.md-body .hljs-deletion { color: #82071e; background: #ffebe9; }

/* ---------- 主题：GitHub（浅色） ---------- */
.md-body.theme-github {
  --md-bg: #ffffff;
  --md-fg: #1f2328;
  --md-muted: #59636e;
  --md-border: #d1d9e0;
  --md-accent: #0969da;
  --md-code-bg: rgba(129, 139, 152, 0.12);
  --md-pre-bg: #f6f8fa;
  --md-quote-bg: rgba(105, 122, 141, 0.08);
  --md-fill: rgba(129, 139, 152, 0.1);
}

/* ---------- 主题：极简 ---------- */
.md-body.theme-minimal {
  --md-bg: #fdfdfd;
  --md-fg: #24292f;
  --md-muted: #6b7280;
  --md-border: #e5e7eb;
  --md-accent: #111827;
  --md-code-bg: rgba(0, 0, 0, 0.05);
  --md-pre-bg: #f7f7f8;
  --md-quote-bg: transparent;
  --md-fill: rgba(0, 0, 0, 0.03);
  font-family: Georgia, 'Songti SC', 'SimSun', serif;
}
.md-body.theme-minimal .hljs-comment { color: #9ca3af; }
.md-body.theme-minimal .hljs-keyword, .md-body.theme-minimal .hljs-selector-tag, .md-body.theme-minimal .hljs-literal { color: #374151; font-weight: 600; }
.md-body.theme-minimal .hljs-string, .md-body.theme-minimal .hljs-addition { color: #4b5563; }
.md-body.theme-minimal .hljs-number, .md-body.theme-minimal .hljs-symbol { color: #6b7280; }
.md-body.theme-minimal .hljs-title, .md-body.theme-minimal .hljs-section { color: #111827; }

/* ---------- 主题：书卷（暖纸） ---------- */
.md-body.theme-sepia {
  --md-bg: #f8f2e7;
  --md-fg: #3d3229;
  --md-muted: #8a7a66;
  --md-border: #ded1b8;
  --md-accent: #a8642a;
  --md-code-bg: rgba(168, 100, 42, 0.1);
  --md-pre-bg: #f3ecdd;
  --md-quote-bg: rgba(168, 100, 42, 0.08);
  --md-fill: rgba(168, 100, 42, 0.08);
  font-family: 'Songti SC', Georgia, 'SimSun', serif;
}
.md-body.theme-sepia .hljs-comment { color: #a08c72; }
.md-body.theme-sepia .hljs-keyword, .md-body.theme-sepia .hljs-selector-tag, .md-body.theme-sepia .hljs-literal { color: #a8642a; }
.md-body.theme-sepia .hljs-string, .md-body.theme-sepia .hljs-addition { color: #6b7d3c; }
.md-body.theme-sepia .hljs-number, .md-body.theme-sepia .hljs-symbol { color: #b0682a; }
.md-body.theme-sepia .hljs-title, .md-body.theme-sepia .hljs-section { color: #7a4b1e; }

/* ---------- 主题：暗夜 ---------- */
.md-body.theme-dark {
  --md-bg: #0d1117;
  --md-fg: #e6edf3;
  --md-muted: #8b949e;
  --md-border: #30363d;
  --md-accent: #4493f8;
  --md-code-bg: rgba(110, 118, 129, 0.25);
  --md-pre-bg: #161b22;
  --md-quote-bg: rgba(110, 118, 129, 0.12);
  --md-fill: rgba(110, 118, 129, 0.15);
  --md-mark: #bb8009;
}
.md-body.theme-dark .hljs-comment, .md-body.theme-dark .hljs-quote { color: #8b949e; }
.md-body.theme-dark .hljs-keyword, .md-body.theme-dark .hljs-selector-tag, .md-body.theme-dark .hljs-literal { color: #ff7b72; }
.md-body.theme-dark .hljs-string, .md-body.theme-dark .hljs-regexp, .md-body.theme-dark .hljs-addition { color: #a5d6ff; }
.md-body.theme-dark .hljs-number, .md-body.theme-dark .hljs-symbol, .md-body.theme-dark .hljs-bullet { color: #79c0ff; }
.md-body.theme-dark .hljs-title, .md-body.theme-dark .hljs-section { color: #d2a8ff; font-weight: 600; }
.md-body.theme-dark .hljs-attr, .md-body.theme-dark .hljs-attribute, .md-body.theme-dark .hljs-variable, .md-body.theme-dark .hljs-template-variable { color: #ffa657; }
.md-body.theme-dark .hljs-type, .md-body.theme-dark .hljs-built_in, .md-body.theme-dark .hljs-class { color: #7ee787; }
.md-body.theme-dark .hljs-tag, .md-body.theme-dark .hljs-name { color: #7ee787; }
.md-body.theme-dark .hljs-meta { color: #8b949e; }
.md-body.theme-dark .hljs-deletion { color: #ffdcd7; background: #67060c; }
`

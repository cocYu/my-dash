/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module '*?inline' {
  const css: string
  export default css
}

declare module 'markdown-it-task-lists'
declare module 'markdown-it-table-of-contents'
declare module 'markdown-it-texmath'

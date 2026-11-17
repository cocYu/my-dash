// 自定义协议的特权声明（plugin:// 插件、attach:// 笔记图片附件）。
// 必须在 app ready 之前执行（本模块被 main/index.ts 顶层 import，时序即满足），
// 否则 standard/secure 等特权不生效。
import { protocol } from 'electron'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'plugin',
    privileges: {
      standard: true, // 使 plugin://host/path 具备正常 URL 结构（host/path 解析）
      secure: true, // 视为安全上下文，允许被页面 import
      supportFetchAPI: true,
      corsEnabled: true, // ESM 跨源 import 需要 CORS 通道（handler 内再回 ACAO 头）
      stream: true
    }
  },
  {
    scheme: 'attach',
    privileges: {
      standard: true, // attach://<文件名> 按 URL 解析
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true, // 渲染页（dev server 源）跨源加载 <img src="attach://…">
      stream: true
    }
  }
])

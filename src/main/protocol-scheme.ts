// plugin:// 自定义协议的特权声明。
// 必须在 app ready 之前执行（本模块被 main/index.ts 顶层 import，时序即满足），
// 否则 standard/secure 等特权不生效，渲染层无法 ESM import 插件代码。
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
  }
])

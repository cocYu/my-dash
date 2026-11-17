// 工具箱后端接口：通用 HTTP 代理（简易 Postman 用）。
// 渲染层受 CORS 限制无法直连任意域，统一走本机 Go 后端转发（带 SSRF 防护/超时/体积上限）。
import { request } from './http'

export interface ProxyResult {
  status: number
  statusText: string
  headers: Record<string, string>
  /** 响应体字节数（截断前实际读取量） */
  size: number
  truncated: boolean
  durationMs: number
  /** 文本响应（后端按 UTF-8 可解码且无 NUL 判定） */
  bodyText?: string
  /** 二进制响应的 base64 */
  bodyBase64?: string
}

export interface ProxyOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  /** 毫秒，后端上限 60s */
  timeoutMs?: number
}

/** 经本机后端代理发送任意 HTTP 请求 */
export function sendProxyRequest(opts: ProxyOptions): Promise<ProxyResult> {
  return request({
    url: '/api/tools/proxy',
    method: 'POST',
    data: opts,
    // 全局实例默认 10s；代理上限 60s，放宽到 65s 留出余量
    timeout: 65000
  })
}

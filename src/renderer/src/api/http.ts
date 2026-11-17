import axios, { type AxiosRequestConfig, type AxiosInstance } from 'axios'
import { ElMessage } from 'element-plus'

/** 后端统一响应结构 */
export interface ApiResp<T = unknown> {
  code: number
  message: string
  data: T
}

export const http: AxiosInstance = axios.create({ timeout: 10000 })

/** 运行时元信息（initHttp 后可用） */
export const appMeta = {
  electronVersion: '',
  appVersion: '',
  userDataPath: ''
}

/** 从 preload 获取后端配置并设置到 axios 默认值 */
export async function initHttp(): Promise<void> {
  if (!window.api) {
    throw new Error('window.api 不存在：preload 未加载（请勿在普通浏览器中打开渲染页）')
  }
  const config = await window.api.getBackendConfig()
  http.defaults.baseURL = config.baseUrl
  http.defaults.headers.common['X-API-Token'] = config.token
  appMeta.electronVersion = config.electronVersion
  appMeta.appVersion = config.appVersion
  appMeta.userDataPath = config.userDataPath
}

http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const body = error?.response?.data as ApiResp | undefined
    const message =
      body?.message ?? error?.message ?? '网络错误，请确认后端服务已启动'
    ElMessage.error(message)
    return Promise.reject(error)
  }
)

/** 请求并解包统一响应：失败（code != 0）直接抛错 */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const resp = await http.request<ApiResp<T>>(config)
  const body = resp.data
  if (body.code !== 0) {
    ElMessage.error(body.message || '请求失败')
    throw new Error(body.message || '请求失败')
  }
  return body.data
}

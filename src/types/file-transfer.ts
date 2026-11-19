/** 文件互传（局域网直传）的共享类型 */

/** 服务运行状态与访问信息 */
export interface TransferStatus {
  running: boolean
  port: number
  /** 访问码：URL 的 ?k= 参数，同网段无码不可访问 */
  token: string
  /** 可访问地址（带访问码），按私有网段优先排序 */
  urls: string[]
  /** 首个地址的二维码 dataURL，未运行为空串 */
  qrDataUrl: string
  /** 当前生效的存放目录（自定义或默认） */
  dir: string
  /** 默认目录（userData/file-transfer），用于「恢复默认」提示 */
  defaultDir: string
  /** 用户自定义目录；空串表示使用默认 */
  customDir: string
  fileCount: number
}

/** 已收到的文件（互传目录内的条目） */
export interface TransferFile {
  name: string
  size: number
  modifiedAt: string
}

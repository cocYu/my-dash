// 主进程与渲染层共享的同步类型定义（放在中立目录，双端 tsconfig 均包含）。
export interface WebDavConfig {
  url: string
  username: string
  password: string
}

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  pathStyle: boolean
}

export interface SyncSchedule {
  enabled: boolean
  mode: 'interval' | 'daily'
  intervalHours: number
  /** daily 模式的执行时间，格式 HH:mm */
  dailyTime: string
}

export interface SyncConfig {
  target: 'webdav' | 's3'
  remotePath: string
  keepLast: number
  webdav: WebDavConfig
  s3: S3Config
  schedule: SyncSchedule
  lastRunAt?: string
  lastSuccessAt?: string
}

export interface SyncHistoryRecord {
  id: string
  time: string
  trigger: 'manual' | 'scheduled'
  direction: 'backup' | 'restore'
  target: 'webdav' | 's3'
  remoteFile?: string
  size?: number
  durationMs?: number
  status: 'success' | 'failed'
  error?: string
  /** 远端文件已按保留份数清理（记录保留，文件已不在） */
  purged?: boolean
}

/** 云端实际存在的备份（list 远端目录得到，与本地历史无关，供换机恢复） */
export interface RemoteBackupRecord {
  /** 还原时回传的远端文件标识：WebDAV 为「目录/文件名」，S3 为对象 key */
  remoteFile: string
  /** 备份文件名（mydash-backup-YYYYMMDD-HHMMSS.zip） */
  name: string
  /** 从文件名解析出的备份时间（ISO），非备份命名规则的文件为 undefined */
  time?: string
  size?: number
  /** 云端报告的最后修改时间（ISO），仅作展示兜底 */
  lastModified?: string
}

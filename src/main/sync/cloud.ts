// 云端传输抽象：WebDAV 与 S3 两种目标的上传/下载/删除/列举/连通性测试。
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3'
import { createClient, type WebDAVClient, type FileStat } from 'webdav'
import fs from 'node:fs'
import type { SyncConfig } from './config'
import type { RemoteBackupRecord } from '../../types/sync'

/** 备份文件命名规则（与 service.ts 的 backupFileName 对应） */
const BACKUP_NAME_RE = /^mydash-backup-\d{8}-\d{6}\.zip$/

/** 从备份文件名解析 ISO 时间：mydash-backup-20261117-220412.zip -> 2026-11-17T22:04:12 */
export function backupTimeOf(name: string): string | undefined {
  const m = /^mydash-backup-(\d{8})-(\d{6})\.zip$/.exec(name)
  if (!m) return undefined
  const [, d, t] = m
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`
}

export type CloudKind = 'webdav' | 's3'

function webdavClient(cfg: SyncConfig): WebDAVClient {
  const { url, username, password } = cfg.webdav
  if (!url) throw new Error('WebDAV 地址未配置')
  return createClient(url.endsWith('/') ? url : `${url}/`, {
    username: username || undefined,
    password: password || undefined
  })
}

function s3Client(cfg: SyncConfig): S3Client {
  const { endpoint, region, accessKeyId, secretAccessKey, pathStyle } = cfg.s3
  if (!endpoint || !bucketOf(cfg)) throw new Error('S3 配置不完整（endpoint / bucket）')
  return new S3Client({
    region: region || 'auto',
    endpoint,
    forcePathStyle: pathStyle,
    credentials: { accessKeyId: accessKeyId || '', secretAccessKey: secretAccessKey || '' }
  })
}

function bucketOf(cfg: SyncConfig): string {
  return cfg.s3.bucket
}

/** 远端路径 -> webdav url / s3 key */
function remoteLocation(cfg: SyncConfig, remoteFile: string): string {
  const dir = (cfg.remotePath || '/mydash-backup').replace(/\/+$/, '')
  const name = remoteFile.split('/').pop() ?? remoteFile
  return cfg.target === 'webdav' ? `${dir}/${name}` : name
}

export async function cloudUpload(cfg: SyncConfig, remoteFile: string, localFile: string): Promise<void> {
  const data = fs.readFileSync(localFile)
  if (cfg.target === 'webdav') {
    const client = webdavClient(cfg)
    // 远端目录不存在时先创建（递归 MKCOL，已存在时忽略错误）
    const dir = remoteLocation(cfg, remoteFile).split('/').slice(0, -1).join('/')
    if (dir) {
      await client.createDirectory(dir, { recursive: true }).catch(() => undefined)
    }
    await client.putFileContents(remoteLocation(cfg, remoteFile), data, { overwrite: true })
    return
  }
  const client = s3Client(cfg)
  await client.send(new PutObjectCommand({ Bucket: bucketOf(cfg), Key: remoteLocation(cfg, remoteFile), Body: data }))
}

export async function cloudDownload(cfg: SyncConfig, remoteFile: string, localFile: string): Promise<void> {
  if (cfg.target === 'webdav') {
    const buf = (await webdavClient(cfg).getFileContents(remoteLocation(cfg, remoteFile))) as Buffer
    fs.writeFileSync(localFile, buf)
    return
  }
  const client = s3Client(cfg)
  const res = await client.send(new GetObjectCommand({ Bucket: bucketOf(cfg), Key: remoteLocation(cfg, remoteFile) }))
  if (!res.Body) throw new Error('S3 响应缺少文件内容')
  const bytes = await res.Body.transformToByteArray()
  fs.writeFileSync(localFile, Buffer.from(bytes))
}

export async function cloudDelete(cfg: SyncConfig, remoteFile: string): Promise<void> {
  if (cfg.target === 'webdav') {
    await webdavClient(cfg).deleteFile(remoteLocation(cfg, remoteFile))
    return
  }
  const client = s3Client(cfg)
  await client.send(new DeleteObjectCommand({ Bucket: bucketOf(cfg), Key: remoteLocation(cfg, remoteFile) }))
}

/** 列举云端实际存在的备份（按备份时间倒序）；换新设备拉取备份列表用 */
export async function cloudList(cfg: SyncConfig): Promise<RemoteBackupRecord[]> {
  const list: RemoteBackupRecord[] =
    cfg.target === 'webdav' ? await listWebdav(cfg) : await listS3(cfg)
  // time 来自文件名，等价于按文件名倒序
  return list.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
}

async function listWebdav(cfg: SyncConfig): Promise<RemoteBackupRecord[]> {
  const dir = (cfg.remotePath || '/mydash-backup').replace(/\/+$/, '')
  let items: FileStat[]
  try {
    items = await webdavClient(cfg).getDirectoryContents(dir)
  } catch (err) {
    // 目录尚不存在 = 云端还没有任何备份
    const status = (err as { status?: number; statusCode?: number }).status ??
      (err as { statusCode?: number }).statusCode
    if (status === 404) return []
    throw err
  }
  return items
    .filter((it) => it.type === 'file' && BACKUP_NAME_RE.test(it.basename))
    .map((it) => ({
      remoteFile: `${dir}/${it.basename}`,
      name: it.basename,
      time: backupTimeOf(it.basename),
      size: it.size,
      lastModified: it.lastmod
    }))
}

async function listS3(cfg: SyncConfig): Promise<RemoteBackupRecord[]> {
  // 与 remoteLocation 一致：S3 的对象 key 即纯文件名（目录前缀不参与）
  const res = await s3Client(cfg).send(new ListObjectsV2Command({ Bucket: bucketOf(cfg) }))
  return (res.Contents ?? [])
    .filter((o): o is { Key: string; Size?: number; LastModified?: Date } => !!o.Key && BACKUP_NAME_RE.test(o.Key))
    .map((o) => ({
      remoteFile: o.Key,
      name: o.Key,
      time: backupTimeOf(o.Key),
      size: o.Size,
      lastModified: o.LastModified?.toISOString()
    }))
}

/** 连通性测试：失败时抛错（message 面向用户展示） */
export async function cloudTest(cfg: SyncConfig): Promise<void> {
  if (cfg.target === 'webdav') {
    // 只验证服务可达与凭据有效；远端目录在上传时自动创建
    await webdavClient(cfg).getDirectoryContents('/')
    return
  }
  const client = s3Client(cfg)
  await client.send(new HeadBucketCommand({ Bucket: bucketOf(cfg) }))
}

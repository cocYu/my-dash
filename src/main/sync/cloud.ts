// 云端传输抽象：WebDAV 与 S3 两种目标的上传/下载/删除/连通性测试。
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { createClient, type WebDAVClient } from 'webdav'
import fs from 'node:fs'
import type { SyncConfig } from './config'

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

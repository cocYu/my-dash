// AI 生图：文生图 /images/generations 与图生图 /images/edits（OpenAI Images API 风格）。
// 生成的图片落到笔记附件库（内容寻址），返回 attach:// 可用的文件名 + 预览 dataUrl。
// 注意：Anthropic messages 协议供应商不提供 Images API，界面侧需提示用户改用 OpenAI 兼容供应商。
import type { AiImageRequest, AiImageResult, AiProvider } from '../../types/ai'
import { extFromMime, storeImage } from '../attachments'

const DEFAULT_TIMEOUT = 180_000

function apiBase(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (!b) throw new Error('接口地址未配置')
  if (/\/v\d+$/.test(b)) return b
  return `${b}/v1`
}

function bearer(provider: AiProvider): string {
  if (!provider.apiKey) throw new Error(`供应商「${provider.name}」尚未配置 API Key`)
  return `Bearer ${provider.apiKey}`
}

/** data URI → { bytes, mime } */
function decodeDataUri(uri: string): { bytes: Buffer; mime: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(uri)
  if (!m) throw new Error('输入图片格式无效（需为 base64 data URI）')
  return { bytes: Buffer.from(m[2], 'base64'), mime: m[1] }
}

/** 从结果项取图片：优先 b64_json，其次 url（下载） */
async function extractImage(item: Record<string, unknown>, token: string): Promise<Buffer> {
  if (typeof item.b64_json === 'string' && item.b64_json) {
    return Buffer.from(item.b64_json, 'base64')
  }
  if (typeof item.url === 'string' && item.url) {
    const res = await fetch(item.url, {
      headers: { authorization: token },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
    })
    if (!res.ok) throw new Error(`下载生成图片失败：HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error('生图响应中未找到图片数据（b64_json / url）')
}

/** 从图片字节推断扩展名（响应可能不含 mime 字段） */
function guessExt(bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return '.png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return '.gif'
  if (bytes.slice(8, 12).toString('ascii') === 'WEBP') return '.webp'
  return '.png'
}

/** 从图片字节头解析真实像素尺寸（PNG / JPEG / GIF / WEBP），失败返回 undefined */
function imageDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  try {
    if (bytes.length < 24) return undefined
    // PNG：IHDR 中宽高为大端 32 位，偏移 16 / 20
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const width = bytes.readUInt32BE(16)
      const height = bytes.readUInt32BE(20)
      return width && height ? { width, height } : undefined
    }
    // GIF：小端 16 位，偏移 6 / 8
    if (bytes.slice(0, 3).toString('ascii') === 'GIF') {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
    }
    // JPEG：扫描 SOF 段（C0-CF，排除 C4 霍夫曼 / C8 JPG / CC DAC）
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i += 1; continue }
        const marker = bytes[i + 1]
        if (marker === 0xff || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        const len = bytes.readUInt16BE(i + 2)
        if (len < 2) break
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = bytes.readUInt16BE(i + 5)
          const width = bytes.readUInt16BE(i + 7)
          return width && height ? { width, height } : undefined
        }
        i += 2 + len
      }
      return undefined
    }
    // WEBP：VP8X / VP8L / VP8 三种子格式宽高位置不同
    if (bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP') {
      const fmt = bytes.slice(12, 16).toString('ascii')
      if (fmt === 'VP8X') {
        return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
      }
      if (fmt === 'VP8L') {
        const bits = bytes.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      }
      if (fmt === 'VP8 ') {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
      }
    }
  } catch {
    /* 尺寸解析失败不影响生图主流程 */
  }
  return undefined
}

async function toResult(bytes: Buffer, mimeHint?: string): Promise<AiImageResult> {
  const mime = mimeHint ?? ''
  const ext = extFromMime(mime) ?? guessExt(bytes)
  const name = storeImage(bytes, ext)
  const resultMime = mime || (ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`)
  const dims = imageDimensions(bytes)
  return {
    name,
    dataUrl: `data:${resultMime};base64,${bytes.toString('base64')}`,
    ...(dims ? dims : {})
  }
}

/** 统一生图入口 */
export async function generateImage(provider: AiProvider, req: AiImageRequest): Promise<AiImageResult[]> {
  const token = bearer(provider)
  const base = apiBase(provider.baseUrl)
  let res: Response

  if (req.mode === 'image2image') {
    // 图生图：multipart/form-data，image 字段可多张
    const images = req.inputImages ?? []
    if (images.length === 0) throw new Error('图生图至少需要一张输入图片')
    const form = new FormData()
    form.append('model', req.model)
    form.append('prompt', req.prompt)
    if (req.size) form.append('size', req.size)
    if (req.n) form.append('n', String(req.n))
    if (req.quality) form.append('quality', req.quality)
    for (const uri of images) {
      const { bytes, mime } = decodeDataUri(uri)
      const ext = extFromMime(mime) ?? guessExt(bytes)
      form.append('image[]', new Blob([new Uint8Array(bytes)], { type: mime || 'application/octet-stream' }), `input${ext}`)
    }
    res = await fetch(`${base}/images/edits`, {
      method: 'POST',
      headers: { authorization: token },
      body: form,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
    })
  } else {
    // 文生图：JSON
    res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        n: req.n ?? 1,
        ...(req.size ? { size: req.size } : {}),
        ...(req.quality ? { quality: req.quality } : {}),
        response_format: 'b64_json'
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
    })
  }

  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const body = JSON.parse(text) as Record<string, unknown>
      const err = body.error as Record<string, unknown> | string | undefined
      if (typeof err === 'object' && err && typeof err.message === 'string') detail = err.message
      else if (typeof err === 'string') detail = err
    } catch {
      /* 用原文 */
    }
    throw new Error(`生图失败 HTTP ${res.status}：${String(detail).slice(0, 500)}`)
  }

  const body = JSON.parse(text) as { data?: Record<string, unknown>[] }
  const items = body.data
  if (!Array.isArray(items) || items.length === 0) throw new Error('生图响应中没有图片数据')
  const results: AiImageResult[] = []
  for (const item of items) {
    const bytes = await extractImage(item, token)
    results.push(await toResult(bytes, typeof item.content_type === 'string' ? item.content_type : undefined))
  }
  return results
}

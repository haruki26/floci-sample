import { handle } from '@hono/aws-lambda'
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import type { ImageItem } from './view'
import { GalleryPage } from './view'

const MAX_FILE_SIZE = 4 * 1024 * 1024
const MAX_REQUEST_SIZE = 5 * 1024 * 1024
const PAGE_SIZE = 60
const validKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i
const mimeExtensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
}

function matchesImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/gif') return bytes.length >= 6 && ['GIF87a','GIF89a'].includes(new TextDecoder().decode(bytes.subarray(0, 6)))
  if (mime === 'image/webp') return bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8,12)) === 'WEBP'
  return false
}

export function createApp(s3: Pick<S3Client, 'send'>, bucket: string, basePath = '') {
  const prefix = basePath.replace(/\/+$/, '')
  const app = new Hono()
  app.use('*', async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
  })

  app.get('/', async (c) => {
    try {
      const cursor = c.req.query('cursor')
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: PAGE_SIZE, ...(cursor ? { ContinuationToken: cursor } : {}) }))
      const images: ImageItem[] = (page.Contents ?? []).filter((item) => item.Key && validKey.test(item.Key)).map((item) => ({
        key: item.Key!, url: `${prefix}/images/${item.Key}`, name: item.Key!, size: item.Size ?? 0, uploadedAt: item.LastModified?.toISOString() ?? '',
      }))
      return c.html(<GalleryPage images={images} basePath={prefix} nextPage={page.NextContinuationToken ? `${prefix}/?cursor=${encodeURIComponent(page.NextContinuationToken)}` : undefined} uploaded={c.req.query('uploaded') === '1'} />)
    } catch {
      return c.html(<GalleryPage images={[]} basePath={prefix} error="画像を読み込めませんでした。時間をおいて再度お試しください。" />, 503)
    }
  })

  app.post('/images', async (c) => {
    let form: FormData
    try {
      const contentLength = Number(c.req.header('content-length') ?? 0)
      if (contentLength > MAX_REQUEST_SIZE) return c.text('画像は4MiB以下にしてください。', 413)
      const raw = await c.req.arrayBuffer()
      if (raw.byteLength > MAX_REQUEST_SIZE) return c.text('画像は4MiB以下にしてください。', 413)
      form = await new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: raw }).formData()
    } catch {
      return c.text('正しい画像フォームを送信してください。', 400)
    }
    try {
      const file = form.get('image')
      if (!(file instanceof File) || file.size === 0) return c.text('画像ファイルを選択してください。', 400)
      if (file.size > MAX_FILE_SIZE) return c.text('画像は4MiB以下にしてください。', 413)
      const extension = mimeExtensions[file.type]
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!extension || !matchesImage(bytes, file.type)) return c.text('PNG、JPEG、GIF、WebP画像を選択してください。', 400)
      const key = `${crypto.randomUUID()}.${extension}`
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: file.type }))
      return c.redirect(`${prefix}/?uploaded=1`, 303)
    } catch {
      return c.text('画像を保存できませんでした。時間をおいて再度お試しください。', 503)
    }
  })

  app.get('/images/:key', async (c) => {
    const { key } = c.req.param()
    if (!validKey.test(key)) return c.text('画像が見つかりません。', 404)
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!result.Body) return c.text('画像が見つかりません。', 404)
      const bytes = await result.Body.transformToByteArray()
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      return c.body(body, 200, { 'Content-Type': result.ContentType ?? `image/${key.split('.').pop()}`, 'Cache-Control': 'private, max-age=3600' })
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      const name = (error as { name?: string }).name
      return statusCode === 404 || name === 'NoSuchKey' || name === 'NotFound'
        ? c.text('画像が見つかりません。', 404)
        : c.text('画像を読み込めませんでした。時間をおいて再度お試しください。', 503)
    }
  })
  return app
}

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  region: process.env.AWS_REGION ?? 'us-east-1',
})
const app = createApp(s3, process.env.BUCKET_NAME ?? '', process.env.BASE_PATH ?? '')
export const createHandler = (client: Pick<S3Client, 'send'>, bucket: string, basePath = '') => handle(createApp(client, bucket, basePath))
export const handler = handle(app)
export default app

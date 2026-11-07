const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createApp, createHandler } = require('../dist/index.js')
const key = '123e4567-e89b-42d3-a456-426614174000.png'
const png = Uint8Array.from([137,80,78,71,13,10,26,10])

function lambdaEvent(path, method, body, contentType, query = '') {
  return {
    version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: query,
    headers: { 'content-type': contentType }, requestContext: { http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' } },
    isBase64Encoded: true, body: Buffer.from(body).toString('base64'),
  }
}

test('upload stores signature-verified images with an opaque key', async () => {
  let put
  const app = createApp({ async send(command) { put = command; return {} } }, 'gallery')
  const form = new FormData()
  form.append('image', new Blob([png], { type: 'image/png' }), 'hello.png')
  const response = await app.request('/images', { method: 'POST', body: form })
  assert.equal(response.status, 303)
  const input = put.input
  assert.ok(input.Key && input.Body)
  assert.match(input.Key, /^[0-9a-f-]{36}\.png$/)
  assert.deepEqual([...input.Body], [...png])
})

test('rejects mismatched and oversized upload content before storing', async () => {
  let calls = 0
  const app = createApp({ async send() { calls++; return {} } }, 'gallery')
  const form = new FormData()
  form.append('image', new Blob(['not png'], { type: 'image/png' }), 'bad.png')
  assert.equal((await app.request('/images', { method: 'POST', body: form })).status, 400)
  const tooBig = new FormData()
  tooBig.append('image', new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'image/png' }), 'big.png')
  assert.equal((await app.request('/images', { method: 'POST', body: tooBig })).status, 413)
  assert.equal(calls, 0)
})

test('retrieves binary images and passes pagination cursor to S3', async () => {
  let listCommand
  const bytes = Uint8Array.from([1, 2, 3])
  const app = createApp({ async send(command) {
    if (command.input.Key) return { Body: { transformToByteArray: async () => bytes }, ContentType: 'image/png' }
    listCommand = command
    return { Contents: [], NextContinuationToken: 'next' }
  } }, 'gallery')
  const image = await app.request('/images/123e4567-e89b-42d3-a456-426614174000.png')
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [...bytes])
  const list = await app.request('/?cursor=opaque')
  assert.equal(list.status, 200)
  assert.equal(listCommand.input.ContinuationToken, 'opaque')
})

test('prefixes gallery links, form action, pagination, and upload redirect', async () => {
  const prefix = '/restapis/ad8f5e7018/local/_user_request_'
  const app = createApp({ async send(command) {
    if (command.input.Body) return {}
    return {
      Contents: [{ Key: key, Size: png.length, LastModified: new Date('2026-01-01T00:00:00Z') }],
      NextContinuationToken: 'cursor/token',
    }
  } }, 'gallery', `${prefix}/`)
  const gallery = await app.request('/')
  const html = await gallery.text()
  assert.match(html, new RegExp(`action="${prefix}/images"`))
  assert.match(html, new RegExp(`src="${prefix}/images/${key}"`))
  assert.match(html, new RegExp(`href="${prefix}/images/${key}"`))
  assert.match(html, new RegExp(`href="${prefix}/\\?cursor=cursor%2Ftoken"`))

  const form = new FormData()
  form.append('image', new Blob([png], { type: 'image/png' }), 'upload.png')
  const uploaded = await app.request('/images', { method: 'POST', body: form })
  assert.equal(uploaded.status, 303)
  assert.equal(uploaded.headers.get('location'), `${prefix}/?uploaded=1`)
})

test('rejects missing files and malformed multipart with 400', async () => {
  const app = createApp({ async send() { throw Error('must not store') } }, 'gallery')
  const empty = new FormData()
  assert.equal((await app.request('/images', { method: 'POST', body: empty })).status, 400)
  const emptyFile = new FormData()
  emptyFile.append('image', new Blob([], { type: 'image/png' }), 'empty.png')
  assert.equal((await app.request('/images', { method: 'POST', body: emptyFile })).status, 400)
  assert.equal((await app.request('/images', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=bad' }, body: 'not multipart' })).status, 400)
})

test('accepts every supported image signature and rejects invalid keys', async () => {
  const cases = [
    ['image/png', [137,80,78,71,13,10,26,10]], ['image/jpeg', [255,216,255]],
    ['image/gif', [...Buffer.from('GIF89a')]], ['image/webp', [...Buffer.from('RIFF0000WEBP')]],
  ]
  const app = createApp({ async send(command) { assert.ok(command.input.Key && command.input.Body); return {} } }, 'gallery')
  for (const [type, bytes] of cases) {
    const form = new FormData()
    form.append('image', new Blob([Uint8Array.from(bytes)], { type }), 'file')
    assert.equal((await app.request('/images', { method: 'POST', body: form })).status, 303)
  }
  const invalid = createApp({ async send() { throw Error('must not fetch') } }, 'gallery')
  assert.equal((await invalid.request('/images/not-a-key.png')).status, 404)
})

test('returns 503 for S3 failures and 404 for missing objects', async () => {
  const list = createApp({ async send() { throw Error('internal detail') } }, 'gallery')
  assert.equal((await list.request('/')).status, 503)
  const put = createApp({ async send() { throw Error('internal detail') } }, 'gallery')
  const form = new FormData()
  form.append('image', new Blob([png], { type: 'image/png' }), 'valid.png')
  assert.equal((await put.request('/images', { method: 'POST', body: form })).status, 503)
  const missing = createApp({ async send() { const e = Error('missing'); e.name = 'NoSuchKey'; throw e } }, 'gallery')
  assert.equal((await missing.request(`/images/${key}`)).status, 404)
  const emptyObject = createApp({ async send() { return {} } }, 'gallery')
  assert.equal((await emptyObject.request(`/images/${key}`)).status, 404)
  const failed = createApp({ async send() { throw Error('internal detail') } }, 'gallery')
  const response = await failed.request(`/images/${key}`)
  assert.equal(response.status, 503)
  assert.equal((await response.text()).includes('internal detail'), false)
})

test('Lambda adapter decodes base64 multipart uploads and encodes binary downloads', async () => {
  const stored = []
  const handler = createHandler({ async send(command) {
    if (command.input.Body) { stored.push(command.input); return {} }
    if (command.input.Key) return { Body: { transformToByteArray: async () => png }, ContentType: 'image/png' }
    return { Contents: [] }
  } }, 'gallery', '/restapis/ad8f5e7018/local/_user_request_/')
  const boundary = 'unit-test-boundary'
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from(png), Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const uploaded = await handler(lambdaEvent('/images', 'POST', multipart, `multipart/form-data; boundary=${boundary}`))
  assert.equal(uploaded.statusCode, 303)
  assert.equal(uploaded.headers.location, '/restapis/ad8f5e7018/local/_user_request_/?uploaded=1')
  assert.equal(stored.length, 1)
  const downloaded = await handler(lambdaEvent(`/images/${stored[0].Key}`, 'GET', Buffer.alloc(0), 'application/octet-stream'))
  assert.equal(downloaded.statusCode, 200)
  assert.equal(downloaded.isBase64Encoded, true)
  assert.deepEqual(Buffer.from(downloaded.body, 'base64'), Buffer.from(png))
})

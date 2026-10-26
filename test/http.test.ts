import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import { HttpError, http } from '../src/index.js'

// A real local server instead of a mocked fetch:
// /echo, also under any prefix such as /api/echo, responds with the received method, url, headers and body
// /reply?status=&type=&body= responds with the given status, Content-Type and body
// /slow?ms=&stage= waits ms before sending the headers, or before finishing the body when stage=body
// /auth responds 401 unless Authorization is "Bearer fresh", with the received body
// /flaky?key=&fail=&status=&retryAfter= fails the first `fail` requests for each key, with `status`
// or a dropped connection when status=drop, then responds with the attempt count, method and body
let server: Server
let base: string
const attempts = new Map<string, number>()

beforeAll(async () => {
    server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)

        if (url.pathname.endsWith('/echo')) {
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: Buffer.concat(chunks).toString(),
            }))
            return
        }

        if (url.pathname === '/auth') {
            const ok = req.headers.authorization === 'Bearer fresh'
            res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok, body: Buffer.concat(chunks).toString() }))
            return
        }

        if (url.pathname === '/flaky') {
            const key = String(url.searchParams.get('key'))
            const count = (attempts.get(key) ?? 0) + 1
            attempts.set(key, count)
            if (count <= Number(url.searchParams.get('fail'))) {
                const status = url.searchParams.get('status')
                if (status === 'drop') {
                    req.socket.destroy()
                    return
                }
                const retryAfter = url.searchParams.get('retryAfter')
                res.writeHead(Number(status), retryAfter === null ? {} : { 'retry-after': retryAfter })
                res.end('failed')
                return
            }
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ attempts: count, method: req.method, body: Buffer.concat(chunks).toString() }))
            return
        }

        if (url.pathname === '/slow') {
            if (url.searchParams.get('stage') === 'body') {
                res.writeHead(200, { 'content-type': 'text/plain' })
                res.write('partial ')
            }
            setTimeout(() => res.end('done'), Number(url.searchParams.get('ms')))
            return
        }

        res.statusCode = Number(url.searchParams.get('status') ?? 200)
        const type = url.searchParams.get('type')
        if (type) res.setHeader('content-type', type)
        res.end(url.searchParams.get('body') ?? '')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
}))

const reply = (status: number, type: string, body: string) =>
    http.get(`${base}/reply`, { query: { status, type, body } })

describe('HTTP methods', () => {
    it.each(['get', 'delete'] as const)('%s sends the matching method', async (method) => {
        // get and delete only differ in whether options.body is allowed
        const send: typeof http.delete = http[method]
        const echo = await send(`${base}/echo`)
        expect(echo.method).toBe(method.toUpperCase())
        expect(echo.body).toBe('')
    })

    it.each(['post', 'put', 'patch'] as const)('%s sends an object as JSON', async (method) => {
        const echo = await http[method](`${base}/echo`, { name: 'Hugo' })
        expect(echo.method).toBe(method.toUpperCase())
        expect(echo.headers['content-type']).toBe('application/json')
        expect(JSON.parse(echo.body)).toEqual({ name: 'Hugo' })
    })

    it('sends an array body as JSON', async () => {
        const echo = await http.post(`${base}/echo`, [1, 2])
        expect(echo.body).toBe('[1,2]')
    })

    it('omits Content-Type when there is no body', async () => {
        const echo = await http.post(`${base}/echo`)
        expect(echo.headers['content-type']).toBeUndefined()
        expect(echo.body).toBe('')
    })

    it('delete accepts a body through options.body', async () => {
        const echo = await http.delete(`${base}/echo`, { body: { ids: [1, 2] } })
        expect(JSON.parse(echo.body)).toEqual({ ids: [1, 2] })
    })

    it('get takes no body, and fetch rejects one passed anyway', async () => {
        // @ts-expect-error fetch does not allow a body on GET
        const error = await http.get(`${base}/echo`, { body: { a: 1 } }).catch((e) => e)
        expect(error).toBeInstanceOf(TypeError)
    })
})

describe('native bodies are sent as-is', () => {
    it('FormData gets its multipart boundary from fetch', async () => {
        const form = new FormData()
        form.append('name', 'Hugo')
        const echo = await http.post(`${base}/echo`, form)
        expect(echo.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
        expect(echo.body).toContain('Hugo')
    })

    it('URLSearchParams is sent form-encoded', async () => {
        const echo = await http.post(`${base}/echo`, new URLSearchParams({ a: '1' }))
        expect(echo.headers['content-type']).toContain('application/x-www-form-urlencoded')
        expect(echo.body).toBe('a=1')
    })

    it('a string is not JSON-stringified', async () => {
        const echo = await http.post(`${base}/echo`, 'hello')
        expect(echo.body).toBe('hello')
    })

    it('a ReadableStream is streamed without having to set duplex', async () => {
        const echo = await http.post(`${base}/echo`, new Blob(['streamed']).stream())
        expect(echo.body).toBe('streamed')
    })
})

describe('headers', () => {
    it('sends a default Accept so backends like Laravel return JSON errors', async () => {
        const echo = await http.get(`${base}/echo`)
        expect(echo.headers.accept).toBe('application/json, text/plain, */*')
    })

    it('user headers win and the passed object is not mutated', async () => {
        const headers = { 'Content-Type': 'application/vnd.api+json', Accept: 'text/html', 'X-Token': 'abc' }
        const echo = await http.post(`${base}/echo`, { a: 1 }, { headers })
        expect(echo.headers['content-type']).toBe('application/vnd.api+json')
        expect(echo.headers.accept).toBe('text/html')
        expect(echo.headers['x-token']).toBe('abc')
        expect(headers).toEqual({ 'Content-Type': 'application/vnd.api+json', Accept: 'text/html', 'X-Token': 'abc' })
    })

    it('does not send headers set to null or undefined', async () => {
        const echo = await http.get(`${base}/echo`, { headers: { 'X-A': null, 'X-B': undefined } })
        expect(echo.headers['x-a']).toBeUndefined()
        expect(echo.headers['x-b']).toBeUndefined()
    })
})

describe('query', () => {
    const urlOf = async (path: string, query: Parameters<typeof http.get>[1]) =>
        decodeURIComponent((await http.get(`${base}${path}`, query)).url)

    it('serializes primitives and uses key[] for arrays', async () => {
        expect(await urlOf('/echo', { query: { page: 1, active: true, q: 'a b', ids: [1, 2] } }))
            .toBe('/echo?page=1&active=true&q=a+b&ids[]=1&ids[]=2')
    })

    it('skips null and undefined, and adds no ? for an empty query', async () => {
        expect(await urlOf('/echo', { query: { a: null, b: undefined, c: [] } })).toBe('/echo')
        expect(await urlOf('/echo', { query: { a: null, b: 'x', c: [null, 1] } })).toBe('/echo?b=x&c[]=1')
    })

    it('appends to an existing query string', async () => {
        expect(await urlOf('/echo?sort=name', { query: { page: 2 } })).toBe('/echo?sort=name&page=2')
    })
})

describe('response parsing', () => {
    it('parses JSON types, including +json', async () => {
        expect(await reply(200, 'application/problem+json', '{"a":1}')).toEqual({ a: 1 })
    })

    it('returns a string for non-JSON types', async () => {
        expect(await reply(200, 'text/plain', 'hello')).toBe('hello')
    })

    it('returns undefined for 204 and empty bodies', async () => {
        expect(await reply(204, 'application/json', '')).toBeUndefined()
        expect(await reply(200, 'application/json', '')).toBeUndefined()
        expect(await reply(204, '', '')).toBeUndefined()
    })

    it('treats a whitespace-only JSON body as empty', async () => {
        expect(await reply(200, 'application/json', ' \n')).toBeUndefined()
    })

    it('throws SyntaxError when a successful response has malformed JSON', async () => {
        await expect(reply(200, 'application/json', '{oops')).rejects.toThrow(SyntaxError)
    })
})

describe('errors', () => {
    it('throws HttpError with status and parsed data on non-2xx', async () => {
        const error = await reply(422, 'application/json', '{"errors":{"name":["The name field is required."]}}').catch((e) => e)
        expect(error).toBeInstanceOf(HttpError)
        expect(error).toBeInstanceOf(Error)
        expect(error.name).toBe('HttpError')
        expect(error.status).toBe(422)
        expect(error.statusText).toBe('Unprocessable Entity')
        expect(error.data).toEqual({ errors: { name: ['The name field is required.'] } })
        expect(error.response).toBeInstanceOf(Response)
        expect(error.message).toMatch(/^HTTP 422 Unprocessable Entity: GET http:\/\/127\.0\.0\.1:\d+\/reply\?/)
    })

    it('keeps the raw text as data when an error body is malformed JSON', async () => {
        const error = await reply(500, 'application/json', '<html>oops').catch((e) => e)
        expect(error).toBeInstanceOf(HttpError)
        expect(error.data).toBe('<html>oops')
    })

    it('keeps network errors as native TypeError', async () => {
        const error = await http.get('http://127.0.0.1:1/').catch((e) => e)
        expect(error).toBeInstanceOf(TypeError)
        expect(error).not.toBeInstanceOf(HttpError)
    })

    it('keeps aborted requests as native AbortError', async () => {
        const error = await http.get(`${base}/echo`, { signal: AbortSignal.abort() }).catch((e) => e)
        expect(error.name).toBe('AbortError')
    })
})

describe('timeout', () => {
    it('aborts with a native TimeoutError when the headers arrive too late', async () => {
        const error = await http.get(`${base}/slow`, { query: { ms: 500 }, timeout: 50 }).catch((e) => e)
        expect(error).toBeInstanceOf(DOMException)
        expect(error.name).toBe('TimeoutError')
    })

    it('also covers reading the body', async () => {
        const error = await http.get(`${base}/slow`, { query: { ms: 500, stage: 'body' }, timeout: 50 }).catch((e) => e)
        expect(error.name).toBe('TimeoutError')
    })

    it('resolves normally when the response arrives in time', async () => {
        expect(await http.get(`${base}/slow`, { query: { ms: 10 }, timeout: 1000 })).toBe('done')
    })

    it('keeps a user abort as AbortError when a timeout is also set', async () => {
        const error = await http.get(`${base}/echo`, { signal: AbortSignal.abort(), timeout: 1000 }).catch((e) => e)
        expect(error.name).toBe('AbortError')
    })

    // 2 ** 31 would overflow the timer and abort almost immediately instead of failing
    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])('rejects timeout %s with a RangeError', async (timeout) => {
        const error = await http.get(`${base}/echo`, { timeout }).catch((e) => e)
        expect(error).toBeInstanceOf(RangeError)
        expect(error.message).toBe(`timeout must be an integer from 0 to 2147483647 milliseconds, got ${timeout}`)
    })

    it('accepts the largest timeout the timer can hold', async () => {
        expect((await http.get(`${base}/echo`, { timeout: 2 ** 31 - 1 })).method).toBe('GET')
    })
})

describe('responseType', () => {
    const replying = (type: string, body: string, status = 200) => ({ status, type, body })

    it('text returns the raw string, even for JSON', async () => {
        const text = await http.get(`${base}/reply`, {
            query: replying('application/json', '{"a":1}'),
            responseType: 'text',
        })
        expectTypeOf(text).toEqualTypeOf<string>()
        expect(text).toBe('{"a":1}')
    })

    it('text returns an empty string for an empty body', async () => {
        expect(await http.get(`${base}/reply`, { query: replying('text/plain', ''), responseType: 'text' })).toBe('')
    })

    it('json parses the body whatever the Content-Type', async () => {
        const data = await http.get<{ a: number }>(`${base}/reply`, {
            query: replying('text/plain', '{"a":1}'),
            responseType: 'json',
        })
        expectTypeOf(data).toEqualTypeOf<{ a: number }>()
        expect(data).toEqual({ a: 1 })
    })

    it('json returns undefined for an empty body', async () => {
        expect(await http.get(`${base}/reply`, { query: replying('text/plain', ''), responseType: 'json' })).toBeUndefined()
    })

    it('blob returns a Blob with the response Content-Type', async () => {
        const blob = await http.get(`${base}/reply`, {
            query: replying('image/png', 'png-bytes'),
            responseType: 'blob',
        })
        expectTypeOf(blob).toEqualTypeOf<Blob>()
        expect(blob).toBeInstanceOf(Blob)
        expect(blob.type).toBe('image/png')
        expect(await blob.text()).toBe('png-bytes')
    })

    it('response returns the native Response with its body unread', async () => {
        const response = await http.get(`${base}/reply`, {
            query: replying('application/json', '{"a":1}'),
            responseType: 'response',
        })
        expectTypeOf(response).toEqualTypeOf<Response>()
        expect(response).toBeInstanceOf(Response)
        expect(response.status).toBe(200)
        expect(response.bodyUsed).toBe(false)
        expect(await response.json()).toEqual({ a: 1 })
    })

    it('works on methods with a body', async () => {
        const text = await http.post(`${base}/echo`, { a: 1 }, { responseType: 'text' })
        expectTypeOf(text).toEqualTypeOf<string>()
        expect(JSON.parse(text).body).toBe('{"a":1}')
    })

    it('still throws HttpError on non-2xx, with data parsed by Content-Type', async () => {
        const error = await http.get(`${base}/reply`, {
            query: replying('application/json', '{"message":"Not found"}', 404),
            responseType: 'blob',
        }).catch((e) => e)
        expect(error).toBeInstanceOf(HttpError)
        expect(error.data).toEqual({ message: 'Not found' })
    })
})

describe('create and extend', () => {
    it.each([['/api', '/echo'], ['/api/', '/echo'], ['/api', 'echo'], ['/api//', 'echo']])(
        'joins baseURL %s and %s with one slash',
        async (prefix, path) => {
            const api = http.create({ baseURL: `${base}${prefix}` })
            expect((await api.get(path)).url).toBe('/api/echo')
        },
    )

    it('uses baseURL alone for an empty path', async () => {
        expect((await http.create({ baseURL: `${base}/api/echo` }).get('')).url).toBe('/api/echo')
    })

    it('uses absolute and protocol-relative URLs as-is', async () => {
        const api = http.create({ baseURL: 'http://127.0.0.1:1/unused' })
        expect((await api.get(`${base}/echo`)).url).toBe('/echo')
        // Node.js has no page to resolve //host against, so fetch gets the URL unchanged and cannot parse it
        const host = base.slice('http://'.length)
        await expect(api.get(`//${host}/echo`)).rejects.toThrow(`Failed to parse URL from //${host}/echo`)
    })

    it('includes baseURL in the HttpError message', async () => {
        const error = await http.create({ baseURL: base }).get('/reply', { query: { status: 404 } }).catch((e) => e)
        expect(error).toBeInstanceOf(HttpError)
        expect(error.message).toBe(`HTTP 404 Not Found: GET ${base}/reply?status=404`)
    })

    it('merges headers per name, and null or undefined drops a default', async () => {
        const api = http.create({ headers: { Authorization: 'Bearer a', 'X-App': 'web', 'X-Env': 'prod' } })
        const echo = await api.get(`${base}/echo`, {
            headers: { authorization: 'Bearer b', 'X-App': null, 'X-Env': undefined, 'X-Call': '1' },
        })
        expect(echo.headers.authorization).toBe('Bearer b')
        expect(echo.headers['x-app']).toBeUndefined()
        expect(echo.headers['x-env']).toBeUndefined()
        expect(echo.headers['x-call']).toBe('1')
        expect(echo.headers.accept).toBe('application/json, text/plain, */*')
    })

    it('accepts Headers and arrays as default headers', async () => {
        const api = http.create({ headers: new Headers({ 'X-A': '1', 'X-B': '2' }) }).extend({ headers: [['X-C', '3']] })
        const echo = await api.get(`${base}/echo`, { headers: { 'X-A': null } })
        expect(echo.headers['x-a']).toBeUndefined()
        expect(echo.headers['x-b']).toBe('2')
        expect(echo.headers['x-c']).toBe('3')
    })

    it('merges query per key, and null drops a default', async () => {
        const api = http.create({ baseURL: base, query: { lang: 'zh', page: 1 } })
        expect((await api.get('/echo')).url).toBe('/echo?lang=zh&page=1')
        expect((await api.get('/echo', { query: { page: 2, lang: null, q: 'x' } })).url).toBe('/echo?page=2&q=x')
    })

    it('applies a default timeout, which a request can turn off', async () => {
        const api = http.create({ baseURL: base, timeout: 50 })
        expect((await api.get('/slow', { query: { ms: 500 } }).catch((e) => e)).name).toBe('TimeoutError')
        expect(await api.get('/slow', { query: { ms: 100 }, timeout: undefined })).toBe('done')
    })

    it('extend inherits the defaults, create starts over, and neither changes the original', async () => {
        const api = http.create({ baseURL: base, headers: { 'X-App': 'web' } })
        const admin = api.extend({ baseURL: `${base}/admin`, headers: { 'X-Role': 'admin' } })

        const echo = await admin.get('/echo')
        expect(echo.url).toBe('/admin/echo')
        expect(echo.headers['x-app']).toBe('web')
        expect(echo.headers['x-role']).toBe('admin')

        expect((await api.create({ baseURL: base }).get('/echo')).headers['x-app']).toBeUndefined()
        expect((await api.get('/echo')).headers['x-role']).toBeUndefined()
    })

    it.each(['create', 'extend'] as const)('%s copies the defaults, so changing them later has no effect', async (method) => {
        const defaults = { baseURL: base, headers: { 'X-A': '1' } as Record<string, string>, query: { a: 1 } }
        const api = http[method](defaults)
        defaults.baseURL = 'http://127.0.0.1:1'
        defaults.headers['X-A'] = '2'
        defaults.query.a = 2
        const echo = await api.get('/echo')
        expect(echo.headers['x-a']).toBe('1')
        expect(echo.url).toBe('/echo?a=1')
    })

    it('keeps body handling and responseType inference', async () => {
        const api = http.create({ baseURL: base })
        const text = await api.post('/echo', { a: 1 }, { responseType: 'text' })
        expectTypeOf(text).toEqualTypeOf<string>()
        expect(JSON.parse(text).body).toBe('{"a":1}')
    })

    it('does not take body or responseType as defaults', () => {
        // @ts-expect-error a default responseType would break the inferred return types
        http.create({ responseType: 'text' })
        // @ts-expect-error a body is given per request
        http.create({ body: 'x' })
    })
})

describe('hooks', () => {
    it('onRequest runs before every request, so headers can follow the current token', async () => {
        let token = 'a'
        const api = http.create({
            baseURL: base,
            hooks: {
                onRequest: [async ({ headers }) => {
                    await new Promise((resolve) => setTimeout(resolve, 5))
                    headers.set('authorization', `Bearer ${token}`)
                }],
            },
        })
        expect((await api.get('/echo')).headers.authorization).toBe('Bearer a')
        token = 'b'
        expect((await api.get('/echo')).headers.authorization).toBe('Bearer b')
    })

    it('onRequest gets the method, the full URL and the options, and can replace the URL', async () => {
        const api = http.create({
            baseURL: 'http://127.0.0.1:1',
            hooks: {
                onRequest: [(context) => {
                    expect(context.method).toBe('POST')
                    expect(context.url).toBe('http://127.0.0.1:1/users?page=2')
                    expect(context.options.body).toEqual({ a: 1 })
                    context.url = `${base}/echo?via=hook`
                }],
            },
        })
        const echo = await api.post('/users', { a: 1 }, { query: { page: 2 } })
        expect(echo.url).toBe('/echo?via=hook')
        expect(echo.body).toBe('{"a":1}')
    })

    it('an error thrown by a hook rejects the request', async () => {
        const api = http.create({ hooks: { onRequest: [() => { throw new Error('blocked') }] } })
        await expect(api.get(`${base}/echo`)).rejects.toThrow('blocked')
    })

    it('runs the parent client hooks, then the child client, then the request', async () => {
        const calls: string[] = []
        const hook = (name: string) => () => { calls.push(name) }
        const api = http.create({ baseURL: base, hooks: { onRequest: [hook('parent')] } })
            .extend({ hooks: { onRequest: [hook('child')] } })
        await api.get('/echo', { hooks: { onRequest: [hook('request')] } })
        expect(calls).toEqual(['parent', 'child', 'request'])

        calls.length = 0
        await http.get(`${base}/echo`, { hooks: { onRequest: [hook('plain')] } })
        expect(calls).toEqual(['plain'])
    })

    it('onResponse sees every status before the body is read, and can replace the response', async () => {
        const seen: number[] = []
        const api = http.create({
            baseURL: base,
            hooks: {
                onResponse: [({ response }) => {
                    seen.push(response.status)
                    expect(response.bodyUsed).toBe(false)
                    if (response.status === 404) {
                        return new Response('{"fallback":true}', { headers: { 'content-type': 'application/json' } })
                    }
                }],
            },
        })
        expect(await api.get('/reply', { query: { status: 404 } })).toEqual({ fallback: true })
        expect(await api.get('/reply', { query: { status: 200, type: 'text/plain', body: 'ok' } })).toBe('ok')
        expect(seen).toEqual([404, 200])
    })

    it('retry() sends the request again, body included, after onResponse refreshes the token', async () => {
        let token = 'stale'
        let refreshes = 0
        const api = http.create({
            baseURL: base,
            hooks: {
                onRequest: [({ headers }) => headers.set('authorization', `Bearer ${token}`)],
                onResponse: [async ({ response, retry }) => {
                    if (response.status !== 401) return
                    refreshes++
                    token = 'fresh'
                    return retry()
                }],
            },
        })
        expect(await api.post('/auth', { a: 1 })).toEqual({ ok: true, body: '{"a":1}' })
        expect(refreshes).toBe(1)
    })

    it('does not run onResponse again on the retried response', async () => {
        let calls = 0
        const api = http.create({ baseURL: base, hooks: { onResponse: [({ retry }) => { calls++; return retry() }] } })
        const error = await api.get('/auth').catch((e) => e)
        expect(error).toBeInstanceOf(HttpError)
        expect(error.status).toBe(401)
        expect(calls).toBe(1)
    })

    it('retry() can only be called once per request', async () => {
        const api = http.create({ baseURL: base, hooks: { onResponse: [async ({ retry }) => { await retry(); return retry() }] } })
        await expect(api.get('/echo')).rejects.toThrow('retry() can only be called once per request')
    })

    it('retry() rejects for a ReadableStream body, which cannot be sent again', async () => {
        const api = http.create({ baseURL: base, hooks: { onResponse: [({ retry }) => retry()] } })
        await expect(api.post('/echo', new Blob(['x']).stream())).rejects.toThrow('A ReadableStream body cannot be sent again')
    })

    it('the timeout also covers the hooks', async () => {
        const api = http.create({
            baseURL: base,
            timeout: 50,
            hooks: { onRequest: [() => new Promise((resolve) => setTimeout(resolve, 100))] },
        })
        expect((await api.get('/echo').catch((e) => e)).name).toBe('TimeoutError')
    })

    it('onError gets each HttpError, and the last error returned is thrown instead', async () => {
        class AppError extends Error {}
        const seen: unknown[] = []
        const api = http.create({
            baseURL: base,
            hooks: {
                onError: [
                    (error) => { seen.push(error) },
                    (error) => new AppError(`app: ${error.status}`),
                    (error) => { seen.push(error) },
                ],
            },
        })
        const error = await api.get('/reply', { query: { status: 500 } }).catch((e) => e)
        expect(error).toBeInstanceOf(AppError)
        expect(error.message).toBe('app: 500')
        expect(seen).toHaveLength(2)
        for (const each of seen) expect(each).toBeInstanceOf(HttpError)
    })

    it('ignores hook return values that are not a Response or an Error, such as false from `ok && retry()`', async () => {
        const api = http.create({
            baseURL: base,
            hooks: {
                onResponse: [() => false as unknown as void],
                onError: [() => 'not an error' as unknown as void],
            },
        })
        expect((await api.get('/echo')).method).toBe('GET')
        const error = await api.get('/reply', { query: { status: 500 } }).catch((e) => e)
        expect(error).toBeInstanceOf(HttpError)
    })

    it('onError is not called for successful responses or network errors', async () => {
        let calls = 0
        const api = http.create({ hooks: { onError: [() => { calls++ }] } })
        await api.get(`${base}/echo`)
        await api.get('http://127.0.0.1:1/').catch(() => {})
        expect(calls).toBe(0)
    })
})

describe('retry', () => {
    let keys = 0
    // A new key per call, so each request has its own failure count on the server
    const flaky = (fail: number, status: number | 'drop', extra: Record<string, string> = {}) =>
        ({ key: `retry-${++keys}`, fail, status, ...extra })
    const noWait = { delay: () => 0 }

    it('is off by default', async () => {
        const query = flaky(1, 503)
        expect((await http.get(`${base}/flaky`, { query }).catch((e) => e)).status).toBe(503)
        expect(attempts.get(query.key)).toBe(1)
    })

    it('retries a retryable status up to the limit, running onRequest on every attempt', async () => {
        let sends = 0
        const api = http.create({
            baseURL: base,
            timeout: 5000,
            retry: { limit: 2, ...noWait },
            hooks: { onRequest: [() => { sends++ }] },
        })
        expect(await api.get('/flaky', { query: flaky(2, 503) })).toMatchObject({ attempts: 3 })
        expect(sends).toBe(3)
    })

    it('throws the last HttpError once the limit is used up, and onResponse sees only that response', async () => {
        const seen: number[] = []
        const api = http.create({
            baseURL: base,
            retry: { limit: 2, ...noWait },
            hooks: { onResponse: [({ response }) => { seen.push(response.status) }] },
        })
        const query = flaky(3, 500)
        expect((await api.get('/flaky', { query }).catch((e) => e)).status).toBe(500)
        expect(attempts.get(query.key)).toBe(3)
        expect(seen).toEqual([500])
    })

    it('a number sets the limit, with the default delay starting at 300ms', async () => {
        const started = Date.now()
        expect(await http.get(`${base}/flaky`, { query: flaky(1, 503), retry: 1 })).toMatchObject({ attempts: 2 })
        expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    })

    it('retries network errors', async () => {
        expect(await http.get(`${base}/flaky`, { query: flaky(2, 'drop'), retry: noWait })).toMatchObject({ attempts: 3 })
    })

    it('does not retry other statuses, or errors thrown by hooks', async () => {
        const query = flaky(1, 404)
        expect((await http.get(`${base}/flaky`, { query, retry: noWait }).catch((e) => e)).status).toBe(404)
        expect(attempts.get(query.key)).toBe(1)

        let calls = 0
        const buggy = () => {
            calls++
            throw new TypeError('bug in a hook')
        }
        await expect(http.get(`${base}/echo`, { retry: noWait, hooks: { onRequest: [buggy] } })).rejects.toThrow('bug in a hook')
        expect(calls).toBe(1)
    })

    it('retries exactly the statuses listed in statusCodes, even one without a body', async () => {
        for (const status of [404, 204]) {
            const retry = { statusCodes: [status], ...noWait }
            expect(await http.get(`${base}/flaky`, { query: flaky(1, status), retry })).toMatchObject({ attempts: 2 })
        }
        const query = flaky(1, 503)
        expect((await http.get(`${base}/flaky`, { query, retry: { statusCodes: [404], ...noWait } }).catch((e) => e)).status).toBe(503)
    })

    it('retries POST and PATCH only when listed, sending the body again', async () => {
        const query = flaky(1, 503)
        expect((await http.post(`${base}/flaky`, { a: 1 }, { query, retry: noWait }).catch((e) => e)).status).toBe(503)
        expect(attempts.get(query.key)).toBe(1)

        const retry = { methods: ['post'], ...noWait }
        expect(await http.post(`${base}/flaky`, { a: 1 }, { query: flaky(1, 503), retry }))
            .toEqual({ attempts: 2, method: 'POST', body: '{"a":1}' })
    })

    it('does not retry a ReadableStream body, which can be read only once', async () => {
        const query = flaky(1, 503)
        const error = await http.put(`${base}/flaky`, new Blob(['x']).stream(), { query, retry: noWait }).catch((e) => e)
        expect(error.status).toBe(503)
        expect(attempts.get(query.key)).toBe(1)
    })

    it('waits for Retry-After in seconds instead of the delay', async () => {
        const started = Date.now()
        expect(await http.get(`${base}/flaky`, { query: flaky(1, 429, { retryAfter: '1' }), retry: noWait }))
            .toMatchObject({ attempts: 2 })
        expect(Date.now() - started).toBeGreaterThanOrEqual(950)
    })

    it('reads Retry-After as an HTTP date too, and falls back to the delay when it is invalid', async () => {
        // With this delay, the test would time out unless Retry-After is used
        const slow = { delay: () => 60_000 }
        const past = new Date(Date.now() - 1000).toUTCString()
        expect(await http.get(`${base}/flaky`, { query: flaky(1, 503, { retryAfter: past }), retry: slow }))
            .toMatchObject({ attempts: 2 })
        expect(await http.get(`${base}/flaky`, { query: flaky(1, 503, { retryAfter: 'soon' }), retry: noWait }))
            .toMatchObject({ attempts: 2 })
    })

    it('does not wait for a Retry-After longer than maxRetryAfter', async () => {
        const query = flaky(1, 429, { retryAfter: '120' })
        expect((await http.get(`${base}/flaky`, { query, retry: noWait }).catch((e) => e)).status).toBe(429)
        expect(attempts.get(query.key)).toBe(1)
    })

    it('the timeout covers the waits, and an abort stops a wait', async () => {
        const wait = { delay: () => 1000 }
        const timedOut = await http.get(`${base}/flaky`, { query: flaky(1, 503), retry: wait, timeout: 100 }).catch((e) => e)
        expect(timedOut.name).toBe('TimeoutError')

        const controller = new AbortController()
        setTimeout(() => controller.abort(), 50)
        const aborted = await http.get(`${base}/flaky`, { query: flaky(1, 'drop'), retry: wait, signal: controller.signal }).catch((e) => e)
        expect(aborted.name).toBe('AbortError')
    })

    it('does not retry an aborted request', async () => {
        let sends = 0
        const hooks = { onRequest: [() => { sends++ }] }
        const error = await http.get(`${base}/echo`, { signal: AbortSignal.abort(), retry: noWait, hooks }).catch((e) => e)
        expect(error.name).toBe('AbortError')
        expect(sends).toBe(1)
    })

    it('a request can turn off the retry of its client', async () => {
        const api = http.create({ baseURL: base, retry: noWait })
        const query = flaky(1, 503)
        expect((await api.get('/flaky', { query, retry: 0 }).catch((e) => e)).status).toBe(503)
        expect(attempts.get(query.key)).toBe(1)
    })
})

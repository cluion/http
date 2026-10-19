import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError, http } from '../src/index'

// A real local server instead of a mocked fetch:
// /echo responds with the received method, url, headers and body
// /reply?status=&type=&body= responds with the given status, Content-Type and body
let server: Server
let base: string

beforeAll(async () => {
    server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)

        if (url.pathname === '/echo') {
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: Buffer.concat(chunks).toString(),
            }))
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

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const reply = (status: number, type: string, body: string) =>
    http.get(`${base}/reply`, { query: { status, type, body } })

describe('HTTP methods', () => {
    it.each(['get', 'delete'] as const)('%s sends the matching method', async (method) => {
        const echo = await http[method](`${base}/echo`)
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

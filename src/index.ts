export type QueryValue = string | number | boolean | null | undefined

/** Arrays serialize as `key[]=a&key[]=b`; null and undefined are skipped. */
export type Query = Record<string, QueryValue | readonly QueryValue[]>

/**
 * How a successful body is read. When omitted, JSON Content-Types are parsed,
 * other types return a string, and an empty body returns `undefined`.
 */
export type ResponseType = 'json' | 'text' | 'blob' | 'response'

export interface RequestOptions extends Omit<RequestInit, 'method' | 'body'> {
    query?: Query
    /** Plain objects and arrays are sent as JSON; native bodies (FormData, Blob, string, ...) are sent as-is. */
    body?: unknown
    /**
     * Milliseconds before the request is aborted with a native `TimeoutError`, as an integer
     * from 0 to 2147483647. Covers the whole request, including reading the body. Omit it for no timeout.
     */
    timeout?: number
    responseType?: ResponseType
}

/** Options without `body`: for `get`, which cannot send one, and for methods taking the body as an argument. */
export type BodyRequestOptions = Omit<RequestOptions, 'body'>

type Typed<O, R extends ResponseType> = O & { responseType: R }

interface MethodWithoutBody<O> {
    (url: string, options: Typed<O, 'text'>): Promise<string>
    (url: string, options: Typed<O, 'blob'>): Promise<Blob>
    (url: string, options: Typed<O, 'response'>): Promise<Response>
    <T = any>(url: string, options?: O & { responseType?: 'json' }): Promise<T>
}

interface MethodWithBody {
    (url: string, body: unknown, options: Typed<BodyRequestOptions, 'text'>): Promise<string>
    (url: string, body: unknown, options: Typed<BodyRequestOptions, 'blob'>): Promise<Blob>
    (url: string, body: unknown, options: Typed<BodyRequestOptions, 'response'>): Promise<Response>
    <T = any>(url: string, body?: unknown, options?: BodyRequestOptions & { responseType?: 'json' }): Promise<T>
}

/** A non-2xx response. Network errors, aborts and timeouts stay native (TypeError / AbortError / TimeoutError). */
export class HttpError<T = any> extends Error {
    override readonly name = 'HttpError'
    readonly status: number
    readonly statusText: string
    /** The error body parsed by its Content-Type (whatever `responseType` is), or the raw text when it is malformed JSON. */
    readonly data: T
    /** Its body has already been read; use `data` instead. */
    readonly response: Response

    constructor(method: string, url: string, response: Response, data: T) {
        super(`HTTP ${`${response.status} ${response.statusText}`.trim()}: ${method} ${url}`)
        this.status = response.status
        this.statusText = response.statusText
        this.data = data
        this.response = response
    }
}

// Same as axios; Laravel relies on it to return JSON errors instead of redirecting
const DEFAULT_ACCEPT = 'application/json, text/plain, */*'
const JSON_TYPE = /[/+]json\s*(;|$)/i

const isNativeBody = (body: unknown): body is BodyInit =>
    typeof body === 'string'
    || body instanceof FormData
    || body instanceof URLSearchParams
    || body instanceof Blob
    || body instanceof ArrayBuffer
    || ArrayBuffer.isView(body)
    || body instanceof ReadableStream

function withQuery(url: string, query: Query = {}): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        const name = Array.isArray(value) ? `${key}[]` : key
        for (const item of Array.isArray(value) ? value : [value]) {
            if (item != null) params.append(name, String(item))
        }
    }
    const search = params.toString()
    if (!search) return url
    const path = url.split('#')[0] // fetch never sends the fragment anyway
    return `${path}${path.includes('?') ? '&' : '?'}${search}`
}

// Longer delays overflow the timer, and the request aborts almost immediately
const MAX_TIMEOUT = 2 ** 31 - 1

function withTimeout(signal: AbortSignal | null | undefined, timeout?: number) {
    if (timeout === undefined) return signal
    if (!Number.isInteger(timeout) || timeout < 0 || timeout > MAX_TIMEOUT) {
        throw new RangeError(`timeout must be an integer from 0 to ${MAX_TIMEOUT} milliseconds, got ${String(timeout)}`)
    }
    const timer = AbortSignal.timeout(timeout)
    return signal ? AbortSignal.any([signal, timer]) : timer
}

const parseJson = (text: string): unknown => (text.trim() ? JSON.parse(text) : undefined)

function parseByType(text: string, contentType: string | null): unknown {
    if (contentType && JSON_TYPE.test(contentType)) return parseJson(text)
    return text || undefined
}

function parseLoose(text: string, contentType: string | null): unknown {
    try {
        return parseByType(text, contentType)
    } catch {
        return text
    }
}

async function readBody(response: Response, responseType?: ResponseType): Promise<unknown> {
    switch (responseType) {
        case 'response': return response
        case 'blob': return response.blob()
        case 'text': return response.text()
        case 'json': return parseJson(await response.text())
        default: return parseByType(await response.text(), response.headers.get('content-type'))
    }
}

async function request(method: string, url: string, options: RequestOptions = {}): Promise<any> {
    const { query, body, timeout, responseType, ...init } = options
    const isJson = body != null && !isNativeBody(body)

    const headers = new Headers(init.headers)
    if (!headers.has('accept')) headers.set('accept', DEFAULT_ACCEPT)
    if (isJson && !headers.has('content-type')) headers.set('content-type', 'application/json')

    const fullUrl = withQuery(url, query)
    const response = await fetch(fullUrl, {
        // fetch requires duplex: 'half' to stream a body, but RequestInit does not declare it
        ...(body instanceof ReadableStream && { duplex: 'half' }),
        ...init,
        method,
        headers,
        body: isJson ? JSON.stringify(body) : (body as BodyInit | null | undefined),
        signal: withTimeout(init.signal, timeout),
    })

    if (!response.ok) {
        const data = parseLoose(await response.text(), response.headers.get('content-type'))
        throw new HttpError(method, fullUrl, response, data)
    }
    return readBody(response, responseType)
}

const withoutBody = <O extends BodyRequestOptions>(method: string): MethodWithoutBody<O> =>
    (url: string, options?: O) => request(method, url, options)

const withBody = (method: string): MethodWithBody =>
    (url: string, body?: unknown, options?: BodyRequestOptions) => request(method, url, { ...options, body })

export const http = {
    get: withoutBody<BodyRequestOptions>('GET'),
    delete: withoutBody<RequestOptions>('DELETE'),
    post: withBody('POST'),
    put: withBody('PUT'),
    patch: withBody('PATCH'),
}

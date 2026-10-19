export type QueryValue = string | number | boolean | null | undefined

/** Arrays serialize as `key[]=a&key[]=b`; null and undefined are skipped. */
export type Query = Record<string, QueryValue | readonly QueryValue[]>

export interface RequestOptions extends Omit<RequestInit, 'method' | 'body'> {
    query?: Query
    /** Plain objects and arrays are sent as JSON; native bodies (FormData, Blob, string, ...) are sent as-is. */
    body?: unknown
}

export type BodyRequestOptions = Omit<RequestOptions, 'body'>

/** A non-2xx response. Network errors, aborts and timeouts stay native (TypeError / AbortError / TimeoutError). */
export class HttpError<T = any> extends Error {
    override readonly name = 'HttpError'
    readonly status: number
    readonly statusText: string
    /** The parsed error body, or the raw text when it is malformed JSON. */
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

function parse(text: string, contentType: string | null): unknown {
    if (!text) return undefined
    return contentType && JSON_TYPE.test(contentType) ? JSON.parse(text) : text
}

function parseLoose(text: string, contentType: string | null): unknown {
    try {
        return parse(text, contentType)
    } catch {
        return text
    }
}

async function request<T>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
    const { query, body, ...init } = options
    const isJson = body != null && !isNativeBody(body)

    const headers = new Headers(init.headers)
    if (!headers.has('accept')) headers.set('accept', DEFAULT_ACCEPT)
    if (isJson && !headers.has('content-type')) headers.set('content-type', 'application/json')

    const fullUrl = withQuery(url, query)
    const response = await fetch(fullUrl, {
        ...init,
        method,
        headers,
        body: isJson ? JSON.stringify(body) : (body as BodyInit | null | undefined),
    })
    const text = await response.text()
    const contentType = response.headers.get('content-type')

    if (!response.ok) {
        throw new HttpError(method, fullUrl, response, parseLoose(text, contentType))
    }
    return parse(text, contentType) as T
}

export const http = {
    get: <T = any>(url: string, options?: RequestOptions) => request<T>('GET', url, options),
    delete: <T = any>(url: string, options?: RequestOptions) => request<T>('DELETE', url, options),
    post: <T = any>(url: string, body?: unknown, options?: BodyRequestOptions) =>
        request<T>('POST', url, { ...options, body }),
    put: <T = any>(url: string, body?: unknown, options?: BodyRequestOptions) =>
        request<T>('PUT', url, { ...options, body }),
    patch: <T = any>(url: string, body?: unknown, options?: BodyRequestOptions) =>
        request<T>('PATCH', url, { ...options, body }),
}

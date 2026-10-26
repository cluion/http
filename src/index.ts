export type QueryValue = string | number | boolean | null | undefined

/** Arrays serialize as `key[]=a&key[]=b`; null and undefined are skipped. */
export type Query = Record<string, QueryValue | readonly QueryValue[]>

/**
 * How a successful body is read. When omitted, JSON Content-Types are parsed,
 * other types return a string, and an empty body returns `undefined`.
 */
export type ResponseType = 'json' | 'text' | 'blob' | 'response'

/** Like `HeadersInit`, but a null or undefined value is not sent and drops a client default. */
export type HeadersOption = HeadersInit | Record<string, string | null | undefined>

export interface RequestOptions extends Omit<RequestInit, 'method' | 'body' | 'headers'> {
    headers?: HeadersOption
    query?: Query
    /** Plain objects and arrays are sent as JSON; native bodies (FormData, Blob, string, ...) are sent as-is. */
    body?: unknown
    /**
     * Milliseconds before the request is aborted with a native `TimeoutError`, as an integer
     * from 0 to 2147483647. Covers the whole request, including reading the body. Omit it for no timeout.
     */
    timeout?: number
    responseType?: ResponseType
    /** Appended to the hooks of the client, which run first. */
    hooks?: Hooks
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

/** Defaults for every request of a client. `headers` and `query` merge per key, `hooks` are appended, other options are replaced. */
export interface ClientOptions extends Omit<RequestOptions, 'body' | 'responseType'> {
    /** Joined to relative URLs; absolute (`https://...`) and protocol-relative (`//host`) URLs are used as-is. */
    baseURL?: string
}

export interface RequestContext {
    readonly method: string
    /** The URL to request, with `baseURL` and `query` applied. `onRequest` hooks may replace it. */
    url: string
    /** The headers to send. `onRequest` hooks may change them. */
    readonly headers: Headers
    /** The options of the request, merged with the client's. */
    readonly options: Readonly<RequestOptions & ClientOptions>
}

export interface ResponseContext extends RequestContext {
    /** The native `Response`, with its body unread. */
    readonly response: Response
    /** Sends the request again, running the `onRequest` hooks first, and resolves with the new response. Once per request. */
    retry(): Promise<Response>
}

type Awaitable<T> = T | Promise<T>

export interface Hooks {
    /** Run before each send, including a retry. */
    onRequest?: ((context: RequestContext) => Awaitable<void>)[]
    /** Run for every status before the body is read. A returned `Response` replaces the current one. */
    onResponse?: ((context: ResponseContext) => Awaitable<Response | void>)[]
    /** Run before an `HttpError` is thrown, each with that error. The last `Error` returned is thrown instead. */
    onError?: ((error: HttpError) => Awaitable<Error | void>)[]
}

export interface HttpClient {
    get: MethodWithoutBody<BodyRequestOptions>
    delete: MethodWithoutBody<RequestOptions>
    post: MethodWithBody
    put: MethodWithBody
    patch: MethodWithBody
    /** A new client with these defaults only, without inheriting this client's. */
    create(defaults?: ClientOptions): HttpClient
    /** A new client with these defaults merged into this client's, which stay unchanged. */
    extend(defaults: ClientOptions): HttpClient
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

// URLs with a scheme or starting with // ignore baseURL, as in axios
const ABSOLUTE_URL = /^([a-z][a-z\d+\-.]*:)?\/\//i

function withBase(url: string, baseURL?: string): string {
    if (!baseURL || ABSOLUTE_URL.test(url)) return url
    return url ? `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}` : baseURL
}

/** Later sources win per header name; a null or undefined value drops the header. */
function mergeHeaders(...sources: (HeadersOption | undefined)[]): Headers {
    const headers = new Headers()
    const apply = (value: string | null | undefined, name: string) => {
        if (value == null) headers.delete(name)
        else headers.set(name, value)
    }
    for (const source of sources) {
        if (source instanceof Headers || Array.isArray(source)) new Headers(source).forEach(apply)
        else for (const [name, value] of Object.entries(source ?? {})) apply(value, name)
    }
    return headers
}

type Options = RequestOptions & ClientOptions
type Merged = Options & { headers: Headers, hooks: Required<Hooks> }

const mergeHooks = (a: Hooks = {}, b: Hooks = {}): Required<Hooks> => ({
    onRequest: [...(a.onRequest ?? []), ...(b.onRequest ?? [])],
    onResponse: [...(a.onResponse ?? []), ...(b.onResponse ?? [])],
    onError: [...(a.onError ?? []), ...(b.onError ?? [])],
})

const merge = (defaults: ClientOptions, options: Options): Merged => ({
    ...defaults,
    ...options,
    headers: mergeHeaders(defaults.headers, options.headers),
    query: { ...defaults.query, ...options.query },
    hooks: mergeHooks(defaults.hooks, options.hooks),
})

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

async function request(method: string, url: string, options: Merged): Promise<any> {
    const { baseURL, query, body, timeout, responseType, headers: headersOption, hooks, ...init } = options
    const isJson = body != null && !isNativeBody(body)
    const fullUrl = withQuery(withBase(url, baseURL), query)
    // Created once, so the timeout also covers the hooks and a retry
    const signal = withTimeout(init.signal, timeout)
    const context = { method, url: fullUrl, headers: new Headers(), options }

    // Each send, a retry included, starts again from the merged URL and headers
    const send = async () => {
        const headers = new Headers(headersOption)
        if (!headers.has('accept')) headers.set('accept', DEFAULT_ACCEPT)
        if (isJson && !headers.has('content-type')) headers.set('content-type', 'application/json')
        context.url = fullUrl
        context.headers = headers
        for (const hook of hooks.onRequest) await hook(context)

        return fetch(context.url, {
            // fetch requires duplex: 'half' to stream a body, but RequestInit does not declare it
            ...(body instanceof ReadableStream && { duplex: 'half' }),
            ...init,
            method,
            headers: context.headers,
            body: isJson ? JSON.stringify(body) : (body as BodyInit | null | undefined),
            signal,
        })
    }

    let retried = false
    const retry = () => {
        if (retried) return Promise.reject(new Error('retry() can only be called once per request'))
        if (body instanceof ReadableStream) return Promise.reject(new TypeError('A ReadableStream body cannot be sent again'))
        retried = true
        return send()
    }

    // Other return values are ignored, so a JavaScript hook like `ok && retry()` returning false keeps the response
    let response = await send()
    for (const hook of hooks.onResponse) {
        const next = await hook({ ...context, response, retry })
        if (next instanceof Response) response = next
    }

    if (!response.ok) {
        const data = parseLoose(await response.text(), response.headers.get('content-type'))
        const error = new HttpError(method, context.url, response, data)
        let thrown: Error = error
        for (const hook of hooks.onError) {
            const next = await hook(error)
            if (next instanceof Error) thrown = next
        }
        throw thrown
    }
    return readBody(response, responseType)
}

function client(defaults: ClientOptions): HttpClient {
    const send = (method: string, url: string, options: Options = {}) => request(method, url, merge(defaults, options))

    const withoutBody = (method: string) =>
        (url: string, options?: RequestOptions) => send(method, url, options)

    const withBody = (method: string) =>
        (url: string, body?: unknown, options?: BodyRequestOptions) => send(method, url, { ...options, body })

    return {
        get: withoutBody('GET'),
        delete: withoutBody('DELETE'),
        post: withBody('POST'),
        put: withBody('PUT'),
        patch: withBody('PATCH'),
        create: (options = {}) => client(merge({}, options)),
        extend: (options) => client(merge(defaults, options)),
    }
}

export const http = client({})

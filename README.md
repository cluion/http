# @cluion/http

[English](README.md) | [繁體中文](README.zh-TW.md)

A zero-dependency HTTP client built on the native Fetch API. It handles JSON, query parameters and non-2xx status codes for you, so you can get started without first learning `Request`, `Response` and `Headers`.

## Installation

```bash
npm install @cluion/http
```

Requires a global `fetch`: modern browsers, Node.js 22+, Bun or Deno.

## Quick start

```js
import { http, HttpError } from '@cluion/http'

// Fetch data: you get the parsed JSON directly
const users = await http.get('/users')

// Create data: objects are sent as JSON
await http.post('/users', { name: 'Hugo' })

// Query parameters
await http.get('/users', { query: { page: 1 } })

// File upload: FormData is sent as-is
await http.post('/upload', formData)

// Shared defaults, such as a base URL and a token
const api = http.create({ baseURL: 'https://api.example.com', headers: { Authorization: `Bearer ${token}` } })
await api.get('/users')

// Error handling
try {
    await http.post('/users', { name: '' })
} catch (error) {
    if (error instanceof HttpError) {
        console.log(error.status)       // 422
        console.log(error.data.errors)  // the error body returned by the server
    }
}
```

In TypeScript, pass a generic to type the result:

```ts
const users = await http.get<User[]>('/users')
```

## API

### Methods

| Method | Signature |
| --- | --- |
| `http.get` | `(url, options?)` |
| `http.head` | `(url, options?)` |
| `http.options` | `(url, options?)` |
| `http.delete` | `(url, options?)` |
| `http.post` | `(url, body?, options?)` |
| `http.put` | `(url, body?, options?)` |
| `http.patch` | `(url, body?, options?)` |

To send a body with `delete`, use `options.body`: `http.delete('/users', { body: { ids: [1, 2] } })`. A `head` response has no body, so it returns `undefined`; use `responseType: 'response'` to read its headers.

`http` and every client made from it also have `create` and `extend`; see [Instances](#instances).

### Options

Apart from the fields below, every native [`RequestInit`](https://developer.mozilla.org/docs/Web/API/RequestInit) option (`headers`, `signal`, `credentials`, `cache`, ...) is passed straight to `fetch`.

| Field | Description |
| --- | --- |
| `query` | Query parameters object; see the rules below |
| `queryArrayFormat` | How arrays in `query` are serialized: `'brackets'` (default), `'repeat'` or `'comma'` |
| `body` | Only for `delete`; `post` / `put` / `patch` take the body as the second argument. `get` cannot send a body, since `fetch` does not allow one on GET |
| `timeout` | Milliseconds before the request is aborted with a native `TimeoutError`, as an integer from `0` to `2147483647` (about 24.8 days); other values throw a `RangeError` before the request is sent. Covers the whole request, including reading the body. No timeout when omitted. It works together with your own `signal` |
| `responseType` | How a successful body is read: `'json'`, `'text'`, `'blob'` or `'response'`; see Return value |
| `hooks` | Functions run before the request, on the response and on errors; see [Hooks](#hooks) |
| `retry` | Retries network errors and statuses such as 503; off by default. See [Retry](#retry) |
| `xsrf` | Sends the `XSRF-TOKEN` cookie as `X-XSRF-TOKEN` in browsers; off by default. See [XSRF](#xsrf) |

### Body rules

| You pass | It is sent as |
| --- | --- |
| Plain object, array, number, boolean | `JSON.stringify`, with `Content-Type: application/json` |
| `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, TypedArray, `ReadableStream`, string | Passed to `fetch` as-is; `fetch` decides the Content-Type |
| `undefined`, `null` | No body |

A `Content-Type` you set yourself always wins. A `ReadableStream` is sent with `duplex: 'half'`, which `fetch` requires to stream a request body, so you do not need to set it.

### Query rules

```js
http.get('/users', { query: { page: 1, q: 'a b', ids: [1, 2], role: null } })
// → /users?page=1&q=a+b&ids[]=1&ids[]=2
```

- Arrays serialize as `key[]=value` (same as axios; PHP / Laravel, Rails and Express parse it as an array)
- For backends that expect another format, set `queryArrayFormat` to `'repeat'` for `ids=1&ids=2` (FastAPI, Spring, Go) or to `'comma'` for `ids=1,2`. It also works as a client default
- `null` and `undefined` are skipped
- Appended with `&` when the URL already has a `?`
- Values must be strings, numbers or booleans; nested objects are not supported

### Headers

`Accept: application/json, text/plain, */*` is sent by default (same as axios). Laravel uses this header to return JSON validation errors instead of redirecting. An `Accept` you set yourself replaces the default. A header set to `null` or `undefined` is not sent.

### XSRF

Cookie-based authentication such as Laravel Sanctum expects the `XSRF-TOKEN` cookie to come back as the `X-XSRF-TOKEN` header, which axios adds for you. Turn on `xsrf` to do the same:

```js
const api = http.create({ baseURL: '/api', xsrf: true })

await http.get('/sanctum/csrf-cookie')   // sets the XSRF-TOKEN cookie
await api.post('/login', { email, password })

// An API on another subdomain: list its origin, and send cookies with credentials
const remote = http.create({
    baseURL: 'https://api.example.com',
    credentials: 'include',
    xsrf: { origins: ['https://api.example.com'] },
})
```

- The token is sent only to the page's own origin and to the listed `origins`, so it never reaches another site. The check uses the final URL, after `onRequest` hooks
- The cookie is read again on every request, URL-decoded, and skipped when it is missing. A header you set yourself is kept
- It does nothing outside a browser, where there is no `document.cookie`
- `cookieName` and `headerName` change the defaults, `'XSRF-TOKEN'` and `'X-XSRF-TOKEN'`

### Instances

`http.create(defaults)` returns a client with the same methods that applies `defaults` to every request. `defaults` takes every option except `body` and `responseType`, plus `baseURL`.

```js
const api = http.create({
    baseURL: 'https://api.example.com/v1',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
})

await api.get('/users')                           // GET https://api.example.com/v1/users
await api.get('https://cdn.example.com/a.json')   // absolute URLs ignore baseURL
await api.get('/status', { headers: { Authorization: null } })   // drop a default header

const admin = api.extend({ baseURL: 'https://api.example.com/admin' })
```

- `baseURL` is joined to relative URLs with exactly one `/` between them. URLs with a scheme (`https://...`) or starting with `//` are used as-is (same as axios)
- `headers` and `query` merge per key, and the request's values win. A value of `null` or `undefined` drops the default
- `hooks` are appended: the client's run first, then the request's
- Other options are replaced by the request's value, so `timeout: undefined` turns a default timeout off
- `extend(defaults)` returns a new client with `defaults` merged into the current ones by the same rules. `create(defaults)` on any client starts over without them. Neither changes the client it is called on

### Hooks

Hooks run your own code at three points of every request. Each one is an array of functions, which may be async and run in order.

```js
const api = http.create({
    baseURL: 'https://api.example.com',
    hooks: {
        // Read the token on every request, so a new one is used as soon as it changes
        onRequest: [({ headers }) => headers.set('Authorization', `Bearer ${store.token}`)],
        // Refresh an expired token and send the request again
        onResponse: [async ({ response, retry }) => {
            if (response.status === 401) {
                await refreshToken()
                return retry()
            }
        }],
        onError: [(error) => report(error)],
    },
})
```

| Hook | Runs | Gets | Returning |
| --- | --- | --- | --- |
| `onRequest` | Before each send, including a retry | `{ method, url, headers, options }` | Nothing. Change `headers`, or assign `url` |
| `onResponse` | For every status, before the body is read | The same, plus `response` and `retry` | A `Response` replaces the current one |
| `onError` | Before an `HttpError` is thrown | The `HttpError` | An `Error` is thrown instead |

- `retry()` sends the request again and resolves with the new `Response`; return it to use it. The `onRequest` hooks run again first, so they can add a refreshed token. The new response does not go through `onResponse` again, and `retry()` works once per request. A `ReadableStream` body can be read only once, so it cannot be retried
- `url` already has `baseURL` and `query` applied, and `options` holds the request's options merged with the client's
- Every `onError` hook gets the original `HttpError`. When several return an error, the last one is thrown. Network errors, aborts and timeouts do not reach `onError`
- An error thrown by a hook rejects the request
- `timeout` covers the hooks and the retry too
- Hooks set on a request run after the client's, and `extend` appends its hooks after the parent's

#### Refreshing a token once for many requests

When several requests get a 401 at the same time, the example above refreshes the token once for each of them. Share one refresh instead, and skip it for a request that was sent with an older token, since another request has already refreshed it:

```js
let refreshing = null
const refresh = () => (refreshing ??= refreshToken().finally(() => { refreshing = null }))

const api = http.create({
    hooks: {
        onRequest: [({ headers }) => headers.set('Authorization', `Bearer ${store.token}`)],
        onResponse: [async ({ response, headers, retry }) => {
            if (response.status !== 401) return
            // Refresh only if it used the current token; one sent with an older token just goes again
            if (headers.get('Authorization') === `Bearer ${store.token}`) await refresh()
            return retry()
        }],
    },
})
```

### Retry

Retrying is off by default. Set `retry` to a number of retries, or to an object to change more:

```js
await http.get('/users', { retry: 2 })

const api = http.create({
    baseURL: 'https://api.example.com',
    retry: { limit: 3, statusCodes: [503], delay: (attempt) => 1000 * attempt },
})
```

| Field | Default | Description |
| --- | --- | --- |
| `limit` | `2` | Retries after the first attempt |
| `methods` | `['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']` | `POST` and `PATCH` are not idempotent and could create a record twice, so they are retried only when listed |
| `statusCodes` | `[408, 429, 500, 502, 503, 504]` | Statuses that are retried. Network errors are retried too |
| `delay` | `300`, `600`, `1200`, ... | `(attempt) => milliseconds` to wait before each retry, with `attempt` starting at 1 |
| `maxRetryAfter` | `60000` | A longer `Retry-After` is not waited for |

- A response with a `Retry-After` header, in seconds or as an HTTP date, is retried after that time instead of `delay`. When it is longer than `maxRetryAfter`, the response is used as is, so a 429 throws `HttpError` right away
- Aborts and timeouts are not retried, and `timeout` covers every attempt and wait. A `ReadableStream` body can be read only once, so it is never retried
- `onRequest` hooks run on every attempt, so each one reads the current token. `onResponse` sees only the final response, and a hook's `retry()` gets the same automatic retries
- Like other options, a request's `retry` replaces the client's, so `retry: 0` turns it off for one request

### Return value

By default the parsed body is returned directly:

| Response | Returns |
| --- | --- |
| JSON Content-Type (`application/json`, `*/*+json`) | The parsed value |
| Any other Content-Type | A string |
| 204, or an empty or whitespace-only body | `undefined` |

If a successful response claims to be JSON but cannot be parsed, a native `SyntaxError` is thrown.

Use `responseType` to choose how the body is read. TypeScript infers the return type from it:

| `responseType` | Returns |
| --- | --- |
| `'json'` | The body parsed as JSON whatever the Content-Type; `undefined` when empty |
| `'text'` | The body as a string; `''` when empty |
| `'blob'` | A `Blob`, for files and images |
| `'response'` | The native `Response` with its body unread, for status, headers or streaming |

```js
const avatar = await http.get('/avatar.png', { responseType: 'blob' })

const response = await http.get('/users', { responseType: 'response' })
response.headers.get('x-total-count')
const users = await response.json()
```

When `responseType` is only known at runtime, such as a variable typed `ResponseType`, the result is typed by the generic, `any` by default.

Non-2xx responses still throw `HttpError` whatever the `responseType`. With `timeout`, reading the body of a `'response'` result counts towards the timeout as well.

### Errors

Only **non-2xx responses** throw `HttpError`:

| Property | Description |
| --- | --- |
| `status` | HTTP status code, e.g. `404` |
| `statusText` | e.g. `Not Found` (may be empty over HTTP/2) |
| `data` | The error body parsed by its Content-Type, whatever the `responseType`; the raw text when it is malformed JSON |
| `response` | The native `Response` (its body has been read; use `data`) |
| `message` | e.g. `HTTP 404 Not Found: GET /users`. The query string is left out, since it may hold tokens; `response.url` has the full URL |

Network failures, aborts and timeouts are **not** wrapped in `HttpError`. They stay native errors, so your existing checks keep working:

```js
const controller = new AbortController()

try {
    await http.get('/users', { signal: controller.signal, timeout: 5000 })
} catch (error) {
    if (error instanceof HttpError) {
        // the server responded with a non-2xx status
    } else if (error.name === 'TimeoutError') {
        // took longer than 5 seconds
    } else if (error.name === 'AbortError') {
        // the request was aborted
    } else {
        // network error (TypeError)
    }
}
```

## Development

```bash
pnpm install
pnpm test        # unit tests (against a real local server, fetch is not mocked)
pnpm coverage    # coverage report
pnpm typecheck
pnpm build       # outputs dist/
pnpm lint:package # checks the published package with publint and attw (run after build)
```

For a change that should be released, run `pnpm changeset` and commit the generated file with your pull request. Once it is merged, the release workflow opens a `chore: version packages` pull request; merging that one publishes to npm with provenance.

## License

MIT

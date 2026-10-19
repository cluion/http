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
| `http.delete` | `(url, options?)` |
| `http.post` | `(url, body?, options?)` |
| `http.put` | `(url, body?, options?)` |
| `http.patch` | `(url, body?, options?)` |

To send a body with `delete`, use `options.body`: `http.delete('/users', { body: { ids: [1, 2] } })`.

### Options

Apart from the fields below, every native [`RequestInit`](https://developer.mozilla.org/docs/Web/API/RequestInit) option (`headers`, `signal`, `credentials`, `cache`, ...) is passed straight to `fetch`.

| Field | Description |
| --- | --- |
| `query` | Query parameters object; see the rules below |
| `body` | Only for `get` / `delete`; `post` / `put` / `patch` take the body as the second argument |
| `timeout` | Milliseconds before the request is aborted with a native `TimeoutError`. Covers the whole request, including reading the body. No timeout when omitted. It works together with your own `signal` |

### Body rules

| You pass | It is sent as |
| --- | --- |
| Plain object, array, number, boolean | `JSON.stringify`, with `Content-Type: application/json` |
| `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, TypedArray, `ReadableStream`, string | Passed to `fetch` as-is; `fetch` decides the Content-Type |
| `undefined`, `null` | No body |

A `Content-Type` you set yourself always wins.

### Query rules

```js
http.get('/users', { query: { page: 1, q: 'a b', ids: [1, 2], role: null } })
// → /users?page=1&q=a+b&ids[]=1&ids[]=2
```

- Arrays serialize as `key[]=value` (same as axios; PHP / Laravel, Rails and Express parse it as an array)
- `null` and `undefined` are skipped
- Appended with `&` when the URL already has a `?`
- Values must be strings, numbers or booleans; nested objects are not supported

### Headers

`Accept: application/json, text/plain, */*` is sent by default (same as axios). Laravel uses this header to return JSON validation errors instead of redirecting. An `Accept` you set yourself replaces the default.

### Return value

The parsed body is returned directly:

| Response | Returns |
| --- | --- |
| JSON Content-Type (`application/json`, `*/*+json`) | The parsed value |
| Any other Content-Type | A string |
| 204 or an empty body | `undefined` |

If a successful response claims to be JSON but cannot be parsed, a native `SyntaxError` is thrown.

### Errors

Only **non-2xx responses** throw `HttpError`:

| Property | Description |
| --- | --- |
| `status` | HTTP status code, e.g. `404` |
| `statusText` | e.g. `Not Found` (may be empty over HTTP/2) |
| `data` | The parsed error body; the raw text when it is malformed JSON |
| `response` | The native `Response` (its body has been read; use `data`) |
| `message` | e.g. `HTTP 404 Not Found: GET /users` |

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
```

## License

MIT

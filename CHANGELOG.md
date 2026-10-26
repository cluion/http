# @cluion/http

## 0.2.1

### Patch Changes

- [#8](https://github.com/cluion/http/pull/8) [`2cee1af`](https://github.com/cluion/http/commit/2cee1af2f949201e11ac297fef7c172c8a402e34) Thanks [@cluion](https://github.com/cluion)! - `http.get` no longer accepts `options.body` in its types, since `fetch` rejects a body on GET. `http.delete` still takes one.

- [#8](https://github.com/cluion/http/pull/8) [`2cee1af`](https://github.com/cluion/http/commit/2cee1af2f949201e11ac297fef7c172c8a402e34) Thanks [@cluion](https://github.com/cluion)! - A `ReadableStream` body is now sent with `duplex: 'half'`, which `fetch` requires to stream a request body, instead of failing with a `TypeError`.

- [#8](https://github.com/cluion/http/pull/8) [`2cee1af`](https://github.com/cluion/http/commit/2cee1af2f949201e11ac297fef7c172c8a402e34) Thanks [@cluion](https://github.com/cluion)! - `timeout` must now be an integer from `0` to `2147483647`; other values reject with a `RangeError` before the request is sent. Previously a negative or fractional value threw a runtime-specific error, and a value above `2147483647` overflowed the timer and aborted the request almost immediately.

## 0.2.0

### Minor Changes

- First release.
  - `http.get`, `http.post`, `http.put`, `http.patch` and `http.delete` on top of the native Fetch API, with no runtime dependencies ([#1](https://github.com/cluion/http/pull/1))
  - Plain objects and arrays are sent as JSON; native bodies such as `FormData` are passed through unchanged ([#1](https://github.com/cluion/http/pull/1))
  - `query` option, serializing arrays as `key[]=value` and skipping `null` and `undefined` ([#1](https://github.com/cluion/http/pull/1))
  - The parsed body is returned directly, and non-2xx responses throw `HttpError` with `status`, `statusText`, `data` and `response` ([#1](https://github.com/cluion/http/pull/1))
  - `timeout` option that aborts with a native `TimeoutError` ([#4](https://github.com/cluion/http/pull/4))
  - `responseType` option (`'json'`, `'text'`, `'blob'` or `'response'`), with the return type inferred in TypeScript ([#5](https://github.com/cluion/http/pull/5))
  - Requires Node.js 22 or later ([#3](https://github.com/cluion/http/pull/3))

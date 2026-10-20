# @cluion/http

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

---
'@cluion/http': minor
---

Add `http.create(defaults)` and `extend(defaults)` for clients that apply default options, including a new `baseURL`, to every request. `headers` and `query` merge per key, and a `null` or `undefined` value drops a default. Other options are replaced by the request's value. A header set to `null` or `undefined` is no longer sent; before, such a value from JavaScript was sent as the string `"null"` or `"undefined"`.

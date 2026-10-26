---
'@cluion/http': minor
---

Add `http.head` and `http.options`. A HEAD response has no body, so `head` returns `undefined` unless `responseType` is `'response'`. Both methods are idempotent, so `retry` retries them by default as well.

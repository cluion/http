---
'@cluion/http': minor
---

Add `hooks` to request and client options: `onRequest` runs before each send and can change the headers or URL, `onResponse` runs before the body is read and can replace the response or `retry()` the request once, and `onError` runs before an `HttpError` is thrown and can throw another error instead. A client's hooks run before the request's, and `extend` appends its hooks after the parent's.

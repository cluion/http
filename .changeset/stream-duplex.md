---
'@cluion/http': patch
---

A `ReadableStream` body is now sent with `duplex: 'half'`, which `fetch` requires to stream a request body, instead of failing with a `TypeError`.

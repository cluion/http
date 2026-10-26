---
'@cluion/http': minor
---

Add a `retry` option, off by default. When set, it retries network errors and the statuses 408, 429, 500, 502, 503 and 504 for GET, PUT and DELETE. It waits 300, 600, 1200 ms and so on, or follows `Retry-After` up to `maxRetryAfter`. A number sets the retry limit, and an object can change `limit`, `methods`, `statusCodes`, `delay` and `maxRetryAfter`. Aborts, timeouts and `ReadableStream` bodies are never retried, and `onRequest` hooks run on every attempt.

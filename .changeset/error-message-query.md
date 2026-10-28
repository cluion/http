---
'@cluion/http': patch
---

`HttpError.message` no longer includes the query string or fragment of the URL, which may hold tokens that would end up in logs. `error.response.url` still has the full URL.

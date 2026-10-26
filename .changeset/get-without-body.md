---
'@cluion/http': patch
---

`http.get` no longer accepts `options.body` in its types, since `fetch` rejects a body on GET. `http.delete` still takes one.

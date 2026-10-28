---
'@cluion/http': patch
---

`responseType` can now be a value only known at runtime, such as a variable typed `ResponseType`, and options typed with the exported `RequestOptions` or `BodyRequestOptions` can be passed through. The result is then typed by the generic, `any` by default. Literal `'text'`, `'blob'` and `'response'` still infer `string`, `Blob` and `Response`.

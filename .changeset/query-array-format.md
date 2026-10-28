---
'@cluion/http': minor
---

Add a `queryArrayFormat` option for backends that do not read `key[]=value`: `'repeat'` sends `ids=1&ids=2`, as FastAPI, Spring and Go expect, and `'comma'` sends `ids=1,2`. The default stays `'brackets'`, and the option also works as a client default.

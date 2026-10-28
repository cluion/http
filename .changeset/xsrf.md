---
'@cluion/http': minor
---

Add an `xsrf` option for cookie-based authentication such as Laravel Sanctum. In browsers it sends the `XSRF-TOKEN` cookie as the `X-XSRF-TOKEN` header, as axios does. The token goes only to the page's own origin and to the listed `origins`, checked against the final URL after `onRequest` hooks, so it never reaches another site. `cookieName` and `headerName` change the defaults. It is off by default and does nothing outside a browser.

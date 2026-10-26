---
'@cluion/http': patch
---

`timeout` must now be an integer from `0` to `2147483647`; other values reject with a `RangeError` before the request is sent. Previously a negative or fractional value threw a runtime-specific error, and a value above `2147483647` overflowed the timer and aborted the request almost immediately.

# @cluion/http

[English](README.md) | [繁體中文](README.zh-TW.md)

基於原生 Fetch API、零執行期依賴的 HTTP Client。自動處理 JSON、查詢參數與非 2xx 狀態碼，不需要先了解 `Request`、`Response`、`Headers` 也能上手。

## 安裝

```bash
npm install @cluion/http
```

需要有全域 `fetch` 的環境：現代瀏覽器、Node.js 22+、Bun、Deno。

## 快速上手

```js
import { http, HttpError } from '@cluion/http'

// 取得資料：直接拿到解析後的 JSON
const users = await http.get('/users')

// 新增資料：物件自動轉成 JSON
await http.post('/users', { name: 'Hugo' })

// 查詢參數
await http.get('/users', { query: { page: 1 } })

// 上傳檔案：FormData 原樣送出
await http.post('/upload', formData)

// 共用預設值，例如 base URL 和 token
const api = http.create({ baseURL: 'https://api.example.com', headers: { Authorization: `Bearer ${token}` } })
await api.get('/users')

// 錯誤處理
try {
    await http.post('/users', { name: '' })
} catch (error) {
    if (error instanceof HttpError) {
        console.log(error.status)       // 422
        console.log(error.data.errors)  // 後端回傳的錯誤內容
    }
}
```

TypeScript 可以用泛型指定回傳型別：

```ts
const users = await http.get<User[]>('/users')
```

## API

### 方法

| 方法 | 簽章 |
| --- | --- |
| `http.get` | `(url, options?)` |
| `http.delete` | `(url, options?)` |
| `http.post` | `(url, body?, options?)` |
| `http.put` | `(url, body?, options?)` |
| `http.patch` | `(url, body?, options?)` |

`delete` 需要帶內容時用 `options.body`：`http.delete('/users', { body: { ids: [1, 2] } })`。

`http` 和由它建立的每個實例也都有 `create`、`extend`，見[實例](#實例)。

### options

除了下列欄位，其餘原生 [`RequestInit`](https://developer.mozilla.org/docs/Web/API/RequestInit) 選項（`headers`、`signal`、`credentials`、`cache`…）都會直接交給 `fetch`。

| 欄位 | 說明 |
| --- | --- |
| `query` | 查詢參數物件，見下方規則 |
| `body` | 只在 `delete` 使用；`post` / `put` / `patch` 用第二個參數。`get` 不能帶 body，因為 `fetch` 不允許 GET 帶內容 |
| `timeout` | 經過幾毫秒後中止請求，丟出原生 `TimeoutError`。必須是 `0` 到 `2147483647`（約 24.8 天）的整數，其他值會在送出前丟出 `RangeError`。涵蓋整個請求，包含讀取 body。不設定就不會逾時，也能和自己的 `signal` 一起使用 |
| `responseType` | 成功回應的 body 讀取方式：`'json'`、`'text'`、`'blob'`、`'response'`，見「回傳值」 |
| `hooks` | 在送出前、收到回應時、發生錯誤時執行的函式，見 [hooks](#hooks) |
| `retry` | 網路錯誤或 503 等狀態碼時自動重試，預設關閉，見[自動重試](#自動重試) |

### body 規則

| 傳入 | 送出方式 |
| --- | --- |
| 一般物件、陣列、數字、布林 | `JSON.stringify`，並設定 `Content-Type: application/json` |
| `FormData`、`URLSearchParams`、`Blob`、`ArrayBuffer`、TypedArray、`ReadableStream`、字串 | 原樣交給 `fetch`，由 `fetch` 決定 Content-Type |
| `undefined`、`null` | 不送 body |

自己設定的 `Content-Type` 永遠優先。`ReadableStream` 會自動帶上 `duplex: 'half'`（`fetch` 串流上傳必填），不需要自己設定。

### query 規則

```js
http.get('/users', { query: { page: 1, q: 'a b', ids: [1, 2], role: null } })
// → /users?page=1&q=a+b&ids[]=1&ids[]=2
```

- 陣列序列化為 `key[]=value`（與 axios 相同，PHP / Laravel、Rails、Express 都能直接解析成陣列）
- `null`、`undefined` 會被略過
- URL 已有 `?` 時接在後面
- 值只接受字串、數字、布林；巢狀物件不支援

### headers

預設帶 `Accept: application/json, text/plain, */*`（與 axios 相同）。Laravel 依這個 header 判斷要回傳 JSON 驗證錯誤，而不是重新導向。自己設定的 `Accept` 會覆蓋預設值。值為 `null` 或 `undefined` 的 header 不會送出。

### 實例

`http.create(defaults)` 會回傳一個方法相同的實例，每個請求都會套用 `defaults`。`defaults` 可以設定 `body`、`responseType` 以外的所有 options，另外多了 `baseURL`。

```js
const api = http.create({
    baseURL: 'https://api.example.com/v1',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
})

await api.get('/users')                           // GET https://api.example.com/v1/users
await api.get('https://cdn.example.com/a.json')   // 完整網址會忽略 baseURL
await api.get('/status', { headers: { Authorization: null } })   // 拿掉預設的 header

const admin = api.extend({ baseURL: 'https://api.example.com/admin' })
```

- `baseURL` 和相對路徑之間固定接一個 `/`。有協定（`https://...`）或以 `//` 開頭的網址會原樣使用（與 axios 相同）
- `headers`、`query` 逐一 key 合併，以請求的值為準；值設成 `null` 或 `undefined` 就會拿掉預設值
- `hooks` 會串接起來：實例的先執行，再執行請求的
- 其他 options 由請求的值整個取代，所以 `timeout: undefined` 可以關掉預設的逾時
- `extend(defaults)` 回傳新實例，依相同規則把 `defaults` 合併進目前的預設值；任何實例上的 `create(defaults)` 則不繼承，從頭開始。兩者都不會改變原本的實例

### hooks

hooks 讓你在每個請求的三個時間點執行自己的程式。每種 hook 都是函式陣列，依序執行，可以是 async。

```js
const api = http.create({
    baseURL: 'https://api.example.com',
    hooks: {
        // 每次請求都讀取當下的 token，token 一換新就會用新的
        onRequest: [({ headers }) => headers.set('Authorization', `Bearer ${store.token}`)],
        // token 過期時刷新，再重送一次
        onResponse: [async ({ response, retry }) => {
            if (response.status === 401) {
                await refreshToken()
                return retry()
            }
        }],
        onError: [(error) => report(error)],
    },
})
```

| hook | 執行時機 | 收到 | 回傳值的作用 |
| --- | --- | --- | --- |
| `onRequest` | 每次送出前，重送也會執行 | `{ method, url, headers, options }` | 不用回傳；直接修改 `headers`，或指定新的 `url` |
| `onResponse` | 任何狀態碼，在讀取 body 之前 | 同上，再加上 `response`、`retry` | 回傳 `Response` 會取代目前的回應 |
| `onError` | 丟出 `HttpError` 之前 | 該 `HttpError` | 回傳 `Error` 會改丟出它 |

- `retry()` 會重送請求，並回傳新的 `Response`，要把它 return 才會採用。重送前會再跑一次 `onRequest`，所以可以帶上刷新後的 token。重送的回應不會再經過 `onResponse`，而且每個請求只能 `retry()` 一次。`ReadableStream` 只能讀一次，所以不能重送
- `url` 已經套用 `baseURL` 和 `query`；`options` 是請求和實例合併後的 options
- 每個 `onError` 收到的都是原本的 `HttpError`；有多個回傳錯誤時，丟出最後一個。網路錯誤、取消、逾時不會經過 `onError`
- hook 丟出錯誤時，請求會以該錯誤失敗
- `timeout` 也涵蓋 hooks 和重送的時間
- 請求設定的 hooks 排在實例的之後執行；`extend` 的 hooks 排在父層之後

### 自動重試

預設不會重試。`retry` 設成數字代表重試次數，要調整更多設定就用物件：

```js
await http.get('/users', { retry: 2 })

const api = http.create({
    baseURL: 'https://api.example.com',
    retry: { limit: 3, statusCodes: [503], delay: (attempt) => 1000 * attempt },
})
```

| 欄位 | 預設值 | 說明 |
| --- | --- | --- |
| `limit` | `2` | 第一次之後最多再重試幾次 |
| `methods` | `['GET', 'PUT', 'DELETE']` | `POST`、`PATCH` 不是冪等操作，重送可能重複建立資料，所以要列出來才會重試 |
| `statusCodes` | `[408, 429, 500, 502, 503, 504]` | 會重試的狀態碼；網路錯誤也會重試 |
| `delay` | `300`、`600`、`1200`… | `(attempt) => 毫秒`，每次重試前等待的時間，`attempt` 從 1 開始 |
| `maxRetryAfter` | `60000` | 超過這個時間的 `Retry-After` 不等待 |

- 回應有 `Retry-After` header（秒數或 HTTP 日期）時，改等它指定的時間，不用 `delay`。超過 `maxRetryAfter` 就不重試，直接採用這個回應，所以 429 會立刻丟出 `HttpError`
- 取消和逾時不會重試；`timeout` 涵蓋所有嘗試和等待的時間。`ReadableStream` 只能讀一次，所以永遠不會重試
- 每次嘗試都會執行 `onRequest`，所以每次都會讀到當下的 token；`onResponse` 只會收到最後的回應；hook 裡的 `retry()` 也一樣會自動重試
- 跟其他 options 一樣，請求的 `retry` 會整個取代實例的設定，所以 `retry: 0` 可以只關掉某次請求的重試

### 回傳值

預設直接回傳解析後的 body：

| 回應 | 回傳 |
| --- | --- |
| Content-Type 為 JSON（`application/json`、`*/*+json`） | 解析後的值 |
| 其他 Content-Type | 字串 |
| 204、空內容或只有空白 | `undefined` |

成功回應宣稱是 JSON 卻無法解析時，會丟出原生 `SyntaxError`。

可以用 `responseType` 指定讀取方式，TypeScript 會依此推論回傳型別：

| `responseType` | 回傳 |
| --- | --- |
| `'json'` | 不管 Content-Type，一律當 JSON 解析；空內容為 `undefined` |
| `'text'` | 字串；空內容為 `''` |
| `'blob'` | `Blob`，適合檔案、圖片 |
| `'response'` | 原生 `Response`，body 尚未讀取，可以讀 status、headers 或用串流處理 |

```js
const avatar = await http.get('/avatar.png', { responseType: 'blob' })

const response = await http.get('/users', { responseType: 'response' })
response.headers.get('x-total-count')
const users = await response.json()
```

不管 `responseType` 是什麼，非 2xx 回應都會丟出 `HttpError`。有設定 `timeout` 時，讀取 `'response'` 的 body 也算在逾時時間內。

### 錯誤

只有 **非 2xx 回應** 會丟出 `HttpError`：

| 屬性 | 說明 |
| --- | --- |
| `status` | HTTP 狀態碼，例如 `404` |
| `statusText` | 例如 `Not Found`（HTTP/2 可能為空字串） |
| `data` | 依 Content-Type 解析的錯誤內容（與 `responseType` 無關）；JSON 壞掉時為原始文字 |
| `response` | 原生 `Response`（body 已讀取，請改用 `data`） |
| `message` | 例如 `HTTP 404 Not Found: GET /users` |

網路斷線、取消、逾時 **不會** 包成 `HttpError`，維持原生錯誤，原本的判斷方式都能用：

```js
const controller = new AbortController()

try {
    await http.get('/users', { signal: controller.signal, timeout: 5000 })
} catch (error) {
    if (error instanceof HttpError) {
        // 伺服器回了非 2xx
    } else if (error.name === 'TimeoutError') {
        // 超過 5 秒
    } else if (error.name === 'AbortError') {
        // 被取消
    } else {
        // 網路錯誤（TypeError）
    }
}
```

## 開發

```bash
pnpm install
pnpm test        # 單元測試（使用真實本機伺服器，不 mock fetch）
pnpm coverage    # 覆蓋率
pnpm typecheck
pnpm build       # 輸出 dist/
pnpm lint:package # 用 publint 和 attw 檢查要發佈的套件內容（需先 build）
```

需要發佈的變更，請執行 `pnpm changeset`，並把產生的檔案跟 PR 一起 commit。合併後 release workflow 會開一個 `chore: version packages` PR，合併那個 PR 就會發佈到 npm，並附上 provenance。

## 授權

MIT

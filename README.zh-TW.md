# @cluion/http

[English](README.md) | [繁體中文](README.zh-TW.md)

基於原生 Fetch API、零執行期依賴的 HTTP Client。自動處理 JSON、查詢參數與非 2xx 狀態碼，不需要先了解 `Request`、`Response`、`Headers` 也能上手。

## 安裝

```bash
npm install @cluion/http
```

需要有全域 `fetch` 的環境：現代瀏覽器、Node.js 18+、Bun、Deno。

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

### options

除了下列欄位，其餘原生 [`RequestInit`](https://developer.mozilla.org/docs/Web/API/RequestInit) 選項（`headers`、`signal`、`credentials`、`cache`…）都會直接交給 `fetch`。

| 欄位 | 說明 |
| --- | --- |
| `query` | 查詢參數物件，見下方規則 |
| `body` | 只在 `get` / `delete` 使用；`post` / `put` / `patch` 用第二個參數 |

### body 規則

| 傳入 | 送出方式 |
| --- | --- |
| 一般物件、陣列、數字、布林 | `JSON.stringify`，並設定 `Content-Type: application/json` |
| `FormData`、`URLSearchParams`、`Blob`、`ArrayBuffer`、TypedArray、`ReadableStream`、字串 | 原樣交給 `fetch`，由 `fetch` 決定 Content-Type |
| `undefined`、`null` | 不送 body |

自己設定的 `Content-Type` 永遠優先。

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

預設帶 `Accept: application/json, text/plain, */*`（與 axios 相同）。Laravel 依這個 header 判斷要回傳 JSON 驗證錯誤，而不是重新導向。自己設定的 `Accept` 會覆蓋預設值。

### 回傳值

直接回傳解析後的 body：

| 回應 | 回傳 |
| --- | --- |
| Content-Type 為 JSON（`application/json`、`*/*+json`） | 解析後的值 |
| 其他 Content-Type | 字串 |
| 204 或空內容 | `undefined` |

成功回應宣稱是 JSON 卻無法解析時，會丟出原生 `SyntaxError`。

### 錯誤

只有 **非 2xx 回應** 會丟出 `HttpError`：

| 屬性 | 說明 |
| --- | --- |
| `status` | HTTP 狀態碼，例如 `404` |
| `statusText` | 例如 `Not Found`（HTTP/2 可能為空字串） |
| `data` | 已解析的錯誤內容；JSON 壞掉時為原始文字 |
| `response` | 原生 `Response`（body 已讀取，請改用 `data`） |
| `message` | 例如 `HTTP 404 Not Found: GET /users` |

網路斷線、取消、逾時 **不會** 包成 `HttpError`，維持原生錯誤，原本的判斷方式都能用：

```js
const controller = new AbortController()

try {
    await http.get('/users', { signal: controller.signal })
} catch (error) {
    if (error instanceof HttpError) {
        // 伺服器回了非 2xx
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
```

## 授權

MIT

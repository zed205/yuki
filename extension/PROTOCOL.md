# Yuki Browser Control — Extension ⇄ Server Protocol

This document is the **single source of truth** for the WebSocket protocol between the
Yuki Browser Control extension (a plain-JS MV3 extension that runs in any Chromium
browser) and the Yuki server (Express + `ws`). Both sides implement against this file.

## Goals
- Let the Yuki agent drive the user's **real, signed-in, open** Chromium browser
  (Chrome / Edge / Brave / any Chromium build) via the Chrome DevTools Protocol (CDP),
  preserving cookies/logins/permissions — instead of launching a separate Playwright browser.
- Works in **any** Chromium browser that has the extension loaded — it does not assume the
  browser is the OS default, and it supports **multiple** browsers connected at once
  (each is addressed by a `browserId`).
- No chat/approval UI. Just transport + command dispatch.

## Transport
- **Endpoint:** `ws://localhost:3210/ws/browser-ext`
- **Client = extension.** The extension is the WebSocket *client*; it connects, reconnects,
  and heartbeats. The **Yuki server** is the WS *server* for this endpoint (a dedicated
  `WebSocketServer`, separate from the main `/ws` chat endpoint).
- All frames are JSON text.
- The extension keeps the socket alive with periodic `ping` (and the server also pings).
  This also keeps the MV3 service worker awake.

## Message envelope
Three message `type`s:

### 1. Request (server → extension) — a command to execute
```json
{ "id": "<uuid>", "type": "request", "method": "navigate", "params": { "url": "https://example.com" } }
```

### 2. Response (extension → server) — result of a request
```json
{ "id": "<uuid>", "type": "response", "ok": true,  "result": { "...": "structured JSON" } }
{ "id": "<uuid>", "type": "response", "ok": false, "error": "human-readable error" }
```
`id` echoes the request `id`. Every request gets exactly one response (ok or error).

### 3. Event (bidirectional, no id, no matching response)
```json
{ "type": "event", "method": "hello",       "payload": { "browserId": "brw-abc", "browser": "<ua>", "protocol": 1, "version": "1.0.0", "activeTabId": 12 } }
{ "type": "event", "method": "tabsChanged", "payload": { "tabs": [ { "id": 12, "url": "...", "title": "...", "active": true } ] } }
{ "type": "event", "method": "ping",        "payload": { "t": 1699999999999 } }
{ "type": "event", "method": "pong",        "payload": { "t": 1699999999999 } }
{ "type": "event", "method": "welcome",     "payload": { "ok": true } }
```

## Handshake
1. Extension connects to `ws://localhost:3210/ws/browser-ext`.
2. On open, extension sends a `hello` event with `browserId` (stable, persisted in
   `chrome.storage.local`), browser UA, `protocol`, `version`, and current `activeTabId`.
3. Server records `browserId → socket`, maps the socket back to `browserId`, and replies with
   a `welcome` event.
4. Heartbeat: each side may send `ping`; the other replies `pong`. Server pings ~every 15s.
   Extension also pings if silent for >15s. Either direction keeps the socket alive.

## Targeting a tab
- Most commands take an optional `tabId` (a Chrome tab id, number). If omitted, the
  extension targets the **active tab** of the focused window.
- CDP commands require the debugger to be attached to the tab. The extension
  **auto-attaches** lazily on the first CDP command for a given tab and caches the attachment
  in `attachedTabs`. `attach`/`detach` are also exposed explicitly.
- Attaching shows the standard Chromium "being controlled by automated test software" bar
  on that tab. Only one debugger can attach to a tab at a time; if DevTools is already open
  on that tab, attach fails and the command returns `{ ok:false, error:"Attach failed: ..." }`.

## Methods (request `method` → behavior)
All methods resolve to a `result` object unless noted. Errors return `ok:false`.

### Connection / inspection
| method | params | result |
| --- | --- | --- |
| `status` | — | `{ connected, browserId, version, protocol, tabCount, activeTabId, attachedTabs[] }` |
| `listTabs` | — | `{ tabs: [{ id, windowId, url, title, active, pinned, index }] }` |
| `getActiveTab` | — | `{ id, url, title }` |
| `createTab` | `{ url?, active?=true }` | `{ tabId }` |
| `focusTab` | `{ tabId? }` | `{ focused, tabId }` |
| `closeTab` | `{ tabId? }` | `{ closed, tabId }` |
| `attach` | `{ tabId? }` | `{ attached, tabId }` |
| `detach` | `{ tabId? }` | `{ detached, tabId }` |

### Navigation
| method | params | result |
| --- | --- | --- |
| `navigate` | `{ url, tabId?, waitFor?=true }` | `{ navigated, url, tabId, loadComplete }` (uses `chrome.tabs.update`) |
| `back` | `{ tabId? }` | `{ back, tabId }` (CDP `history.go(-1)`) |
| `forward` | `{ tabId? }` | `{ forward, tabId }` (CDP `history.go(1)`) |
| `reload` | `{ tabId? }` | `{ reloaded, tabId }` |

### Reading (CDP)
| method | params | result |
| --- | --- | --- |
| `screenshot` | `{ tabId?, fullPage?=false }` | `{ data: <raw base64>, mimeType: "image/png", fullPage }` |
| `eval` | `{ script, tabId?, awaitPromise?=true }` | `{ value, type }` or `{ exception: true, text }` |
| `axTree` | `{ tabId? }` | `{ tree: <indented text> }` |
| `visibleElements` | `{ tabId? }` | `{ elements: [{ tag, text, role, href, x, y, width, height }] }` |
| `links` | `{ tabId? }` | `{ links: [{ href, text }] }` |
| `text` | `{ tabId? }` | `{ text }` |
| `html` | `{ selector?, tabId? }` | `{ html }` |
| `pageStructure` | `{ tabId? }` | `{ title, url, readyState, headings[], linkCount, formCount, captcha }` |

### Input (CDP)
| method | params | result |
| --- | --- | --- |
| `click` | `{ tabId?, selector?, x?, y?, button?='left', clickCount?=1 }` | `{ clicked, x, y, button, clickCount }` |
| `fill` | `{ selector?, value, clear?=true }` | `{ filled, selector, value }` (focus → select-all → insertText) |
| `type` | `{ selector?, text }` | `{ typed, text }` (insertText at cursor) |
| `key` | `{ key, code?, modifiers?=0, text? }` | `{ pressed, modifiers }` (keyDown+keyUp) |
| `hover` | `{ selector?, x?, y? }` | `{ hovered, x, y }` |
| `scroll` | `{ direction?, dx?, dy?, amount?=300, x?, y? }` | `{ scrolled, dx, dy }` (mouseWheel; `top`/`bottom` jump) |
| `scrollTo` | `{ selector }` | `{ scrolledTo }` |

CDP key `modifiers` bitmask: `Alt=1, Ctrl=2, Meta/Command=4, Shift=8`.

### Monitoring (CDP, best-effort)
| method | params | result |
| --- | --- | --- |
| `network` | `{ tabId?, limit?=50, clear?=false }` | `{ requests: [{ url, method, status, type, finished }] }` |
| `console` | `{ tabId?, limit?=50 }` | `{ messages: [{ level, text }] }` |

`network`/`console` buffer recent entries per attached tab (capped at 500 each).

## Server-side notes
- The server wraps the socket in a `BrowserExtension` class that keeps a
  `Map<browserId, socket>` and a `Map<id, pendingRequest>`, and exposes
  `dispatch(action, params, browserId?)` → **a string** (the tool result the LLM sees).
- `dispatch` formats the structured `result` into a readable string. **For `screenshot`,
  it returns the raw base64 `result.data`** (no `data:` prefix) so `agent.ts` can wrap it in
  `data:image/png;base64,...` for the vision model (same convention as `browser_screenshot`).
- Default command timeout is 30s (screenshot/eval may use a longer timeout).
- The extension's `hello`/`tabsChanged`/`ping` are handled as events; `tabsChanged` may be
  used later to drive a UI status indicator.

## Failure modes
- **Not connected:** `dispatch` rejects → the agent tool returns
  `"Error: no browser extension is connected. Load the Yuki Browser Control extension in a Chromium browser."`
- **Attach failed (DevTools open):** the extension returns `{ ok:false, error }`; the server
  passes the message through.
- **Unknown method:** the extension returns `{ ok:false, error: "Unknown method: ..." }`.

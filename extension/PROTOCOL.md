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
| `status` | — | `{ connected, browserId, version, protocol, tabCount, activeTabId, attachedTabs[], session, openDialogs[] }` |
| `listTabs` | — | `{ tabs: [{ id, windowId, url, title, active, pinned, index, groupId, group }], session }` |
| `getActiveTab` | — | `{ id, url, title }` |
| `createTab` | `{ url?, active?=true, color? }` | `{ tabId, active, session, groupId }` (joins the session tab group when one is set) |
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
| `screenshot` | `{ tabId?, fullPage?=false, maxHeight?=8000 }` | `{ data: <raw base64>, mimeType: "image/png", fullPage, width?, height?, scale?, slices?, cssHeight?, truncated?, fixedHidden? }` |
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

### Accessibility-tree actions (preferred for React/SPA & rich editors)
These mirror ChatGPT's browser-use approach: `axTree` returns a tree where each
actionable element carries a stable `idx=N` element index (backed by the AX
node's `backendDOMNodeId`). Subsequent `ax*` methods act on that index, not a
CSS selector or coordinates. Indices are cached per tab and invalidated on
navigation — re-run `axTree` after the page changes.

| method | params | result |
| --- | --- | --- |
| `axTree` | `{ tabId? }` | `{ tree, indexed }` — tree text with `idx=N` markers; `indexed` = count of actionable elements |
| `axClick` | `{ elementIndex, x?, y?, button?='left', clickCount?=1 }` | `{ clicked, x, y, elementIndex, role, button, clickCount }` (`DOM.scrollIntoViewIfNeeded`+`DOM.getContentQuads`→center→`Input.dispatchMouseEvent`) |
| `axSetValue` | `{ elementIndex, value }` | `{ set, elementIndex, role, value }` — in-page semantic setter via `DOM.resolveNode`+`Runtime.callFunctionOn(userGesture)`; handles checkbox/radio/select/text/contenteditable |
| `axType` | `{ text, elementIndex? }` | `{ typed, elementIndex, text }` — editor-aware trusted typing (`Input.dispatchKeyEvent`; `\\n`→`commands:["insertParagraph"]`, `\\t`→`["insertTab"]`) |
| `axPressKey` | `{ key, elementIndex?, modifiers?=0, text? }` | `{ pressed, elementIndex, modifiers, inserted? }` — focuses element (if given) then key |
| `axSelectText` | `{ elementIndex, text, prefix?, suffix?, selectionType?='text' }` | `{ selected, elementIndex, text, selectionType }` — `selectionType`: `text`\|`cursor_before`\|`cursor_after` |

### Monitoring (CDP, best-effort)
| method | params | result |
| --- | --- | --- |
| `network` | `{ tabId?, limit?=50, clear?=false }` | `{ requests: [{ url, method, status, type, finished }] }` |
| `console` | `{ tabId?, limit?=50 }` | `{ messages: [{ level, text }] }` |

`network`/`console` buffer recent entries per attached tab (capped at 500 each).

### Screenshots: why they are stitched
Chrome 158 **ignores `captureBeyondViewport`** and its `clip` rectangle is unusable:

- a clip larger than the viewport returns an image of the requested size with only the
  first viewport painted (everything below is white), and
- a clip the size of a single element returns a blank (pure white) image.

Measured on a 1.1× display: a `clip` of `{x:354, y:419, width:240, height:60}` produced a
252-byte all-white PNG, while the same page captured without a clip produced real pixels.

So the extension never relies on `clip`:

- `screenshot { fullPage: true }` scrolls the page, captures the viewport at each offset,
  and stitches the slices with `OffscreenCanvas` (cropped to the content width so the
  scrollbar does not repeat). The original scroll position is restored afterwards.
  Fixed/sticky elements are hidden from the second slice onwards (`fixedHidden` = how many)
  so a sticky header does not repeat down the image; `visibility:hidden` keeps the layout.
  Height is capped by `maxHeight` (default 8000 CSS px) → `truncated: true` when hit.
- `screenshot {}` (viewport) is a plain `Page.captureScreenshot` — **device pixels**
  (CSS × `devicePixelRatio`), whereas stitched full-page images are **CSS pixels**
  (`scale` is reported).
- `axScreenshot` captures the viewport and crops when the element fits; for elements
  taller/wider than the viewport it stitches the page and crops in document space
  (`stitched: true`), so tall elements are captured in full.

### Dialogs & waits
| method | params | result |
| --- | --- | --- |
| `dialogList` | `{ tabId? }` | `{ open: [{ tabId, type, message, defaultPrompt, url, openMs }], recent: [{ tabId, type, message, action, at }] }` |
| `handleDialog` | `{ action: "accept"\|"dismiss", promptText?, tabId? }` | `{ handled, action, type, message, promptText?, tabId }` |
| `waitFor` | `{ condition: "element"\|"text"\|"url"\|"networkIdle"\|"load"\|"dialog", selector?, state?="visible", text?, url?, regex?, exact?, dialogType?, timeoutMs?=5000, intervalMs?=150, idleMs?=500, tabId? }` | `{ ok: true, condition, waitedMs, detail, tabId }` — throws on timeout |

Dialogs are captured from the `Page.javascriptDialogOpening` CDP event (the `Page`
domain is enabled on attach) and cleared on `Page.javascriptDialogClosed`. While a
dialog is open the page's JS is blocked, so `waitFor` fails fast with a hint to call
`handleDialog` rather than polling into the void. `waitFor` element states: `attached`
(in DOM), `visible` (default), `hidden` (in DOM but invisible), `detached` (gone).
`url` matches by substring unless `regex:true` or `exact:true`.

### Session, viewport, element capture & reading
| method | params | result |
| --- | --- | --- |
| `nameSession` | `{ name, color?="blue" }` (empty name or `clear:true` clears) | `{ session, cleared, groupId, grouped, note }` |
| `setViewport` | `{ width, height, deviceScaleFactor?=1, mobile?=false }` or `{ reset: true }` | `{ viewport: { width, height, deviceScaleFactor, mobile }, achieved, matched, corrected, dpr, original }` / `{ reset: true, restored }` |
| `axScreenshot` | `{ elementIndex \| selector, padding?=0, tabId? }` | `{ data: <raw base64>, mimeType: "image/png", label, clip, elementSize, imageSize, dpr, stitched, pageTruncated, clipped, viewport }` |
| `readPage` | `{ selector?, maxChars?=20000, tabId? }` | `{ title, url, markdown, chars, blocks, truncated }` |

`nameSession` groups the active tab into a Chrome tab group named after the session
(requires the `tabGroups` permission); `createTab` then auto-joins new tabs to that
group, and `createTab:{active:false}` keeps the user's focus where it is. The session
name is persisted in `chrome.storage.local` and restored on boot.

`setViewport` uses `Emulation.setDeviceMetricsOverride` (per attached tab; cleared by
`{ reset: true }` or on detach). Chrome sizes the tab widget in **device** pixels for
desktop emulation (so a 900×600 request lands on 818×545 CSS px at 1.1× DPR) but treats
the request as CSS pixels for mobile emulation, so the extension applies its best guess,
measures `innerWidth`/`innerHeight`, and corrects once — `achieved`/`matched` report the
truth (`corrected:true` when the second pass ran). `reset` clears the override and then
re-applies the pre-override size, because Chrome does not restore the widget size itself.
`axScreenshot` scrolls the element into view, measures it
in viewport CSS pixels (`getBoundingClientRect`), captures the **whole viewport** and crops
the element out with `OffscreenCanvas` at `devicePixelRatio` scale. It deliberately does
*not* use `Page.captureScreenshot`'s `clip`: in current Chrome that clip is offset by the
browser window chrome, so element-sized clips land on the wrong region and come back blank.
`clip` is reported in CSS pixels, `imageSize` in device pixels (`clip × dpr`).
`clipped:true` means the element extended past the viewport, so only the visible part was
captured. `readPage` picks `article`/`main`/`[role=main]`/`body`, strips boilerplate
(`nav`/`aside`/`footer`/`form`/`[aria-hidden]`/…) and serialises headings, paragraphs,
lists, tables, code blocks, blockquotes and links to markdown.

## Server-side notes
- The server wraps the socket in a `BrowserExtension` class that keeps a
  `Map<browserId, socket>` and a `Map<id, pendingRequest>`, and exposes
  `dispatch(action, params, browserId?)` → **a string** (the tool result the LLM sees).
- `dispatch` formats the structured `result` into a readable string. **For `screenshot`,
  it returns the raw base64 `result.data`** (no `data:` prefix) so `agent.ts` can wrap it in
  `data:image/png;base64,...` for the vision model (same convention as `browser_screenshot`).
  `axScreenshot` follows the same convention.
- Default command timeout is 30s (screenshot/eval may use a longer timeout). `waitFor`
  gets `min(timeoutMs, 60000) + 10s` so a long wait is not cut short by the socket.
- The extension's `hello`/`tabsChanged`/`ping` are handled as events; `tabsChanged` may be
  used later to drive a UI status indicator.

## Failure modes
- **Not connected:** `dispatch` rejects → the agent tool returns
  `"Error: no browser extension is connected. Load the Yuki Browser Control extension in a Chromium browser."`
- **Attach failed (DevTools open):** the extension returns `{ ok:false, error }`; the server
  passes the message through.
- **Unknown method:** the extension returns `{ ok:false, error: "Unknown method: ..." }`.

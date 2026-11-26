# Yuki Browser Control (extension)

A small **Manifest V3 browser extension** that lets the **local Yuki agent** drive
your *real* browser — the one you're actually using, signed in to everything — via
the Chrome DevTools Protocol (CDP). It works in **any Chromium-based browser**
(Chrome, Edge, Brave, etc.), not just the OS default, and it supports **multiple
browsers connected at once**.

There is **no chat or approval UI** here — this is purely the transport + command
bridge. The agent uses it through the built-in `ext_browser` tool.

## How it works
```
 Yuki agent ──ext_browser tool──▶ Yuki server (ws://localhost:3210/ws/browser-ext)
                                              │  request {method, params}
                                              ▼
                                        Extension (service worker)
                                              │  chrome.debugger.attach(tab) + CDP
                                              ▼
                                        Your open browser tab
```
- The extension is a **WebSocket client**; it connects to the Yuki server, sends a
  `hello`, and heartbeats so its MV3 service worker stays awake.
- The server sends `request` frames; the extension executes them via `chrome.debugger`
  (CDP `Input.*`, `Page.captureScreenshot`, `Runtime.evaluate`, `Accessibility`,
  `Network`, …) plus `chrome.tabs` for tab management, and replies with `response`.
- See **[PROTOCOL.md](./PROTOCOL.md)** for the full method list and message envelope.

## Install (load unpacked)
1. Make sure the Yuki server is running (default `http://localhost:3210`).
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Turn on **Developer mode** (toggle in the top-right).
4. Click **Load unpacked** and select this `extension/` folder.
5. Pin the **Yuki Browser Control** icon. Clicking it shows live connection status.

To confirm it's connected, open the popup — it should read **"Connected to Yuki"**.

> **Tip:** On first run the extension will connect automatically. If Yuki isn't running,
> it retries with backoff and keeps trying. Use **Reconnect** in the popup to force a retry.

## Using it from the agent
Ask Yuki to use your browser, e.g.:
- "Open the Yuki dashboard in my browser and screenshot it."
- "Go to the site I have open and click the login button."
- "Evaluate `document.title` in the active tab."

The agent's `ext_browser` tool takes `action` + `params` (+ optional `browserId` to pick
which connected browser when several are running). A few actions:

| action | what it does | key params |
| --- | --- | --- |
| `status` | connection / tab overview | — |
| `listTabs` | all open tabs | — |
| `navigate` | load a URL | `url`, `tabId?` |
| `click` | click by selector/coords | `selector?`, `x?`,`y?`, `button?`, `clickCount?` |
| `fill` | fill a field | `selector`, `value` |
| `type` / `key` | type text / press key | `text` / `key`, `modifiers?` |
| `screenshot` | capture the tab (vision) | `fullPage?` |
| `eval` | run JS in the page | `script` |
| `axTree` / `visibleElements` / `links` / `text` | read the page | `tabId?` |
| `network` / `console` | recent requests / console | `limit?` |

When a screenshot is taken, Yuki (with a vision model) **sees** the page, the same way
the built-in `browser_screenshot` works.

## Targeting multiple browsers

Every browser that has the extension loaded connects to the **same** Yuki server as an
independent WebSocket client, so you can drive several at once (e.g. Brave for your real
work profile and Edge for a clean test profile).

### Identity
- Each extension install generates a persistent `browserId` (`brw-xxxxxxxxxxxx`) stored in
  `chrome.storage.local` and sends it in its `hello` frame. It survives browser restarts.
- The server keeps a registry per socket and exposes:
  `GET /api/browser-ext/status` → `{ connected, count, connections: [{ browserId, connectedAt, userAgent }] }`.
  The `userAgent` is how you tell Brave from Edge; the `browserId` is how you address them.
- `ext_browser { action: "status" }` returns the same view from the agent's side.

### Addressing rules (`resolveWs`)
| connected browsers | no `browserId` | `browserId` given |
| --- | --- | --- |
| 0 | error: no extension connected (mentions the server port) | error |
| 1 | that browser | that browser (must match) |
| 2+ | **error** listing the connected ids | exact match, else an error listing the valid ids |

Two or more browsers never silently fall back to "the first one" — ambiguous targets fail
loudly instead of acting on the wrong browser.

### Efficient patterns
1. **Discover once, then pin.** Call `status` at the start of a task, remember the
   `browserId`s, and pass `browserId` on every later call. Fan-out work in parallel: each
   call is an independent request/response frame, so N browsers can be driven concurrently.
2. **Pin the tab too.** Once you have a `tabId` (from `createTab`/`listTabs`), pass it
   explicitly. Omitting `tabId` targets *the active tab of the focused window* — which
   changes silently if the user switches tabs mid-task.
3. **Keep each browser's work separate.** `nameSession { name }` puts agent-opened tabs in a
   named Chrome tab group per browser, and `createTab { active: false }` keeps them in the
   background so the user's focus is untouched. `listTabs` reports each tab's group.
4. **Poll with `waitFor`, not sleeps.** One `waitFor` (150 ms interval) replaces a chain of
   `eval` calls and fails fast when a dialog blocks the page.
5. **Screenshot once per browser.** `screenshot { fullPage: true }` scrolls and stitches, so
   prefer the viewport shot unless you need the whole page; `axScreenshot` is cheapest for a
   single element.
6. **Scripted fan-out.** The agent tool and the HTTP relay share one code path:
   `POST /api/browser-ext/cmd { method, params, browserId? }` — handy for CI or for driving
   several browsers from a script.

### Practical limits
- One debugger per tab: if DevTools is open on a tab, `attach` fails for that tab.
- Every browser must point at the same server (`ws://localhost:<port>/ws/browser-ext`);
  the default is 3210, configurable via `chrome.storage.local.wsUrl`.
- `chrome://` and Web Store pages are off-limits to the debugger.
- Different browsers mean different cookie jars/profiles — ideal for multi-account flows,
  but a command never crosses from one browser to another.

## Notes & limitations
- Attaching CDP shows the standard *"being controlled by automated test software"* bar on
  the tab. It's removed when the tab detaches or the browser closes.
- Only **one debugger** can attach to a tab at a time. If DevTools is open on that tab,
  attach fails — close DevTools on that tab (or use a different tab).
- `chrome://` and Web Store pages are restricted by Chromium; most control targets normal
  web pages.
- The default server endpoint is `ws://localhost:3210/ws/browser-ext`. If you run Yuki on a
  different port, set `wsUrl` in the extension's `chrome.storage.local` (or pass it via a
  `config` event) — e.g. `ws://localhost:3300/ws/browser-ext`.

## Files
- `manifest.json` — MV3 manifest (permissions: `debugger`, `tabs`, `storage`, `alarms`).
- `background.js` — service worker: WS client + CDP command dispatch.
- `popup.html` / `popup.js` — connection-status popup.
- `icons/` — generated icons (`node make-icons.js` to regenerate).
- `PROTOCOL.md` — the extension ⇄ server protocol contract.

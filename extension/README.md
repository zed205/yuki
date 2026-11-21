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

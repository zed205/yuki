# Yuki vs Codex Browser Extension — Feature Gap Tracker

> **Status note (Nov 2026):** Items #1–5 (AX action layer) and #8–9 (dialogs, waits, session,
> viewport, element screenshot, reading mode) are implemented and e2e-verified.
> Items #6 (select option / form autofill) and #7 (file upload/download) remain, plus the
> audit gaps #10–#20 below (iframe/shadow-DOM coverage, click hit-testing, drag & drop,
> response bodies, storage, emulation, …) which were never on the original Codex checklist.
> All new methods are wired through `extension/background.js` → `extension/PROTOCOL.md`
> → `src/server/browser-ext.ts` (`formatResult`) → `src/server/tools.ts` (`ext_browser`).

## Legend
- ✅ **Done** — implemented in `extension/background.js`, wired into `src/server`, e2e-verified.
- ⬜ **Not done** — Codex browser-use capability we have not built yet.

---

## Implemented (#1–5, #8–9)

| # | Feature | Yuki method(s) | Status |
|---|---------|----------------|--------|
| 1 | Accessibility-tree snapshot with stable per-page element indices | `axTree` | ✅ |
| 2 | Click an element by AX index (scroll-into-view + real mouse event) | `axClick` | ✅ |
| 3 | Set values on form controls (input, textarea, select, checkbox/radio) via native setters | `axSetValue` | ✅ |
| 4 | Editor-aware trusted typing (rawKeyDown + `insertParagraph`/`insertTab`) | `axType` | ✅ |
| 5 | Key press + text selection on an AX-indexed element | `axPressKey`, `axSelectText` | ✅ |
| 8a | Dialog handling (`alert`/`confirm`/`prompt`/`beforeunload`) | `dialogList`, `handleDialog` | ✅ |
| 8b | Conditional waits | `waitFor` (`element`/`text`/`url`/`networkIdle`/`load`/`dialog`) | ✅ |
| 9a | Session / tab-group hygiene, background tabs | `nameSession` (+ `createTab{active:false}` auto-joins the group) | ✅ |
| 9b | Viewport control | `setViewport` (DPR-compensated, `reset` restores) | ✅ |
| 9c | Per-element screenshot | `axScreenshot` (viewport shot + OffscreenCanvas crop) | ✅ |
| 9d | Reading mode (page → markdown) | `readPage` | ✅ |

## Remaining (#6–7)

| # | Codex capability | What it would add to Yuki |
|---|------------------|---------------------------|
| 6 | **Select option** (dedicated `<option>` picking) + **form autofill** | `axSetValue` handles a single `<select>` by value or unique label today; a first-class `axSelectOption` + multi-field autofill would match Codex |
| 7 | **File upload / download** | `axUploadFiles` (set `<input type=file>` via CDP `DOM.setFileInputFiles`) and download capture/monitoring |

### #6 — select option / form autofill (partial)

Already working: `axSetValue` on a `<select>` picks the option whose `value` matches, else the
unique option whose `label`/`text` matches. It rejects ambiguous labels and disabled options, and
verifies the selection stuck (`AX_SET_VALUE_HELPER` in `extension/background.js`).

Still missing:

- **Multi-select** — `self.multiple` throws "Multi-select controls are not supported"
  (`background.js:1120`). Needs `selectedValues: []` plus a native-setter loop.
- **Pick by option index**, and an explicit *visible text* vs *value* distinction (today they are
  conflated in one probe).
- **`axSelectOption` with a helpful failure** — on a miss, return the available options so the
  model can recover instead of guessing a second time (Codex does this).
- **ARIA comboboxes** — click the trigger, then click/fill the matching option in the listbox.
  Native `<select>` only today.
- **Batch autofill** — one call with a `{label|selector: value}` map and a per-field result
  report, instead of N round trips of `axSetValue`.

### #7 — file upload / download (not started)

- **`axUploadFiles`** — `DOM.setFileInputFiles` with the `backendNodeId` that `axTree` already
  resolves; also handles hidden inputs proxied by a custom button. Cheapest item on the list.
- **File-chooser interception** — `Page.setInterceptFileChooserDialog` +
  `Page.fileChooserOpened`, so clicking a real "Choose file" button can be answered.
- **Downloads** — `Browser.setDownloadBehavior` to a managed directory, capture
  `Page.downloadWillBegin` / `Page.downloadProgress`, expose `downloadList` + `waitForDownload`.
- **Drop-zone upload** — `Input.dispatchDragEvent` (shares the drag machinery from #13).

---

## Additional gaps (Nov 2026 audit)

These were never on the original Codex parity checklist, but each is something Codex/Playwright
does and Yuki does not. Ordered by how often it bites a real task.

| # | Gap | Today | Why it matters | Rough work |
|---|-----|-------|----------------|-----------|
| 10 | **iframes** | `axTree` calls `Accessibility.getFullAXTree` on the tab target, so it is **main frame only**. No `contentDocument` walk, no per-frame sessions. | Stripe checkouts, embedded editors, comment widgets, embedded video are invisible to every AX action. Biggest hole in the set. | ~½ day (same-process frames + OOPIF via `Target.setAutoAttach`) |
| 11 | **Shadow DOM / web components** | no `pierce` anywhere; `document.querySelector` stops at a shadow boundary | AX clicks can work (backendNodeId + quads) while `click`/`fill`/`text`/`html` silently miss — inconsistent and confusing to debug | ~2h (deep-query helper walking open shadow roots) |
| 12 | **Click hit-testing / actionability** | `axClick` scrolls into view and dispatches at the quad centre | a cookie banner or sticky header over that point eats the click **silently**; no visible/stable/enabled/receives-events retry loop | ~1h (`elementFromPoint` check + one re-resolve retry) |
| 13 | **Drag & drop** | none | can't drag between elements or coords (Kanban boards, sliders, sortable lists, drop-zone uploads) | ~1h (`Input.dispatchMouseEvent` press/move/release sequence) |
| 14 | **Response bodies / HAR** | `network` records requests only | can't inspect a JSON API reply or an XHR payload | ~1h (`Network.getResponseBody`, filter, `har` export) |
| 15 | **Storage & cookies** | none | no `getCookies`/`setCookie`, no localStorage/sessionStorage read-write, no storageState save/restore for reusing a session | ~2h |
| 16 | **Emulation beyond viewport** | `setViewport` only | no `emulateMedia` (dark mode / print), geolocation, timezone/locale, offline, network throttling, permission grants | ~2h |
| 17 | **Request interception & HTTP auth** | none | no `Fetch.enable` mocking; JS dialogs are covered but `Fetch.authRequired` (HTTP basic auth) is not | ~3h |
| 18 | **`printToPDF` / clipboard / `Performance`** | none | no PDF export, no clipboard read-write, no metrics or tracing | ~2h |
| 19 | **`hover` by `elementIndex`** | selector or `x,y` only | asymmetry with every other AX action | ~15 min |
| 20 | **`axTree` ergonomics** | full tree, no filters | real pages produce enormous trees that eat context; Codex filters to interesting nodes | ~1h (role/name filter, depth cap, `interestingOnly`) |

### Suggested order

1. `axUploadFiles` (#7, partial) — cheap, high value, no new concepts.
2. Click hit-testing (#12) — prevents a whole class of "the click did nothing" reports.
3. Multi-select + autofill (#6) — closes the last original checklist item.
4. Downloads (#7, rest).
5. iframes (#10) — the expensive one; do it when a real task needs it.
6. `hover` by index (#19) and `axTree` filters (#20) — small quality-of-life, good filler work.

---

## Hard-won implementation notes (Chrome quirks)

- **`Page.captureScreenshot` `clip` is unreliable.** In Chrome 158 the clip is offset by the
  browser window chrome: an element-sized clip lands on the wrong region and returns a blank
  (pure white) PNG. `axScreenshot` therefore captures the whole viewport and crops with
  `OffscreenCanvas` at `devicePixelRatio` scale.
- **`Emulation.setDeviceMetricsOverride` sizes the widget in *device* pixels** for desktop
  emulation (a 900×600 request yields an 818×545 CSS viewport at 1.1× DPR) but treats the
  request as CSS pixels for mobile emulation. `setViewport` applies its best guess, measures
  `innerWidth`/`innerHeight`, and corrects once (`achieved`/`matched`/`corrected`).
  `clearDeviceMetricsOverride` does **not** restore the widget size, so `reset` re-applies the
  size recorded before the first override.
- **Dialogs need `Page.enable`** (done in `ensureAttached`) and are captured from
  `Page.javascriptDialogOpening`. While a dialog is open the page's JS is blocked, so `waitFor`
  fails fast with a hint to call `handleDialog`.
- **Reading mode whitespace:** text nodes must not be trimmed individually, or inline tags glue
  words together (`the**first**paragraph`). Trim only at block boundaries.
- **`networkIdle`** needs a timestamp per captured request (`networkByTab` entries carry `at`).

## How to test a new item
1. Add the method + `case` to `extension/background.js` (dispatch switch).
2. Wire the result into `src/server/browser-ext.ts` (`formatResult`) and the `ext_browser`
   action enum in `src/server/tools.ts`.
3. Rebuild into dev (`npm run build:server`) and verify on the dev instance (port `3211` via
   `paths.json`, which is gitignored).
4. Drive it through `POST /api/browser-ext/cmd` on the dev server against
   `scripts/e2e-ax/features.html` (`node scripts/e2e-ax/serve.js` for the static page).

## Test harness
- `scripts/e2e-ax/run-features.js [port]` — 83-check e2e suite for #8/#9 (needs the extension
  connected to that port's server).
- `scripts/e2e-ax/check-format.js` — unit-checks the server-side `formatResult` for the new
  actions (no browser needed).
- `scripts/e2e-ax/check-helper.js` — verifies the page-side helper template literals parse.
- `scripts/e2e-ax/png-sample.js` — PNG decoder/pixel sampler used to prove captures weren't blank.
- `scripts/e2e-ax/editor.html`, `features.html`, `serve.js` — test pages + static server.

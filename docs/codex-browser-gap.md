# Yuki vs Codex Browser Extension — Feature Gap Tracker

> **Status note (Nov 2026):** Items #1–5 (AX action layer) and #8–9 (dialogs, waits, session,
> viewport, element screenshot, reading mode) are implemented and e2e-verified.
> Items #6 (select option / form autofill) and #7 (file upload/download) remain.
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
| 6 | **Select option** (dedicated `<option>` picking) + **form autofill** | `axSetValue` handles combobox by value/label today; a first-class `axSelectOption` + multi-field autofill would match Codex |
| 7 | **File upload / download** | `axUploadFiles` (set `<input type=file>` via CDP `DOM.setFileInputFiles`) and download capture/monitoring |

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
- `scripts/e2e-ax/run-features.js [port]` — 72-check e2e suite for #8/#9 (needs the extension
  connected to that port's server).
- `scripts/e2e-ax/check-format.js` — unit-checks the server-side `formatResult` for the new
  actions (no browser needed).
- `scripts/e2e-ax/check-helper.js` — verifies the page-side helper template literals parse.
- `scripts/e2e-ax/png-sample.js` — PNG decoder/pixel sampler used to prove captures weren't blank.
- `scripts/e2e-ax/editor.html`, `features.html`, `serve.js` — test pages + static server.

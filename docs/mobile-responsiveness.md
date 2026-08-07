# Mobile Responsiveness Plan

## Changes Required

### 1. Sidebar → Off-canvas Overlay

**File:** `index.html`, `app.js`, `styles.css`

- On screens < 768px, hide the sidebar off-screen by default (translateX(-100%)).
- Add a hamburger menu button (☰) in the main area top-left to toggle it.
- When open, sidebar overlays the content with a semi-transparent backdrop.
- Adjust the existing `#sidebar.collapsed` behavior: on mobile, the "collapse" state should be the hidden state; the hamburger reveals it fully.
- The existing `sidebar-toggle` button (&#171;) can be repurposed or replaced on mobile.

Tailwind breakpoint: `md:` prefix (768px).

### 2. Modals — Responsive Widths

**File:** `index.html`

- Tools modal: `w-[400px]` → `w-[400px] max-w-[95vw] md:max-w-[400px]`
- Rename modal: `w-[360px]` → `w-[360px] max-w-[95vw] md:max-w-[360px]`
- On very small screens, modals should be nearly full-width with some margin.

### 3. Browser Panel — Responsive Sizing

**File:** `index.html`

- Currently `w-[700px] h-[500px]` — change to `w-[700px] max-w-[95vw] h-[500px] max-h-[80vh] md:max-w-[700px]`
- Positioning (`bottom-24 right-4`) is fine for both.

### 4. Input Bar — Handle Crowded Icons

**File:** `index.html`

- On small screens, the row of 6 buttons + textarea can be tight.
- Options:
  - Reduce gap and padding (`gap-2` → `gap-1`, `p-2` → `p-1.5` on buttons).
  - Or wrap button icons into a second row using `flex-wrap`.
- Simplest: add `sm:gap-2` / `sm:p-2` overrides with smaller defaults.

### 5. Messages Area

**File:** `index.html`

- Already fluid (`max-w-5xl mx-auto`) — no changes needed, works on all sizes.

### 6. Session List Items

**File:** `app.js`

- The `truncate max-w-[200px]` on tool call params and session titles should use `max-w-[30vw]` or just `truncate` without a fixed max-width for mobile.

## Estimated Effort

- ~15 min: Sidebar off-canvas behavior (HTML + CSS + JS toggle)
- ~5 min: Modal responsive widths
- ~5 min: Browser panel sizing
- ~5 min: Input bar crowding
- ~5 min: Test edge cases (iPhone SE, iPad, landscape)

**Total: ~35 min**

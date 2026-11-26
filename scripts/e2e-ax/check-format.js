// Unit-check the server-side formatting of the new ext_browser actions.
// No extension or browser needed — calls BrowserExtension#formatResult directly
// with representative payloads from the extension.
//
// Usage: node scripts/e2e-ax/check-format.js

'use strict';

const { BrowserExtension } = require('../../dist/server/browser-ext.js');

const ext = new BrowserExtension();
// formatResult is private in TS but a plain method at runtime.
const fmt = (action, result) => ext.formatResult(action, result);

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; console.log(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\next_browser formatResult — #8/#9 actions\n');

// dialogList (open + recent)
const dl = fmt('dialogList', {
  open: [{ tabId: 7, type: 'confirm', message: 'Delete everything?', defaultPrompt: '', url: 'http://x/', openMs: 2400 }],
  recent: [{ tabId: 7, type: 'alert', message: 'Hello', action: 'accept', at: 1 }],
});
check('dialogList shows the open dialog', /OPEN dialogs/.test(dl) && /CONFIRM: "Delete everything\?"/.test(dl), dl);
check('dialogList hints handleDialog', /handleDialog/.test(dl), dl);
check('dialogList shows recent', /Recently handled/.test(dl) && /alert "Hello" → accept/.test(dl), dl);
check('dialogList empty case', /\(no dialogs/.test(fmt('dialogList', { open: [], recent: [] })));

// handleDialog
check('handleDialog accept', /Accepted PROMPT dialog: "Name\?" \(entered: "Yuki"\)/.test(
  fmt('handleDialog', { handled: true, action: 'accept', type: 'prompt', message: 'Name?', promptText: 'Yuki' })));
check('handleDialog dismiss', /Dismissed ALERT dialog: "Boom"/.test(
  fmt('handleDialog', { handled: true, action: 'dismiss', type: 'alert', message: 'Boom' })));

// waitFor
check('waitFor success', /Waited 1234ms — element ready \(visible: "hi"\)/.test(
  fmt('waitFor', { ok: true, condition: 'element', waitedMs: 1234, detail: 'visible: "hi"' })));

// nameSession
check('nameSession active', /Session "Yuki" active \(tab group #12\)/.test(fmt('nameSession', { session: 'Yuki', groupId: 12, note: 'x' })));
check('nameSession cleared', /Session cleared/.test(fmt('nameSession', { session: null, cleared: true, groupId: null })));

// setViewport
check('setViewport mobile', /Viewport set to 390x844 @3x \(mobile\)/.test(
  fmt('setViewport', { viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } })));
check('setViewport reset', /Viewport reset/.test(fmt('setViewport', { reset: true })));
check('setViewport reports a mismatch', /page reports 980x2121/.test(
  fmt('setViewport', { viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, achieved: { width: 980, height: 2121 }, matched: false, note: 'no meta viewport' })));
check('setViewport silent when matched', !/page reports/.test(
  fmt('setViewport', { viewport: { width: 900, height: 600, deviceScaleFactor: 1, mobile: false }, achieved: { width: 900, height: 600 }, matched: true })));

// axScreenshot must return raw base64 (so agent.ts wraps it as an image)
const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+p0hRAAAAAElFTkSuQmCC';
check('axScreenshot returns raw base64', fmt('axScreenshot', { data: b64, mimeType: 'image/png', label: 'x' }) === b64);

// readPage
const rp = fmt('readPage', { title: 'Doc', url: 'http://x/doc', markdown: '# Head\n\nbody', chars: 13, blocks: 2, truncated: false });
check('readPage header + body', /^# Doc\nhttp:\/\/x\/doc\n\(13 chars, 2 blocks\)\n\n# Head\n\nbody$/.test(rp), JSON.stringify(rp));
check('readPage truncated flag', /truncated/.test(fmt('readPage', { title: 'D', url: 'u', markdown: 'x', chars: 1, blocks: 1, truncated: true })));

// listTabs now shows the group
const lt = fmt('listTabs', { tabs: [{ id: 3, active: true, title: 'T', url: 'http://x', group: 'Yuki E2E' }], session: 'Yuki E2E' });
check('listTabs shows the tab group', /\(group: Yuki E2E\)/.test(lt), lt);

// Regression: existing actions still format
check('regression: axClick', /Clicked AX element #4 \(button\) at \(10,20\)/.test(fmt('axClick', { clicked: true, elementIndex: 4, role: 'button', x: 10, y: 20 })));
check('regression: screenshot passthrough', fmt('screenshot', { data: b64 }) === b64);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Verify the Tools modal shows the browser-extension entry (drives the dev UI).
'use strict';
const fs = require('fs');
const path = require('path');
const PORT = Number(process.argv[2]) || 3210;
const UI = process.argv[3] || 'http://localhost:3211';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cmd(method, params) {
  const res = await fetch(`${BASE}/api/browser-ext/cmd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: params || {} }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(method + ': ' + j.error);
  return j.result;
}

const evalJs = (tabId, script) => cmd('eval', { tabId, script }).then((r) => r.value);

(async () => {
  const tab = await cmd('createTab', { url: UI, active: false });
  try {
    await sleep(1200);
    await cmd('attach', { tabId: tab.tabId });
    await cmd('waitFor', { tabId: tab.tabId, condition: 'load', timeoutMs: 15000 });
    await cmd('waitFor', { tabId: tab.tabId, condition: 'element', selector: '[title="Options"]', timeoutMs: 15000 });
    await cmd('focusTab', { tabId: tab.tabId });
    await sleep(600);

    // 1. Open the options menu.
    const opened = await evalJs(tab.tabId, '(function(){ var b = document.querySelector(\'[title="Options"]\'); if (!b) return "no options button"; b.click(); return "clicked"; })()');
    console.log('options menu:', opened);
    await sleep(500);

    // 2. Click the "Tools" entry (rendered as "Tools On"/"Tools Off").
    const toolsClick = await evalJs(tab.tabId, '(function(){' +
      'var els = Array.from(document.querySelectorAll("button"));' +
      'var hit = els.find(function(e){ var t = (e.innerText || "").replace(/\\s+/g, " ").trim(); return /^Tools\\b/.test(t); });' +
      'if (!hit) return "no Tools entry"; hit.click(); return "clicked: " + (hit.innerText || "").replace(/\\s+/g, " ").trim(); })()');
    console.log('tools entry :', toolsClick);
    await sleep(900);

    // 3. Inspect the dialog contents.
    const info = await evalJs(tab.tabId, '(function(){' +
      'var d = document.querySelector("[role=dialog]");' +
      'if (!d) return { dialog: false };' +
      'var txt = d.innerText || "";' +
      'return { dialog: true, hasBrowserExtension: txt.indexOf("Browser extension") !== -1,' +
      '  hasExtTool: txt.indexOf("ext_browser") !== -1,' +
      '  connected: /\\d+ browsers? connected/.test(txt),' +
      '  notConnected: txt.indexOf("not connected") !== -1,' +
      '  snippet: txt.split("\\n").filter(function(l){ var s = l.trim(); return s && (s.indexOf("Browser") === 0 || s.indexOf("ext_browser") === 0 || s.indexOf("●") === 0 || s.indexOf("○") === 0 || s.indexOf("tabs,") === 0); }).join(" | ") };' +
      '})()');
    console.log('dialog      :', JSON.stringify(info));

    // 4. Screenshot just the dialog for a visual check.
    const shot = await cmd('axScreenshot', { tabId: tab.tabId, selector: '[role=dialog]' });
    fs.mkdirSync(OUT, { recursive: true });
    const p = path.join(OUT, 'tools-modal.png');
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    console.log('screenshot  :', p, JSON.stringify(shot.imageSize));

    // 5. Layout sanity: the status line must be laid out inside the dialog.
    const layout = await evalJs(tab.tabId, '(function(){' +
      'var d = document.querySelector("[role=dialog]"); if (!d) return null;' +
      'var all = Array.from(d.querySelectorAll("span, div"));' +
      'var st = all.find(function(e){ var t = (e.innerText || "").trim(); return /^[○●]\\s?(not connected|\\d+ browsers?)/.test(t); });' +
      'if (!st) return { found: false };' +
      'var r = st.getBoundingClientRect(), dr = d.getBoundingClientRect();' +
      'var cs = getComputedStyle(st);' +
      'return { found: true, color: cs.color, fontSize: cs.fontSize, height: Math.round(r.height),' +
      '  inside: r.left >= dr.left - 1 && r.right <= dr.right + 1 && r.top >= dr.top - 1 && r.bottom <= dr.bottom + 1,' +
      '  lines: Math.round(r.height / parseFloat(cs.lineHeight || "14")) };' +
      '})()');
    console.log('status line :', JSON.stringify(layout));
  } finally {
    await cmd('closeTab', { tabId: tab.tabId }).catch(() => {});
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

// E2E driver for the #8/#9 extension features (dialogs, waits, viewport,
// element screenshot, reading mode, session tab groups).
//
// Drives the DEV server (default port 3211) through POST /api/browser-ext/cmd,
// which relays a raw command to the connected extension and returns structured
// JSON. Requires: dev server up, static server on 3999, extension reloaded and
// pointed at the dev port.
//
// Usage: node scripts/e2e-ax/run-features.js [port] [staticPort]

'use strict';

const PORT = Number(process.argv[2]) || 3211;
const STATIC_PORT = Number(process.argv[3]) || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `http://127.0.0.1:${STATIC_PORT}/features.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`); }
}

async function cmd(method, params) {
  const res = await fetch(`${BASE}/api/browser-ext/cmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: params || {} }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json.result;
}

/** Like cmd() but returns { ok, result | error } instead of throwing. */
async function tryCmd(method, params) {
  try { return { ok: true, result: await cmd(method, params) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function pngSize(b64) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

/** Minimal PNG decoder (8-bit RGB/RGBA, all filters) so tests can inspect pixels. */
function pngDecode(b64) {
  const zlib = require('zlib');
  const buf = Buffer.from(b64, 'base64');
  let o = 8, w = 0, h = 0, color = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); color = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const ch = color === 6 ? 4 : color === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

/** Colour at (x,y) of a decoded image. */
function pngAt(img, x, y) {
  const i = (y * img.w + x) * img.ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Fraction of non-white pixels in a horizontal band. */
function inkRatio(img, y0, y1) {
  let ink = 0, total = 0;
  for (let y = Math.max(0, y0); y < Math.min(y1, img.h); y++) {
    for (let x = 0; x < img.w; x += 3) {
      const [r, g, b] = pngAt(img, x, y);
      total++;
      if (r < 250 || g < 250 || b < 250) ink++;
    }
  }
  return total ? ink / total : 0;
}

(async () => {
  console.log(`\nE2E #8/#9 against ${BASE} (page ${PAGE})\n`);
  const created = [];

  try {
    // ---------------------------------------------------------------- setup
    const status = await cmd('status', {});
    check('status reachable, extension connected', status && status.connected === true);
    check('status exposes session field', 'session' in status);

    const tab = await cmd('createTab', { url: PAGE, active: false });
    created.push(tab.tabId);
    check('createTab returns tabId', typeof tab.tabId === 'number', JSON.stringify(tab));
    await sleep(1200);
    await cmd('attach', { tabId: tab.tabId });
    const tabId = tab.tabId;

    // ------------------------------------------------------------- waitFor
    console.log('\nwaitFor');
    const w1 = await cmd('waitFor', { tabId, condition: 'load', timeoutMs: 8000 });
    check('waitFor load', w1.ok === true, JSON.stringify(w1));

    const w2 = await cmd('waitFor', { tabId, condition: 'element', selector: '#delayed', timeoutMs: 6000 });
    check('waitFor element #delayed (appears after 1.2s)', w2.ok === true, JSON.stringify(w2));

    // Real timing test: the element does not exist yet, so the poll must block.
    await cmd('eval', {
      tabId,
      script: 'setTimeout(function(){ var d = document.createElement("div"); d.id = "timed"; d.textContent = "timed"; document.body.appendChild(d); }, 900); "scheduled"',
    });
    const w2b = await cmd('waitFor', { tabId, condition: 'element', selector: '#timed', timeoutMs: 6000 });
    check('waitFor element polls until it appears (>=400ms)', w2b.ok === true && w2b.waitedMs >= 400, JSON.stringify(w2b));

    const w3 = await cmd('waitFor', { tabId, condition: 'text', text: 'late text arrived', timeoutMs: 6000 });
    check('waitFor text (case-insensitive)', w3.ok === true, JSON.stringify(w3));

    const w4 = await cmd('waitFor', { tabId, condition: 'element', selector: '#article', state: 'visible', timeoutMs: 2000 });
    check('waitFor element visible', w4.ok === true, JSON.stringify(w4));

    const w5 = await cmd('waitFor', { tabId, condition: 'element', selector: '#nope', state: 'detached', timeoutMs: 2000 });
    check('waitFor element detached (absent = satisfied)', w5.ok === true, JSON.stringify(w5));

    const w6 = await cmd('waitFor', { tabId, condition: 'url', url: 'features.html', timeoutMs: 2000 });
    check('waitFor url substring', w6.ok === true, JSON.stringify(w6));

    const w7 = await cmd('waitFor', { tabId, condition: 'url', url: '^http://127\\.0\\.0\\.1:\\d+/features\\.html$', regex: true, timeoutMs: 2000 });
    check('waitFor url regex', w7.ok === true, JSON.stringify(w7));

    const w8 = await cmd('waitFor', { tabId, condition: 'networkIdle', timeoutMs: 8000, idleMs: 300 });
    check('waitFor networkIdle', w8.ok === true, JSON.stringify(w8));

    const w9 = await tryCmd('waitFor', { tabId, condition: 'element', selector: '#never', timeoutMs: 700 });
    check('waitFor times out with a clear error', w9.ok === false && /timed out/i.test(w9.error || ''), w9.error);

    const w10 = await tryCmd('waitFor', { tabId, condition: 'bogus', timeoutMs: 500 });
    check('waitFor rejects unknown condition', w10.ok === false && /unknown waitfor condition/i.test(w10.error || ''), w10.error);

    // -------------------------------------------------------------- dialogs
    console.log('\ndialogs');
    // Chrome suppresses JS dialogs in background tabs, so bring the tab forward
    // first (a real agent hits dialogs on the tab the user is looking at).
    await cmd('focusTab', { tabId });
    await sleep(700);
    const vis = await cmd('eval', { tabId, script: 'document.visibilityState' });
    console.log(`  · tab visibility during dialog tests: ${vis.value}`);

    const d0 = await cmd('dialogList', { tabId });
    check('dialogList empty before any dialog', Array.isArray(d0.open) && d0.open.length === 0, JSON.stringify(d0));

    await cmd('eval', { tabId, script: 'window.scheduleAlert("Hello alert", 250)' });
    await sleep(800);
    const d1 = await cmd('dialogList', { tabId });
    check('alert captured', d1.open.length === 1 && d1.open[0].type === 'alert' && d1.open[0].message === 'Hello alert', JSON.stringify(d1));

    const wBlocked = await tryCmd('waitFor', { tabId, condition: 'element', selector: '#article', timeoutMs: 1000 });
    check('waitFor fails fast while a dialog blocks the page', wBlocked.ok === false && /dialog/i.test(wBlocked.error || ''), wBlocked.error);

    const h1 = await cmd('handleDialog', { tabId, action: 'accept' });
    check('handleDialog accept alert', h1.handled === true && h1.type === 'alert', JSON.stringify(h1));

    const d2 = await cmd('dialogList', { tabId });
    check('dialogList empty after handling', d2.open.length === 0 && d2.recent.length >= 1, JSON.stringify(d2));

    const hNo = await tryCmd('handleDialog', { tabId, action: 'accept' });
    check('handleDialog without a dialog errors clearly', hNo.ok === false && /no dialog is open/i.test(hNo.error || ''), hNo.error);

    await cmd('eval', { tabId, script: 'window.scheduleConfirm("Delete everything?", 250)' });
    await sleep(800);
    const d3 = await cmd('dialogList', { tabId });
    check('confirm captured', d3.open.length === 1 && d3.open[0].type === 'confirm', JSON.stringify(d3));
    await cmd('handleDialog', { tabId, action: 'dismiss' });
    const confirmRes = await cmd('eval', { tabId, script: 'window.__results.confirm' });
    check('confirm dismissed -> false', confirmRes.value === false, JSON.stringify(confirmRes));

    await cmd('eval', { tabId, script: 'window.schedulePrompt("Your name?", "default-name", 250)' });
    await sleep(800);
    const d4 = await cmd('dialogList', { tabId });
    check('prompt captured with defaultPrompt', d4.open.length === 1 && d4.open[0].type === 'prompt' && d4.open[0].defaultPrompt === 'default-name', JSON.stringify(d4));
    const h2 = await cmd('handleDialog', { tabId, action: 'accept', promptText: 'Yuki' });
    check('handleDialog accept prompt with text', h2.handled === true && h2.promptText === 'Yuki', JSON.stringify(h2));
    const promptRes = await cmd('eval', { tabId, script: 'window.__results.prompt' });
    check('prompt returned the typed text', promptRes.value === 'Yuki', JSON.stringify(promptRes));

    await cmd('eval', { tabId, script: 'window.scheduleAlert("Wait for me", 400)' });
    const wDialog = await cmd('waitFor', { tabId, condition: 'dialog', timeoutMs: 5000 });
    check('waitFor dialog', wDialog.ok === true, JSON.stringify(wDialog));
    await cmd('handleDialog', { tabId, action: 'dismiss' });

    // ------------------------------------------------------------ viewport
    console.log('\nsetViewport');
    const base = await cmd('eval', { tabId, script: 'window.innerWidth + "x" + window.innerHeight' });
    const baseSize = String(base.value);
    const v1 = await cmd('setViewport', { tabId, width: 900, height: 600 });
    check('setViewport 900x600', v1.viewport && v1.viewport.width === 900 && v1.viewport.height === 600, JSON.stringify(v1));
    const inner = await cmd('eval', { tabId, script: 'window.innerWidth + "x" + window.innerHeight' });
    check('page sees exactly the emulated viewport (DPR-compensated)', /^900x600$/.test(String(inner.value)), `${inner.value} (requested 900x600)`);
    const v2 = await cmd('setViewport', { tabId, width: 390, height: 844, mobile: true, deviceScaleFactor: 3 });
    check('setViewport mobile', v2.viewport && v2.viewport.mobile === true && v2.viewport.deviceScaleFactor === 3, JSON.stringify(v2));
    const inner2 = await cmd('eval', { tabId, script: 'window.innerWidth + "x" + window.innerHeight' });
    check('page sees exactly the mobile viewport', /^390x844$/.test(String(inner2.value)), `${inner2.value} (requested 390x844)`);
    const v3 = await cmd('setViewport', { tabId, reset: true });
    check('setViewport reset', v3.reset === true, JSON.stringify(v3));
    const inner3 = await cmd('eval', { tabId, script: 'window.innerWidth + "x" + window.innerHeight' });
    check('reset restores the original viewport', String(inner3.value) === baseSize, `${inner3.value} (was ${baseSize})`);
    const vBad = await tryCmd('setViewport', { tabId, width: 0, height: 0 });
    check('setViewport rejects zero size', vBad.ok === false, vBad.error);

    // ------------------------------------------------- element screenshot
    console.log('\naxScreenshot');
    const tree = await cmd('axTree', { tabId });
    const deepMatch = /idx=(\d+)/g;
    const idxs = [];
    let m;
    while ((m = deepMatch.exec(tree.tree))) idxs.push(Number(m[1]));
    check('axTree indexed elements', idxs.length > 0, String(idxs.length));

    const shotSel = await cmd('axScreenshot', { tabId, selector: '#deepBtn' });
    const sizeSel = pngSize(shotSel.data || '');
    const dpr = shotSel.dpr || 1;
    check('axScreenshot by selector returns PNG', !!sizeSel, JSON.stringify({ label: shotSel.label }));
    check('axScreenshot clip matches element size (240x60 ±2)', !!shotSel.clip && Math.abs(shotSel.clip.width - 240) <= 2 && Math.abs(shotSel.clip.height - 60) <= 2, JSON.stringify(shotSel.clip));
    check('axScreenshot image is clip x devicePixelRatio', !!sizeSel && Math.abs(sizeSel.width - Math.round(240 * dpr)) <= 2 && Math.abs(sizeSel.height - Math.round(60 * dpr)) <= 2, `${JSON.stringify(sizeSel)} dpr=${dpr}`);
    check('axScreenshot not clipped', shotSel.clipped === false, JSON.stringify(shotSel.clip));
    check('axScreenshot captured real pixels (not a blank fill)', !!sizeSel && sizeSel.bytes > 1200, JSON.stringify(sizeSel));

    // The clip must agree with the element's viewport-relative rect (CDP clip
    // is measured from the viewport origin, not the document).
    const rect = await cmd('eval', {
      tabId,
      script: '(function(){ var el = document.getElementById("deepBtn"); el.scrollIntoView({block:"center"}); var r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), scrollY: Math.round(window.scrollY) }; })()',
    });
    const rv = rect.value || {};
    check('axScreenshot clip matches the viewport rect', Math.abs((shotSel.clip?.x ?? -1) - rv.x) <= 2 && Math.abs((shotSel.clip?.y ?? -1) - rv.y) <= 2, `${JSON.stringify(shotSel.clip)} vs ${JSON.stringify(rv)}`);
    check('axScreenshot scrolled the element into view (page was below the fold)', rv.scrollY > 600, JSON.stringify(rv));

    // AX-index variant must agree with the selector variant.
    const tree2 = await cmd('axTree', { tabId });
    const mBtn = /button "Deep button below the fold"[^\n]*idx=(\d+)/.exec(tree2.tree);
    check('axTree exposes the deep button with an index', !!mBtn, mBtn ? mBtn[0] : 'not found');
    if (mBtn) {
      const shotIdx = await cmd('axScreenshot', { tabId, elementIndex: Number(mBtn[1]) });
      const sizeIdx = pngSize(shotIdx.data || '');
      check('axScreenshot by AX index matches the selector shot', !!shotIdx.clip && shotIdx.clip.width === shotSel.clip.width && shotIdx.clip.height === shotSel.clip.height, JSON.stringify(shotIdx.clip));
      check('axScreenshot by AX index has content', !!sizeIdx && sizeIdx.bytes > 1200, JSON.stringify(sizeIdx));
    }

    const shotPad = await cmd('axScreenshot', { tabId, selector: '#deepBtn', padding: 10 });
    const sizePad = pngSize(shotPad.data || '');
    check('axScreenshot padding grows the clip', !!shotPad.clip && Math.abs(shotPad.clip.width - 260) <= 2 && Math.abs(shotPad.clip.height - 80) <= 2, JSON.stringify(shotPad.clip));
    check('axScreenshot padded image has content', !!sizePad && sizePad.bytes > 1200, JSON.stringify(sizePad));

    const badShot = await tryCmd('axScreenshot', { tabId });
    check('axScreenshot without a target errors', badShot.ok === false && /elementindex|selector/i.test(badShot.error || ''), badShot.error);

    // ------------------------------------------- full page + tall stitching
    console.log('\nfullPage + tall element (stitched)');
    const scrollBefore = await cmd('eval', { tabId, script: 'Math.round(window.scrollY)' });
    const full = await cmd('screenshot', { tabId, fullPage: true });
    const fullImg = pngDecode(full.data);
    const pageH = await cmd('eval', { tabId, script: 'document.documentElement.scrollHeight' });
    const cssH = Number(pageH.value);
    check('fullPage returns a tall image', fullImg.h > 2000, JSON.stringify({ w: fullImg.w, h: fullImg.h, slices: full.slices }));
    check('fullPage height matches the page', Math.abs(fullImg.h - Math.round(cssH * (full.scale || 1))) <= 4, `${fullImg.h} vs ${cssH}*${full.scale}`);
    // The button (240 CSS px wide) sits well below the first viewport and must be
    // painted: expect roughly buttonWidth / imageWidth of ink across its rows.
    const btnDoc = await cmd('eval', {
      tabId,
      script: '(function(){ var r = document.getElementById("deepBtn").getBoundingClientRect(); return Math.round(r.top + window.scrollY) + "x" + Math.round(r.height) + "x" + Math.round(r.width); })()',
    });
    const [btnY, btnH, btnW] = String(btnDoc.value).split('x').map(Number);
    const scale = full.scale || 1;
    const bandInk = inkRatio(fullImg, Math.round(btnY * scale), Math.round((btnY + btnH) * scale));
    const expectedInk = (btnW * scale) / fullImg.w;
    check('fullPage painted content below the first viewport', bandInk > expectedInk * 0.6, `button css y=${btnY} ink=${bandInk.toFixed(3)} (expected ~${expectedInk.toFixed(3)})`);
    check('fullPage painted the bottom of the page', inkRatio(fullImg, fullImg.h - 120, fullImg.h - 1) > 0.001, 'ink=' + inkRatio(fullImg, fullImg.h - 120, fullImg.h - 1).toFixed(4));
    const scrollAfter = await cmd('eval', { tabId, script: 'Math.round(window.scrollY)' });
    check('fullPage restores the scroll position', Math.abs(Number(scrollAfter.value) - Number(scrollBefore.value)) <= 2, `${scrollBefore.value} -> ${scrollAfter.value}`);

    // A fixed banner must not repeat down the stitched image.
    let magentaMax = -1;
    for (let y = 0; y < fullImg.h; y++) {
      const [r, g, b] = pngAt(fullImg, Math.round(fullImg.w / 2), y);
      if (r > 200 && g < 90 && b > 200) magentaMax = y;
    }
    check('fixed banner appears once (not repeated per slice)', magentaMax >= 0 && magentaMax < 120, `last magenta row=${magentaMax}`);
    check('fullPage reports the hidden fixed elements', (full.fixedHidden || 0) >= 1, 'fixedHidden=' + full.fixedHidden);

    const tall = await cmd('axScreenshot', { tabId, selector: '#tall' });
    const tallImg = pngDecode(tall.data);
    const tallDpr = tall.dpr || 1;
    check('tall element uses the stitched path', tall.stitched === true, JSON.stringify({ stitched: tall.stitched, clipped: tall.clipped }));
    check('tall element image is the full element height', Math.abs(tallImg.h - Math.round(1500 * tallDpr)) <= 4, `${tallImg.h} vs ${Math.round(1500 * tallDpr)}`);
    const topPx = pngAt(tallImg, Math.round(tallImg.w / 2), 12);
    const botPx = pngAt(tallImg, Math.round(tallImg.w / 2), tallImg.h - 12);
    check('tall element top marker is green', topPx[1] > 120 && topPx[0] < 80, JSON.stringify(topPx));
    check('tall element bottom marker is red', botPx[0] > 120 && botPx[1] < 80, JSON.stringify(botPx));

    // --------------------------------------------------------- reading mode
    console.log('\nreadPage');
    const rd = await cmd('readPage', { tabId });
    const md = String(rd.markdown || '');
    check('readPage returns markdown', md.length > 100, `${rd.chars} chars`);
    check('readPage has the title heading', /# Reading Test/.test(md), md.slice(0, 80));
    check('readPage keeps bold/emphasis inline', /\*\*first\*\*/.test(md) && /\*emphasis\*/.test(md));
    check('readPage preserves spacing around inline tags', /This is the \*\*first\*\* paragraph/.test(md), md.split('\n').find((l) => l.includes('first')));
    check('readPage keeps text in a bare div', /Bare text inside a plain div/.test(md));
    check('readPage converts links', /\[useful link\]\(https:\/\/example\.com\/docs\)/.test(md));
    check('readPage renders bullets', /- bullet one/.test(md) && /- bullet two/.test(md));
    check('readPage renders nested bullets', /\n {2}- nested bullet/.test(md));
    check('readPage renders ordered lists', /1\. first numbered/.test(md));
    check('readPage renders tables', /\| col a \| col b \|/.test(md) && /\| --- \| --- \|/.test(md));
    check('readPage renders code fences', /```[\s\S]*const x = 42;/.test(md));
    check('readPage renders blockquotes', /> Quoted wisdom\./.test(md));
    check('readPage strips nav/aside/footer boilerplate', !/BOILERPLATE/.test(md), md.match(/.*BOILERPLATE.*/)?.[0]);
    const rdBody = await cmd('readPage', { tabId, selector: 'body' });
    check('readPage selector=body still strips boilerplate', !/BOILERPLATE/.test(String(rdBody.markdown || '')), String(rdBody.markdown || '').match(/.*BOILERPLATE.*/)?.[0]);
    check('readPage selector=body keeps the article', /# Reading Test/.test(String(rdBody.markdown || '')));
    const rdSel = await cmd('readPage', { tabId, selector: '#article', maxChars: 60 });
    check('readPage clamps maxChars to a 500-char floor', rdSel.chars <= 500 && rdSel.truncated === false, JSON.stringify({ chars: rdSel.chars, truncated: rdSel.truncated }));

    // ------------------------------------------------------------- session
    console.log('\nnameSession / tab groups');
    const s1 = await cmd('nameSession', { name: 'Yuki E2E' });
    check('nameSession sets a session', s1.session === 'Yuki E2E', JSON.stringify(s1));
    check('nameSession groups the active tab', s1.groupId != null, JSON.stringify(s1));

    const tab2 = await cmd('createTab', { url: PAGE + '?second', active: false });
    created.push(tab2.tabId);
    check('createTab joins the session group', tab2.groupId != null && tab2.groupId === s1.groupId, JSON.stringify(tab2));
    check('createTab with active:false keeps focus', tab2.active === false, JSON.stringify(tab2));

    const lt = await cmd('listTabs', {});
    const mine = (lt.tabs || []).filter((t) => created.includes(t.id));
    check('listTabs reports the group name', mine.length >= 2 && mine.every((t) => t.group === 'Yuki E2E'), JSON.stringify(mine.map((t) => ({ id: t.id, group: t.group }))));

    const st2 = await cmd('status', {});
    check('status reports the session name', st2.session === 'Yuki E2E', JSON.stringify(st2.session));

    const s2 = await cmd('nameSession', { name: '' });
    check('nameSession clears', s2.session === null && s2.cleared === true, JSON.stringify(s2));

    // -------------------------------------------------------------- cleanup
    console.log('\ncleanup');
    await cmd('setViewport', { tabId, reset: true });
    for (const id of created) {
      const r = await tryCmd('closeTab', { tabId: id });
      check(`closeTab #${id}`, r.ok === true, r.error);
    }
  } catch (e) {
    failed++;
    failures.push('FATAL: ' + e.message);
    console.log('\nFATAL: ' + e.message);
    for (const id of created) { try { await cmd('closeTab', { tabId: id }); } catch { /* ignore */ } }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('Failures:'); for (const f of failures) console.log('  - ' + f); }
  process.exit(failed ? 1 : 0);
})();

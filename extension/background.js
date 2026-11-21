/*
 * Yuki Browser Control — background service worker (MV3).
 *
 * Runs in ANY Chromium browser (Chrome / Edge / Brave / ...). Opens a WebSocket
 * to the local Yuki server (ws://localhost:3210/ws/browser-ext) and lets the
 * server drive this browser via the Chrome DevTools Protocol (chrome.debugger)
 * plus chrome.tabs for tab management.
 *
 * Implements the protocol described in PROTOCOL.md (same directory).
 *
 * Plain ES5-ish JS, no build step — load this folder as an unpacked extension.
 */

'use strict';

const CONFIG = {
  defaultWsUrl: 'ws://localhost:3210/ws/browser-ext',
  protocol: 1,
  version: '1.0.0',
  reconnectBaseMs: 1000,
  reconnectMaxMs: 15000,
  heartbeatMs: 15000,
  heartbeatCheckMs: 5000,
  keepaliveAlarmMinutes: 0.5, // 30s (Chrome clamps periodic alarms to >= 30s)
};

// ---- module state ----------------------------------------------------------
let ws = null;
let wsUrl = CONFIG.defaultWsUrl;
let browserId = null;
let connecting = false;
let reconnectAttempt = 0;
let lastMessageAt = 0;
let heartbeatTimer = null;
let reconnectTimer = null;

const attachedTabs = new Set();      // tabIds with an active CDP debugger
const networkByTab = new Map();      // tabId -> Array<req>
const consoleByTab = new Map();      // tabId -> Array<msg>
let tabsChangedTimer = null;

// ---- tiny helpers ----------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '\u2026' : s; }
function jstr(v) { try { return JSON.stringify(v); } catch { return String(v); } }

function send(obj) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  } catch (e) { /* socket gone; reconnect handles it */ }
}

async function getBrowserId() {
  if (!browserId) {
    try {
      const res = await chrome.storage.local.get('browserId');
      if (res && res.browserId) {
        browserId = res.browserId;
      } else {
        browserId = 'brw-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        await chrome.storage.local.set({ browserId });
      }
    } catch {
      browserId = 'brw-' + Math.random().toString(36).slice(2, 10);
    }
  }
  return browserId;
}

async function getWsUrl() {
  try {
    const res = await chrome.storage.local.get('wsUrl');
    if (res && res.wsUrl && typeof res.wsUrl === 'string' && res.wsUrl.length) wsUrl = res.wsUrl;
  } catch { /* keep default */ }
  return wsUrl;
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length ? tabs[0].id : null;
}

async function resolveTabId(tabId) {
  if (typeof tabId === 'number' && tabId > 0) return tabId;
  const id = await getActiveTabId();
  if (id == null) throw new Error('No active tab found and no tabId provided');
  return id;
}

// ---- connection lifecycle --------------------------------------------------
async function connect() {
  if (connecting) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  connecting = true;
  const url = await getWsUrl();
  let socket;
  try {
    socket = new WebSocket(url);
  } catch (e) {
    connecting = false;
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = async () => {
    connecting = false;
    reconnectAttempt = 0;
    lastMessageAt = Date.now();
    const id = await getBrowserId();
    let activeTabId = null;
    try { activeTabId = await getActiveTabId(); } catch { /* ignore */ }
    send({
      type: 'event', method: 'hello',
      payload: { browserId: id, browser: navigator.userAgent, protocol: CONFIG.protocol, version: CONFIG.version, activeTabId },
    });
    startHeartbeat();
  };

  socket.onmessage = (e) => {
    lastMessageAt = Date.now();
    handleServerMessage(e.data);
  };

  socket.onclose = () => {
    connecting = false;
    stopHeartbeat();
    // reset cached attach state on a full reconnect (browser may have restarted)
    scheduleReconnect();
  };

  socket.onerror = () => {
    try { socket.close(); } catch { /* ignore */ }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(CONFIG.reconnectBaseMs * Math.pow(2, reconnectAttempt), CONFIG.reconnectMaxMs);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > CONFIG.heartbeatMs) {
      send({ type: 'event', method: 'ping', payload: { t: Date.now() } });
    }
  }, CONFIG.heartbeatCheckMs);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ---- CDP helper ------------------------------------------------------------
function cdp(tabId, method, params) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || 'CDP error'));
        else resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureAttached(tabId) {
  if (!attachedTabs.has(tabId)) {
    await new Promise((resolve, reject) => {
      try {
        chrome.debugger.attach({ tabId }, '1.3', () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error('Attach failed: ' + (err.message || 'unknown')));
          else { attachedTabs.add(tabId); resolve(); }
        });
      } catch (e) { reject(e); }
    });
    // Enable the domains we rely on for monitoring + input. Best-effort.
    for (const m of ['Runtime.enable', 'Page.enable', 'Network.enable']) {
      try { await cdp(tabId, m, {}); } catch { /* ignore */ }
    }
  }
  return tabId;
}

function detachTab(tabId) {
  attachedTabs.delete(tabId);
  return new Promise((resolve) => {
    try {
      chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; resolve(); });
    } catch { resolve(); }
  });
}

function detachAll() {
  for (const t of Array.from(attachedTabs)) detachTab(t);
}

// CDP key resolution (name -> key/code/virtual keycode)
const KEY_MAP = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Space: { key: ' ', code: 'Space', vk: 32 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
};

function resolveKey(name) {
  const k = String(name == null ? '' : name);
  if (KEY_MAP[k]) return KEY_MAP[k];
  if (k.length === 1) {
    const isUpper = k === k.toUpperCase() && k !== k.toLowerCase();
    return { key: k, code: 'Key' + k.toUpperCase(), vk: k.toUpperCase().charCodeAt(0) };
  }
  return { key: k, code: k, vk: 0 };
}

function focusExpr(selector) {
  return '(function(){ var el = document.querySelector(' + jstr(selector) + '); ' +
    'if (!el) throw new Error("Element not found: " + ' + jstr(selector) + '); ' +
    'el.scrollIntoView({ block: "center" }); if (el.focus) el.focus(); return true; })()';
}

// ---- command implementations ----------------------------------------------
async function statusCmd() {
  const tabs = await chrome.tabs.query({});
  return {
    connected: true,
    browserId: await getBrowserId(),
    version: CONFIG.version,
    protocol: CONFIG.protocol,
    tabCount: tabs.length,
    activeTabId: await getActiveTabId(),
    attachedTabs: Array.from(attachedTabs),
  };
}

async function listTabsCmd() {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.map((t) => ({ id: t.id, windowId: t.windowId, url: t.url, title: t.title, active: t.active, pinned: t.pinned, index: t.index })) };
}

async function getActiveTabCmd() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs.length) return { error: 'No active tab' };
  return { id: tabs[0].id, url: tabs[0].url, title: tabs[0].title };
}

async function createTabCmd(p) {
  const tab = await chrome.tabs.create({ url: p.url, active: p.active !== false });
  return { tabId: tab.id };
}

async function focusTabCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  if (tab && tab.windowId != null) { try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* ignore */ } }
  return { focused: true, tabId };
}

async function closeTabCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await chrome.tabs.remove(tabId);
  return { closed: true, tabId };
}

async function attachCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  return { attached: true, tabId };
}

async function detachCmd(p) {
  let tabId = (typeof p.tabId === 'number' && p.tabId > 0) ? p.tabId : await getActiveTabId();
  if (tabId == null) throw new Error('No active tab to detach');
  await detachTab(tabId);
  return { detached: true, tabId };
}

async function waitForTabComplete(tabId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let t; try { t = await chrome.tabs.get(tabId); } catch { return true; }
    if (t && t.status === 'complete') return true;
    await sleep(120);
  }
  return false;
}

async function navigateCmd(p) {
  if (!p.url) throw new Error('navigate requires url');
  const tabId = await resolveTabId(p.tabId);
  await chrome.tabs.update(tabId, { url: p.url });
  const loadComplete = p.waitFor === false ? null : await waitForTabComplete(tabId, 8000);
  return { navigated: true, url: p.url, tabId, loadComplete };
}

async function backCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  await cdp(tabId, 'Runtime.evaluate', { expression: 'history.go(-1)', returnByValue: false });
  return { back: true, tabId };
}

async function forwardCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  await cdp(tabId, 'Runtime.evaluate', { expression: 'history.go(1)', returnByValue: false });
  return { forward: true, tabId };
}

async function reloadCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await chrome.tabs.reload(tabId);
  return { reloaded: true, tabId };
}

async function screenshotCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  if (p.fullPage) {
    const metrics = await cdp(tabId, 'Page.getLayoutMetrics', {});
    const size = metrics.cssContentSize || metrics.contentSize || { width: 1280, height: 800 };
    const shot = await cdp(tabId, 'Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
    });
    return { data: shot.data, mimeType: 'image/png', fullPage: true };
  }
  const shot = await cdp(tabId, 'Page.captureScreenshot', { format: 'png' });
  return { data: shot.data, mimeType: 'image/png', fullPage: false };
}

async function evalCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  if (!p.script) throw new Error('eval requires script');
  await ensureAttached(tabId);
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression: p.script, returnByValue: true, awaitPromise: p.awaitPromise !== false,
  });
  if (res && res.exceptionDetails) {
    const d = res.exceptionDetails;
    return { exception: true, text: (d.exception && d.exception.description) || d.text || 'JS exception' };
  }
  let value = res && res.result ? res.result.value : undefined;
  if (typeof value === 'undefined') value = res && res.result ? (res.result.description || null) : null;
  return { value, type: res && res.result ? res.result.type : 'undefined' };
}

function formatAxTree(nodes) {
  if (!nodes || !nodes.length) return '(empty accessibility tree)';
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  let out = '';
  const walk = (node, depth) => {
    if (out.length > 60000) { out += '...\n'; return; }
    const role = (node.role && node.role.value) || 'node';
    const name = ((node.name && node.name.value) || '').trim();
    out += '  '.repeat(depth) + '- ' + role + (name ? ' "' + truncate(name, 80) + '"' : '') + '\n';
    for (const cid of (node.childIds || [])) {
      const c = byId.get(cid);
      if (c) walk(c, depth + 1);
    }
  };
  const root = nodes.find((n) => n.rootId === n.nodeId) || nodes[0];
  walk(root, 0);
  return out;
}

async function axTreeCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const res = await cdp(tabId, 'Accessibility.getFullAXTree', {});
  return { tree: formatAxTree(res && res.nodes) };
}

async function visibleElementsCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression: '(function(){ var sels = \'a,button,input,select,textarea,[role="button"],[role="link"],[onclick],[tabindex]\'; var out = []; document.querySelectorAll(sels).forEach(function(el){ var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0) return; var s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none") return; out.push({ tag: el.tagName.toLowerCase(), text: ((el.innerText || el.value || el.getAttribute("aria-label") || "") + "").trim().slice(0, 80), role: el.getAttribute("role") || "", href: el.href || "", x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), width: Math.round(r.width), height: Math.round(r.height) }); }); return out.slice(0, 400); })()',
    returnByValue: true,
  });
  return { elements: (res && res.result && res.result.value) || [] };
}

async function linksCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression: 'Array.from(document.querySelectorAll("a[href]")).map(function(a){ return { href: a.href, text: (a.innerText || "").trim().slice(0, 120) }; }).slice(0, 500)',
    returnByValue: true,
  });
  return { links: (res && res.result && res.result.value) || [] };
}

async function textCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const res = await cdp(tabId, 'Runtime.evaluate', { expression: 'document.body ? document.body.innerText : ""', returnByValue: true });
  return { text: (res && res.result && res.result.value) || '' };
}

async function htmlCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const expr = p.selector
    ? '(function(){ var el = document.querySelector(' + jstr(p.selector) + '); return el ? el.outerHTML : ""; })()'
    : 'document.documentElement.outerHTML';
  const res = await cdp(tabId, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  return { html: (res && res.result && res.result.value) || '' };
}

async function pageStructureCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression: '(function(){ return { title: document.title, url: location.href, readyState: document.readyState, headings: Array.from(document.querySelectorAll("h1,h2,h3")).slice(0,40).map(function(h){ return { t: h.tagName, text: h.innerText.trim().slice(0,120) }; }), linkCount: document.querySelectorAll("a[href]").length, formCount: document.querySelectorAll("form").length, captcha: !!document.querySelector("[class*=captcha i],[id*=captcha i],[name*=g-recaptcha],iframe[src*=recaptcha]") }; })()',
    returnByValue: true,
  });
  return (res && res.result && res.result.value) || {};
}

async function evalPoint(tabId, selector) {
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression: '(function(){ var el = document.querySelector(' + jstr(selector) + '); if (!el) return null; el.scrollIntoView({ block: "center" }); var r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; })()',
    returnByValue: true,
  });
  const p = res && res.result ? res.result.value : null;
  if (!p) throw new Error('Element not found: ' + selector);
  return p;
}

async function viewportCenter(tabId) {
  try {
    const m = await cdp(tabId, 'Page.getLayoutMetrics', {});
    const vp = m.cssViewportSize || m.cssContentSize || { width: 1920, height: 1080 };
    return { x: Math.round(vp.width / 2), y: Math.round(vp.height / 2) };
  } catch { return { x: 960, y: 540 }; }
}

async function clickCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const button = p.button || 'left';
  const clickCount = Math.max(1, p.clickCount || 1);
  let x, y;
  if (typeof p.x === 'number' && typeof p.y === 'number') { x = p.x; y = p.y; }
  else if (p.selector) { const pt = await evalPoint(tabId, p.selector); x = pt.x; y = pt.y; }
  else { const c = await viewportCenter(tabId); x = c.x; y = c.y; }

  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
  for (let i = 0; i < clickCount; i++) {
    const cc = i + 1;
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: cc, pointerType: 'mouse' });
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: cc, pointerType: 'mouse' });
    if (i < clickCount - 1) await sleep(80);
  }
  return { clicked: true, x, y, button, clickCount };
}

async function insertText(tabId, text) {
  if (!text) return;
  await cdp(tabId, 'Input.insertText', { text: String(text) });
}

async function sendKeyCombo(tabId, { key, code, modifiers, text, windowsVirtualKeyCode, nativeVirtualKeyCode }) {
  const down = { type: 'keyDown', key: key, code: code, modifiers: modifiers || 0 };
  if (typeof text === 'string' && text !== '') down.text = text;
  if (windowsVirtualKeyCode) { down.windowsVirtualKeyCode = windowsVirtualKeyCode; down.nativeVirtualKeyCode = nativeVirtualKeyCode || windowsVirtualKeyCode; }
  await cdp(tabId, 'Input.dispatchKeyEvent', down);
  const up = { type: 'keyUp', key: key, code: code, modifiers: modifiers || 0 };
  if (windowsVirtualKeyCode) { up.windowsVirtualKeyCode = windowsVirtualKeyCode; up.nativeVirtualKeyCode = nativeVirtualKeyCode || windowsVirtualKeyCode; }
  await cdp(tabId, 'Input.dispatchKeyEvent', up);
}

async function fillCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  if (p.selector) {
    await cdp(tabId, 'Runtime.evaluate', { expression: focusExpr(p.selector), returnByValue: true });
  }
  if (p.clear !== false) {
    // Select existing content (Ctrl/Cmd+A) so the inserted text replaces it.
    await sendKeyCombo(tabId, { key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  }
  await insertText(tabId, p.value == null ? '' : p.value);
  return { filled: true, selector: p.selector || null, value: p.value };
}

async function typeCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  if (p.selector) {
    await cdp(tabId, 'Runtime.evaluate', { expression: focusExpr(p.selector), returnByValue: true });
  }
  await insertText(tabId, p.text == null ? '' : p.text);
  return { typed: true, text: p.text };
}

async function keyCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const k = resolveKey(p.key);
  // Derive the inserted character: an explicit p.text wins; otherwise a bare
  // printable single-char keypress with no modifiers inserts that character.
  let text = (typeof p.text === 'string' && p.text !== '') ? p.text : null;
  if (text == null) {
    const raw = String(p.key == null ? '' : p.key);
    if (raw.length === 1 && !KEY_MAP[raw] && (p.modifiers || 0) === 0) text = raw;
  }
  await sendKeyCombo(tabId, {
    key: k.key, code: k.code, modifiers: p.modifiers || 0, text,
    windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
  });
  return { pressed: p.key, modifiers: p.modifiers || 0, inserted: text || undefined };
}

async function hoverCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  let x, y;
  if (typeof p.x === 'number' && typeof p.y === 'number') { x = p.x; y = p.y; }
  else if (p.selector) { const pt = await evalPoint(tabId, p.selector); x = pt.x; y = pt.y; }
  else { x = 0; y = 0; }
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
  return { hovered: true, x, y };
}

async function scrollCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  if (p.direction === 'top') { await cdp(tabId, 'Runtime.evaluate', { expression: 'window.scrollTo(0, 0)', returnByValue: false }); return { scrolled: true, to: 'top' }; }
  if (p.direction === 'bottom') { await cdp(tabId, 'Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)', returnByValue: false }); return { scrolled: true, to: 'bottom' }; }
  let x, y;
  if (typeof p.x === 'number' && typeof p.y === 'number') { x = p.x; y = p.y; }
  else { const c = await viewportCenter(tabId); x = c.x; y = c.y; }
  const amount = p.amount || 300;
  const dirSign = p.direction === 'up' ? -1 : p.direction === 'down' ? 1 : p.direction === 'left' ? -1 : p.direction === 'right' ? 1 : 0;
  const dx = (p.dx != null) ? p.dx : (p.direction === 'left' || p.direction === 'right' ? dirSign * amount : 0);
  const dy = (p.dy != null) ? p.dy : (p.direction === 'up' || p.direction === 'down' ? dirSign * amount : 0);
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, pointerType: 'mouse' });
  return { scrolled: true, dx, dy };
}

async function scrollToCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  if (!p.selector) throw new Error('scrollTo requires selector');
  await cdp(tabId, 'Runtime.evaluate', { expression: '(function(){ var el = document.querySelector(' + jstr(p.selector) + '); if (el) el.scrollIntoView({ block: "center" }); return !!el; })()', returnByValue: true });
  return { scrolledTo: p.selector };
}

function pushNetwork(entry) {
  let arr = networkByTab.get(entry.tabId);
  if (!arr) { arr = []; networkByTab.set(entry.tabId, arr); }
  arr.push(entry);
  if (arr.length > 500) arr.splice(0, arr.length - 500);
}

function getNetwork(tabId, limit) {
  const arr = networkByTab.get(tabId) || [];
  return arr.slice(-limit).map((e) => ({ url: e.url, method: e.method, status: e.status, type: e.type, finished: e.finished }));
}

function pushConsole(tabId, entry) {
  let arr = consoleByTab.get(tabId);
  if (!arr) { arr = []; consoleByTab.set(tabId, arr); }
  arr.push(entry);
  if (arr.length > 500) arr.splice(0, arr.length - 500);
}

function formatArg(a) {
  if (a && a.value !== undefined) {
    if (typeof a.value === 'object') return jstr(a.value);
    return String(a.value);
  }
  return (a && (a.description || a.unserializableValue)) || (a && a.type) || '';
}

async function networkCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  if (p.clear) networkByTab.delete(tabId);
  return { requests: getNetwork(tabId, p.limit || 50) };
}

async function consoleCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  return { messages: (consoleByTab.get(tabId) || []).slice(-(p.limit || 50)) };
}

// ---- dispatch --------------------------------------------------------------
async function dispatch(method, params) {
  const p = params || {};
  switch (method) {
    case 'status': return await statusCmd(p);
    case 'listTabs': return await listTabsCmd(p);
    case 'getActiveTab': return await getActiveTabCmd(p);
    case 'createTab': return await createTabCmd(p);
    case 'focusTab': return await focusTabCmd(p);
    case 'closeTab': return await closeTabCmd(p);
    case 'attach': return await attachCmd(p);
    case 'detach': return await detachCmd(p);
    case 'navigate': return await navigateCmd(p);
    case 'back': return await backCmd(p);
    case 'forward': return await forwardCmd(p);
    case 'reload': return await reloadCmd(p);
    case 'screenshot': return await screenshotCmd(p);
    case 'eval': return await evalCmd(p);
    case 'axTree': return await axTreeCmd(p);
    case 'visibleElements': return await visibleElementsCmd(p);
    case 'links': return await linksCmd(p);
    case 'text': return await textCmd(p);
    case 'html': return await htmlCmd(p);
    case 'pageStructure': return await pageStructureCmd(p);
    case 'click': return await clickCmd(p);
    case 'fill': return await fillCmd(p);
    case 'type': return await typeCmd(p);
    case 'key': return await keyCmd(p);
    case 'hover': return await hoverCmd(p);
    case 'scroll': return await scrollCmd(p);
    case 'scrollTo': return await scrollToCmd(p);
    case 'network': return await networkCmd(p);
    case 'console': return await consoleCmd(p);
    default: throw new Error('Unknown method: ' + method);
  }
}

// ---- server message handling ----------------------------------------------
function handleServerMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || !msg.type) return;

  if (msg.type === 'event') {
    if (msg.method === 'ping') { send({ type: 'event', method: 'pong', payload: { t: msg.payload && msg.payload.t } }); return; }
    if (msg.method === 'config') {
      // Optional: server may push { wsUrl, ... } overrides.
      try { if (msg.payload && msg.payload.wsUrl) chrome.storage.local.set({ wsUrl: msg.payload.wsUrl }); } catch { /* ignore */ }
      return;
    }
    if (msg.method === 'detachAll') { detachAll(); return; }
    return;
  }

  if (msg.type === 'request') {
    const id = msg.id;
    dispatch(msg.method, msg.params).then((result) => {
      send({ id, type: 'response', ok: true, result });
    }).catch((err) => {
      send({ id, type: 'response', ok: false, error: (err && err.message) || String(err) });
    });
  }
}

// ---- CDP + tab event listeners --------------------------------------------
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source && source.tabId;
  if (tabId == null) return;
  try {
    if (method === 'Network.requestWillBeSent' && params.request) {
      pushNetwork({ tabId, reqId: params.requestId, url: params.request.url, method: params.request.method, type: params.type, status: undefined, finished: false });
    } else if (method === 'Network.responseReceived') {
      const arr = networkByTab.get(tabId);
      if (arr) { for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].reqId === params.requestId) { arr[i].status = params.response && params.response.status; break; } } }
    } else if (method === 'Network.loadingFinished') {
      const arr = networkByTab.get(tabId);
      if (arr) { for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].reqId === params.requestId) { arr[i].finished = true; break; } } }
    } else if (method === 'Runtime.consoleAPICalled') {
      pushConsole(tabId, { level: params.type || 'log', text: (params.args || []).map(formatArg).join(' ').slice(0, 2000) });
    } else if (method === 'Runtime.exceptionThrown') {
      pushConsole(tabId, { level: 'error', text: ((params.exceptionDetails && (params.exceptionDetails.exception && params.exceptionDetails.exception.description || params.exceptionDetails.text)) || 'Exception').slice(0, 2000) });
    }
  } catch { /* never let event handling throw */ }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source && source.tabId != null) attachedTabs.delete(source.tabId);
});

function pushTabsChanged() {
  if (tabsChangedTimer) return;
  tabsChangedTimer = setTimeout(async () => {
    tabsChangedTimer = null;
    try {
      const tabs = await chrome.tabs.query({});
      send({ type: 'event', method: 'tabsChanged', payload: { tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active })) } });
    } catch { /* ignore */ }
  }, 200);
}
chrome.tabs.onUpdated.addListener(pushTabsChanged);
chrome.tabs.onCreated.addListener(pushTabsChanged);
chrome.tabs.onRemoved.addListener(pushTabsChanged);
chrome.tabs.onActivated.addListener(pushTabsChanged);

// ---- popup / runtime messaging --------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.cmd) return;
  if (msg.cmd === 'status') {
    Promise.resolve(getActiveTabId()).then((activeTabId) => {
      sendResponse({
        connected: !!(ws && ws.readyState === WebSocket.OPEN),
        browserId: browserId,
        activeTabId: activeTabId,
        attachedTabs: Array.from(attachedTabs),
        wsUrl: wsUrl,
      });
    });
    return true; // async
  }
  if (msg.cmd === 'reconnect') {
    stopHeartbeat();
    try { if (ws) ws.close(); } catch { /* ignore */ }
    ws = null;
    reconnectAttempt = 0;
    connect();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.cmd === 'detachAll') {
    detachAll();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.cmd === 'setWsUrl') {
    if (msg.url && typeof msg.url === 'string') { wsUrl = msg.url; try { chrome.storage.local.set({ wsUrl: msg.url }); } catch { /* ignore */ } }
    sendResponse({ ok: true, wsUrl });
    return true;
  }
});

// ---- boot ------------------------------------------------------------------
function boot() {
  getBrowserId();
  connect();
  try { chrome.alarms.create('keepalive', { periodInMinutes: CONFIG.keepaliveAlarmMinutes }); } catch { /* ignore */ }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === 'keepalive') {
    // Wake the worker and make sure we are connected.
    if (!ws || ws.readyState > WebSocket.OPEN) connect();
  }
});
chrome.runtime.onInstalled.addListener(() => { connect(); });
chrome.runtime.onStartup.addListener(() => { connect(); });

boot();

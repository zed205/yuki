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

// Accessibility-tree action layer: tabId -> { url, byIndex: Map<index, AXTarget> }
// AXTarget = { backendNodeId, role, isValueSettable, isEditable, name }
const axByTab = new Map();
let axSeq = 0;

// JS dialogs (alert/confirm/prompt/beforeunload) currently blocking a tab.
// tabId -> { type, message, defaultPrompt, url, at }
const dialogsByTab = new Map();
// Recently handled dialogs, per tab (ring buffer) so the agent can see what it missed.
const dialogLogByTab = new Map();
const DIALOG_LOG_MAX = 20;

// Agent session: a named Chrome tab group so tabs opened by the agent stay
// together and (optionally) in the background without stealing focus.
let sessionName = null;
const sessionGroups = new Map(); // windowId -> groupId

// Roles we consider clickable / actionable from the AX tree.
const AX_ACTIONABLE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox',
  'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'tab', 'slider', 'spinbutton', 'treeitem', 'search',
]);

// Roles whose value can be set via axSetValue (plus contenteditable nodes).
const AX_SETTABLE_ROLES = new Set([
  'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'checkbox',
  'radio', 'switch', 'menuitemcheckbox', 'menuitemradio',
]);

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
    session: sessionName || null,
    openDialogs: Array.from(dialogsByTab.keys()),
  };
}

async function listTabsCmd() {
  const tabs = await chrome.tabs.query({});
  const groups = await sessionGroupTitles();
  return {
    tabs: tabs.map((t) => ({
      id: t.id, windowId: t.windowId, url: t.url, title: t.title, active: t.active, pinned: t.pinned, index: t.index,
      groupId: t.groupId != null && t.groupId >= 0 ? t.groupId : null,
      group: t.groupId != null && t.groupId >= 0 && groups.get(t.groupId) ? groups.get(t.groupId).title : null,
    })),
    session: sessionName || null,
  };
}

async function getActiveTabCmd() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs.length) return { error: 'No active tab' };
  return { id: tabs[0].id, url: tabs[0].url, title: tabs[0].title };
}

async function createTabCmd(p) {
  const tab = await chrome.tabs.create({ url: p.url, active: p.active !== false });
  let groupId = null;
  if (sessionName && p.group !== false) {
    groupId = await ensureSessionGroup(tab.id, sessionName, p.color);
  }
  return { tabId: tab.id, active: !!tab.active, session: sessionName || null, groupId };
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

// ---- session / tab-group hygiene -------------------------------------------
/**
 * Put `tabId` into the session's Chrome tab group, creating the group (and
 * naming it after the session) on first use. Returns the groupId or null when
 * tab groups are unavailable (e.g. the permission was not granted).
 */
async function ensureSessionGroup(tabId, name, color) {
  if (tabId == null || !name) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;
    let groupId = sessionGroups.get(windowId);
    if (groupId != null) {
      try { await chrome.tabGroups.get(groupId); } catch { groupId = null; sessionGroups.delete(windowId); }
    }
    if (groupId == null) {
      groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
    } else {
      await chrome.tabs.group({ tabIds: [tabId], groupId });
    }
    sessionGroups.set(windowId, groupId);
    try { await chrome.tabGroups.update(groupId, { title: name, color: color || 'blue' }); } catch { /* title is cosmetic */ }
    return groupId;
  } catch { return null; }
}

async function sessionGroupTitles() {
  const map = new Map();
  try {
    const groups = await chrome.tabGroups.query({});
    for (const g of groups) map.set(g.id, { title: g.title, color: g.color, collapsed: g.collapsed, windowId: g.windowId });
  } catch { /* no tabGroups permission */ }
  return map;
}

async function nameSessionCmd(p) {
  const raw = p.name == null ? '' : String(p.name).trim();
  const clear = p.clear === true || raw === '';
  sessionName = clear ? null : truncate(raw, 60);
  try { await chrome.storage.local.set({ sessionName: sessionName }); } catch { /* ignore */ }
  let groupId = null;
  if (sessionName) {
    groupId = await ensureSessionGroup(await getActiveTabId(), sessionName, p.color);
  }
  return {
    session: sessionName,
    cleared: clear,
    groupId: groupId,
    grouped: groupId != null,
    note: clear
      ? 'Session cleared — new tabs will no longer be grouped.'
      : (groupId != null
        ? 'Tabs opened from now on join the "' + sessionName + '" tab group (background unless active:true).'
        : 'Session name set, but tab grouping is unavailable (grant the "tabGroups" permission by reloading the extension).'),
  };
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
    const cap = await captureFullPage(tabId, p);
    const st = await stitchSlices(cap.slices, cap.contentW, cap.contentH, cap.vw);
    return {
      data: st.data, mimeType: 'image/png', fullPage: true,
      width: st.width, height: st.height, scale: st.scale,
      slices: cap.slices.length, cssHeight: cap.contentH, truncated: cap.truncated,
      fixedHidden: cap.fixedHidden,
    };
  }
  const shot = await cdp(tabId, 'Page.captureScreenshot', { format: 'png' });
  return { data: shot.data, mimeType: 'image/png', fullPage: false };
}

// ---- full-page capture (stitched) -------------------------------------------
// Chrome 158 ignores `captureBeyondViewport`: a clip larger than the viewport
// comes back at the right size with only the first viewport painted (white
// below), and a small clip comes back blank. So we scroll the page, capture the
// viewport at each offset, and stitch the slices with OffscreenCanvas. This also
// makes element screenshots work for elements taller than the viewport.
const FULLPAGE_MAX_CSS_HEIGHT = 8000;
const FULLPAGE_MAX_SLICES = 40;

async function getScroll(tabId) {
  try {
    const r = await cdp(tabId, 'Runtime.evaluate', {
      expression: '[window.scrollX || 0, window.scrollY || 0].join("|")',
      returnByValue: true,
    });
    const parts = String((r && r.result && r.result.value) || '0|0').split('|').map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

async function setScroll(tabId, x, y) {
  try {
    await cdp(tabId, 'Runtime.evaluate', {
      expression: 'window.scrollTo(' + Math.round(x) + ',' + Math.round(y) + ')',
      returnByValue: false,
    });
  } catch { /* ignore */ }
}

/**
 * Hide (or restore) fixed/sticky elements so they are not repeated in every
 * stitched slice. `visibility:hidden` keeps the layout intact.
 */
async function setFixedVisibility(tabId, hide) {
  const expr = '(function(hide){' +
    'var els = document.querySelectorAll("body *"), n = 0;' +
    'for (var i = 0; i < els.length; i++) {' +
    '  var el = els[i], cs = getComputedStyle(el);' +
    '  if (cs.position !== "fixed" && cs.position !== "sticky") continue;' +
    '  if (hide) {' +
    '    if (el.hasAttribute("data-yuki-vis")) continue;' +
    '    el.setAttribute("data-yuki-vis", el.style.visibility || "");' +
    '    el.style.visibility = "hidden"; n++;' +
    '  } else {' +
    '    if (!el.hasAttribute("data-yuki-vis")) continue;' +
    '    el.style.visibility = el.getAttribute("data-yuki-vis");' +
    '    el.removeAttribute("data-yuki-vis"); n++;' +
    '  }' +
    '}' +
    'return n;' +
    '})(' + (hide ? 'true' : 'false') + ')';
  try {
    const r = await cdp(tabId, 'Runtime.evaluate', { expression: expr, returnByValue: true });
    return (r && r.result && r.result.value) || 0;
  } catch {
    return 0;
  }
}

/** Scroll + capture the viewport until the whole page is covered. */
async function captureFullPage(tabId, p) {
  const m = await cdp(tabId, 'Page.getLayoutMetrics', {});
  const content = m.cssContentSize || m.contentSize || { width: 1280, height: 800 };
  const vp = m.cssLayoutViewport || m.cssVisualViewport || { clientWidth: 1280, clientHeight: 800 };
  // Prefer the page's own innerWidth/innerHeight: the layout metrics' clientWidth
  // excludes the scrollbar, which would skew the stitch scale (~0.8% on a 14px
  // scrollbar) and make cropped images slightly too tall.
  let vw = Math.round(vp.clientWidth || vp.width || 1280);
  let vh = Math.max(1, Math.round(vp.clientHeight || vp.height || 800));
  try {
    const r = await cdp(tabId, 'Runtime.evaluate', {
      expression: '[window.innerWidth, window.innerHeight].join("|")',
      returnByValue: true,
    });
    const parts = String((r && r.result && r.result.value) || '').split('|').map(Number);
    if (parts[0] > 0) vw = Math.round(parts[0]);
    if (parts[1] > 0) vh = Math.max(1, Math.round(parts[1]));
  } catch { /* keep layout metrics */ }
  const contentW = Math.ceil(content.width || vw);
  const fullH = Math.ceil(content.height || vh);
  const maxH = Number(p.maxHeight) > 0 ? Number(p.maxHeight) : FULLPAGE_MAX_CSS_HEIGHT;
  const contentH = Math.min(fullH, maxH);
  const orig = await getScroll(tabId);

  const slices = [];
  let target = 0;
  let fixedHidden = false;
  let stickyCount = 0;
  try {
    while (slices.length < FULLPAGE_MAX_SLICES) {
      // Keep fixed/sticky chrome out of every slice but the first one.
      if (slices.length >= 1 && !fixedHidden) {
        stickyCount = await setFixedVisibility(tabId, true);
        fixedHidden = true;
        await sleep(40);
      }
      await setScroll(tabId, 0, target);
      await sleep(70); // let the scroll settle and the frame update
      const at = await getScroll(tabId);
      const shot = await cdp(tabId, 'Page.captureScreenshot', { format: 'png' });
      slices.push({ y: Math.round(at.y), data: shot.data });
      if (at.y + vh >= contentH - 1) break;
      if (at.y < target - 1 && slices.length > 1) break; // scroll refused: stop
      target = at.y + vh;
    }
  } finally {
    if (fixedHidden) await setFixedVisibility(tabId, false);
    await setScroll(tabId, orig.x, orig.y);
  }
  return { slices, vw, vh, contentW, contentH, truncated: fullH > contentH, fixedHidden: stickyCount };
}

/** Stitch viewport slices into one image (device px, cropped to the content width). */
async function stitchSlices(slices, contentW, contentH, cssViewportWidth) {
  const first = await createImageBitmap(new Blob([b64ToBytes(slices[0].data)], { type: 'image/png' }));
  const scale = cssViewportWidth > 0 ? first.width / cssViewportWidth : 1;
  const srcW = Math.max(1, Math.min(first.width, Math.round(contentW * scale)));
  const outH = Math.max(1, Math.round(contentH * scale));
  const canvas = new OffscreenCanvas(srcW, outH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, srcW, outH);
  for (let i = 0; i < slices.length; i++) {
    let bmp = first;
    if (i > 0) bmp = await createImageBitmap(new Blob([b64ToBytes(slices[i].data)], { type: 'image/png' }));
    ctx.drawImage(bmp, 0, 0, srcW, bmp.height, 0, Math.round(slices[i].y * scale), srcW, bmp.height);
    if (i > 0 && typeof bmp.close === 'function') bmp.close();
  }
  if (typeof first.close === 'function') first.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: bytesToB64(new Uint8Array(await blob.arrayBuffer())), width: srcW, height: outH, scale };
}

// ---- #8a: JS dialogs (alert / confirm / prompt / beforeunload) -------------
function pushDialogLog(tabId, entry) {
  let arr = dialogLogByTab.get(tabId);
  if (!arr) { arr = []; dialogLogByTab.set(tabId, arr); }
  arr.push(entry);
  if (arr.length > DIALOG_LOG_MAX) arr.splice(0, arr.length - DIALOG_LOG_MAX);
}

async function dialogListCmd(p) {
  const only = (typeof p.tabId === 'number' && p.tabId > 0) ? p.tabId : null;
  const now = Date.now();
  const open = [];
  for (const [tid, d] of dialogsByTab) {
    if (only != null && tid !== only) continue;
    open.push({ tabId: tid, type: d.type, message: d.message, defaultPrompt: d.defaultPrompt || '', url: d.url, openMs: now - d.at });
  }
  const recent = [];
  for (const [tid, arr] of dialogLogByTab) {
    if (only != null && tid !== only) continue;
    for (const e of arr) recent.push({ tabId: tid, ...e });
  }
  recent.sort((a, b) => a.at - b.at);
  return { open, recent: recent.slice(-10) };
}

async function handleDialogCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  const action = p.action === 'dismiss' ? 'dismiss' : 'accept';
  await ensureAttached(tabId);
  const d = dialogsByTab.get(tabId);
  if (!d) {
    const recent = (dialogLogByTab.get(tabId) || []).slice(-1)[0];
    throw new Error('No dialog is open on tab ' + tabId + '.' +
      (recent ? ' The last dialog (' + recent.type + ': "' + truncate(recent.message, 120) + '") was already ' + recent.action + 'ed.' : ' Use dialogList to check.'));
  }
  const promptText = typeof p.promptText === 'string' ? p.promptText : (d.defaultPrompt || '');
  // Mark it so the javascriptDialogClosed event does not double-log it.
  d.pending = action;
  try {
    await cdp(tabId, 'Page.handleJavaScriptDialog', {
      accept: action === 'accept',
      promptText: d.type === 'prompt' ? promptText : undefined,
    });
  } catch (e) {
    delete d.pending;
    throw new Error('Could not ' + action + ' the ' + d.type + ' dialog: ' + ((e && e.message) || e));
  }
  dialogsByTab.delete(tabId);
  pushDialogLog(tabId, { type: d.type, message: d.message, action, promptText: d.type === 'prompt' ? promptText : undefined, at: Date.now() });
  return {
    handled: true, action, type: d.type, message: d.message,
    promptText: d.type === 'prompt' ? promptText : undefined, tabId,
  };
}

// ---- #8b: waitFor ----------------------------------------------------------
const WAIT_DEFAULT_MS = 5000;
const WAIT_MAX_MS = 60000;

function describeWait(condition, p) {
  switch (condition) {
    case 'element': return 'element "' + (p.selector || '?') + '" to be ' + (p.state || 'visible');
    case 'text': return 'text "' + truncate(p.text || '?', 80) + '" to appear';
    case 'url': return 'URL to match "' + (p.url || '?') + '"';
    case 'networkIdle': return 'network to go idle';
    case 'load': return 'the page to finish loading';
    case 'dialog': return 'a ' + (p.dialogType || 'JS') + ' dialog to open';
    default: return condition;
  }
}

/** One non-throwing check of the wait condition. Returns { ok, detail }. */
async function waitCheck(tabId, condition, p) {
  if (condition === 'dialog') {
    const d = dialogsByTab.get(tabId);
    if (!d) return { ok: false, detail: 'no dialog open' };
    if (p.dialogType && String(d.type) !== String(p.dialogType)) return { ok: false, detail: 'dialog is ' + d.type };
    return { ok: true, detail: d.type + ': ' + truncate(d.message, 160) };
  }

  if (condition === 'load') {
    let t = null;
    try { t = await chrome.tabs.get(tabId); } catch { /* tab gone */ }
    if (!t || t.status !== 'complete') return { ok: false, detail: 'tab status: ' + (t ? t.status : 'gone') };
    try {
      const res = await cdp(tabId, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      const rs = res && res.result && res.result.value;
      return rs === 'complete' ? { ok: true, detail: 'readyState complete' } : { ok: false, detail: 'readyState: ' + rs };
    } catch (e) {
      return { ok: false, detail: 'evaluate failed: ' + ((e && e.message) || e) };
    }
  }

  if (condition === 'networkIdle') {
    const idleMs = Number(p.idleMs) > 0 ? Number(p.idleMs) : 500;
    const arr = networkByTab.get(tabId) || [];
    const now = Date.now();
    const inflight = arr.filter((e) => !e.finished);
    if (inflight.length) return { ok: false, detail: inflight.length + ' request(s) in flight' };
    const last = arr.length ? (arr[arr.length - 1].at || 0) : 0;
    if (last && now - last < idleMs) return { ok: false, detail: 'last request ' + (now - last) + 'ms ago' };
    return { ok: true, detail: 'network idle' };
  }

  // The remaining conditions all need page JS.
  let expr;
  if (condition === 'element') {
    const state = String(p.state || 'visible').toLowerCase();
    expr = '(function(){ var el = document.querySelector(' + jstr(p.selector) + '); ' +
      'if (!el) return { found: false }; var r = el.getBoundingClientRect(); var s = getComputedStyle(el); ' +
      'var visible = r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; ' +
      'return { found: true, visible: visible, text: ((el.innerText || el.value || "") + "").trim().slice(0, 120) }; })()';
    try {
      const res = await cdp(tabId, 'Runtime.evaluate', { expression: expr, returnByValue: true });
      const v = (res && res.result && res.result.value) || { found: false };
      const ok = state === 'attached' ? v.found
        : state === 'hidden' ? (v.found && !v.visible)
          : state === 'detached' ? !v.found
            : (v.found && v.visible);
      return { ok: !!ok, detail: v.found ? (v.visible ? 'visible: "' + truncate(v.text, 80) + '"' : 'present but hidden') : 'not in DOM' };
    } catch (e) {
      return { ok: false, detail: 'evaluate failed: ' + ((e && e.message) || e) };
    }
  }

  if (condition === 'text') {
    const needle = String(p.text == null ? '' : p.text);
    if (!needle) throw new Error('waitFor condition "text" requires text');
    const ci = p.ignoreCase !== false;
    expr = '(function(){ var t = document.body ? document.body.innerText : ""; ' +
      'var hay = ' + (ci ? 't.toLowerCase()' : 't') + ', needle = ' + (ci ? 'String(' + jstr(needle) + ').toLowerCase()' : jstr(needle)) + '; ' +
      'var i = hay.indexOf(needle); return { hit: i !== -1, around: i === -1 ? "" : t.slice(Math.max(0, i - 40), i + needle.length + 40) }; })()';
    try {
      const res = await cdp(tabId, 'Runtime.evaluate', { expression: expr, returnByValue: true });
      const v = (res && res.result && res.result.value) || { hit: false };
      return { ok: !!v.hit, detail: v.hit ? 'found: "' + truncate(v.around, 120) + '"' : 'text not present' };
    } catch (e) {
      return { ok: false, detail: 'evaluate failed: ' + ((e && e.message) || e) };
    }
  }

  if (condition === 'url') {
    const want = String(p.url == null ? '' : p.url);
    if (!want) throw new Error('waitFor condition "url" requires url');
    const cur = await currentTabUrl(tabId);
    if (!cur) return { ok: false, detail: 'no URL yet' };
    let ok;
    if (p.regex === true) {
      try { ok = new RegExp(want).test(cur); } catch (e) { throw new Error('Invalid url regex: ' + ((e && e.message) || e)); }
    } else if (p.exact === true) {
      ok = cur === want;
    } else {
      ok = cur.indexOf(want) !== -1;
    }
    return { ok, detail: 'current URL: ' + truncate(cur, 160) };
  }

  throw new Error('Unknown waitFor condition "' + condition + '". Use element | text | url | networkIdle | load | dialog.');
}

async function waitForCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const raw = String(p.condition || p.for || (p.selector ? 'element' : p.text ? 'text' : p.url ? 'url' : '')).toLowerCase();
  // Conditions are matched case-insensitively but 'networkIdle' is camelCase internally.
  const condition = raw === 'networkidle' ? 'networkIdle' : raw;
  if (!condition) throw new Error('waitFor requires a condition: element | text | url | networkIdle | load | dialog');
  if (condition === 'element' && !p.selector) throw new Error('waitFor condition "element" requires a selector');
  const timeoutMs = Math.min(Math.max(Number(p.timeoutMs) || WAIT_DEFAULT_MS, 100), WAIT_MAX_MS);
  const intervalMs = Math.min(Math.max(Number(p.intervalMs) || 150, 50), 2000);
  const started = Date.now();
  let lastDetail = '';
  while (true) {
    // A dialog blocks page JS — surface it instead of polling into the void.
    const blocked = dialogsByTab.get(tabId);
    if (blocked && condition !== 'dialog') {
      throw new Error('A ' + blocked.type + ' dialog is blocking tab ' + tabId + ': "' + truncate(blocked.message, 160) +
        '". Handle it with handleDialog (accept/dismiss) and retry the wait.');
    }
    const r = await waitCheck(tabId, condition, p);
    if (r.ok) {
      const waitedMs = Date.now() - started;
      return { ok: true, condition, waitedMs, detail: r.detail, tabId };
    }
    if (r.detail) lastDetail = r.detail;
    if (Date.now() - started >= timeoutMs) {
      throw new Error('waitFor timed out after ' + timeoutMs + 'ms waiting for ' + describeWait(condition, p) +
        (lastDetail ? ' — last check: ' + lastDetail : ''));
    }
    await sleep(intervalMs);
  }
}

// ---- #9b: viewport control -------------------------------------------------
// Chrome sizes the tab's widget in *device* pixels, so a plain
// setDeviceMetricsOverride({width:900}) lands on 900/devicePixelRatio CSS pixels
// (818x545 on a 1.1x display). We compensate by the display's real DPR, which is
// stable per display, and remember the original size so reset can restore it.
const viewportByTab = new Map(); // tabId -> { dpr, width, height } (pre-override)

async function measureViewport(tabId) {
  try {
    const r = await cdp(tabId, 'Runtime.evaluate', {
      expression: '[window.devicePixelRatio || 1, window.innerWidth, window.innerHeight].join("|")',
      returnByValue: true,
    });
    const parts = String((r && r.result && r.result.value) || '1|0|0').split('|').map(Number);
    return { dpr: parts[0] > 0 ? parts[0] : 1, width: parts[1] || 0, height: parts[2] || 0 };
  } catch {
    return { dpr: 1, width: 0, height: 0 };
  }
}

async function setViewportCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const rec = viewportByTab.get(tabId);

  if (p.reset === true) {
    try { await cdp(tabId, 'Emulation.clearDeviceMetricsOverride', {}); } catch { /* already clear */ }
    // Clearing the override does not restore the widget size Chrome shrank, so
    // re-apply the size the tab had before we touched it.
    let restored = null;
    if (rec && rec.width > 0 && rec.height > 0) {
      try {
        await cdp(tabId, 'Emulation.setDeviceMetricsOverride', {
          width: Math.round(rec.width * rec.dpr),
          height: Math.round(rec.height * rec.dpr),
          deviceScaleFactor: 1,
          mobile: false,
        });
        restored = { width: rec.width, height: rec.height };
      } catch { /* best effort */ }
    }
    viewportByTab.delete(tabId);
    return { reset: true, tabId, restored };
  }

  const width = Math.round(Number(p.width));
  const height = Math.round(Number(p.height));
  if (!(width > 0) || !(height > 0)) throw new Error('setViewport requires positive width and height (or reset:true)');
  const base = rec || await measureViewport(tabId);
  if (!rec && base.width > 0) viewportByTab.set(tabId, base);

  const dsf = Number(p.deviceScaleFactor) > 0 ? Number(p.deviceScaleFactor) : 1;
  const mobile = p.mobile === true;
  // Desktop emulation sizes the widget in device pixels (so the CSS viewport is
  // request/DPR); mobile emulation takes the request as the CSS viewport. Rather
  // than trust that rule, apply, measure, and correct once.
  let reqW = Math.round(width * (mobile ? 1 : base.dpr));
  let reqH = Math.round(height * (mobile ? 1 : base.dpr));
  const build = () => {
    const o = { width: reqW, height: reqH, deviceScaleFactor: dsf, mobile };
    if (mobile) o.screenOrientation = { type: 'portraitPrimary', angle: 0 };
    return o;
  };
  await cdp(tabId, 'Emulation.setDeviceMetricsOverride', build());

  let actual = await measureViewport(tabId);
  let corrected = false;
  if (actual.width > 0 && actual.height > 0 &&
      (Math.abs(actual.width - width) > 1 || Math.abs(actual.height - height) > 1)) {
    reqW = Math.round(reqW * (width / actual.width));
    reqH = Math.round(reqH * (height / actual.height));
    await cdp(tabId, 'Emulation.setDeviceMetricsOverride', build());
    actual = await measureViewport(tabId);
    corrected = true;
  }

  const matched = Math.abs(actual.width - width) <= 1 && Math.abs(actual.height - height) <= 1;
  return {
    viewport: { width, height, deviceScaleFactor: dsf, mobile },
    achieved: { width: actual.width, height: actual.height },
    matched, corrected,
    dpr: base.dpr,
    original: base.width > 0 ? { width: base.width, height: base.height } : null,
    note: matched ? undefined
      : 'The page reports ' + actual.width + 'x' + actual.height + ' instead of ' + width + 'x' + height +
        (mobile ? ' — a page without <meta name="viewport"> uses a 980px layout viewport on mobile emulation.' : '.'),
    tabId,
  };
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

function axNodeProperty(node, name) {
  if (!node || !Array.isArray(node.properties)) return undefined;
  const p = node.properties.find((x) => x.name === name);
  return p && p.value ? p.value.value : undefined;
}

function axNodeActionable(node) {
  if (node.ignored) return false;
  const role = node.role && node.role.value;
  if (!role) return false;
  if (AX_ACTIONABLE_ROLES.has(role)) return true;
  // contenteditable regions expose an "editable" property.
  const editable = axNodeProperty(node, 'editable');
  if (editable != null && editable !== 'false') return true;
  return false;
}

function axNodeValueSettable(node) {
  const role = node.role && node.role.value;
  if (AX_SETTABLE_ROLES.has(role)) return true;
  const editable = axNodeProperty(node, 'editable');
  if (editable != null && editable !== 'false') return true;
  return false;
}

/**
 * Capture the accessibility tree and assign a stable element_index to every
 * actionable node. Records index -> { backendNodeId, ... } in axByTab so the
 * AX action methods (axClick / axSetValue / axType / ...) can act on indices.
 */
function captureAxTree(nodes, url) {
  if (!nodes || !nodes.length) return { tree: '(empty accessibility tree)', byIndex: new Map() };
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const byIndex = new Map();
  let out = '';
  const walk = (node, depth) => {
    if (out.length > 60000) { out += '...\n'; return; }
    const role = (node.role && node.role.value) || 'node';
    const name = ((node.name && node.name.value) || '').trim();
    const val = axNodeProperty(node, 'value');
    let line = '  '.repeat(depth) + '- ' + role + (name ? ' "' + truncate(name, 80) + '"' : '');
    if (val != null && val !== '') line += ' value="' + truncate(String(val), 60) + '"';
    if (axNodeActionable(node)) {
      const index = ++axSeq;
      byIndex.set(index, {
        backendNodeId: node.backendDOMNodeId,
        role,
        isValueSettable: axNodeValueSettable(node),
        isEditable: axNodeProperty(node, 'editable') != null && axNodeProperty(node, 'editable') !== 'false',
        name,
      });
      line += '  \u269Fidx=' + index;
    }
    out += line + '\n';
    for (const cid of (node.childIds || [])) {
      const c = byId.get(cid);
      if (c) walk(c, depth + 1);
    }
  };
  const root = nodes.find((n) => n.rootId === n.nodeId) || nodes[0];
  walk(root, 0);
  return { tree: out, byIndex };
}

async function axTreeCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const url = await currentTabUrl(tabId);
  const res = await cdp(tabId, 'Accessibility.getFullAXTree', {});
  const { tree, byIndex } = captureAxTree(res && res.nodes, url);
  axByTab.set(tabId, { url, byIndex, at: Date.now() });
  return { tree, indexed: byIndex.size };
}

async function currentTabUrl(tabId) {
  try { const t = await chrome.tabs.get(tabId); return t && t.url ? t.url : null; } catch { return null; }
}

/** Resolve an element_index to its recorded AX target, guarding staleness. */
async function axTarget(tabId, elementIndex) {
  if (!Number.isInteger(elementIndex)) throw new Error('elementIndex must be an integer');
  const rec = axByTab.get(tabId);
  if (!rec) {
    throw new Error('No accessibility tree captured for this tab. Run axTree first to get element indices.');
  }
  const t = rec.byIndex.get(elementIndex);
  if (!t) {
    throw new Error('No accessibility element with index ' + elementIndex + '. Re-run axTree to get fresh indices (the page may have changed).');
  }
  const cur = await currentTabUrl(tabId);
  if (cur && rec.url && cur !== rec.url) {
    // Page navigated since capture — indices are stale.
    axByTab.delete(tabId);
    throw new Error('The page navigated since axTree was captured. Re-run axTree to get fresh element indices.');
  }
  return t;
}

/**
 * Run a helper function inside the page bound to the resolved AX node
 * (`this` = the DOM element), with user-gesture privileges. This mirrors how
 * ChatGPT's browser-use resolves an accessibility index to a node and then
 * calls a semantic helper via Runtime.callFunctionOn.
 */
async function callFunctionOn(tabId, target, fnDeclaration, arg) {
  const resolve = await cdp(tabId, 'DOM.resolveNode', { backendNodeId: target.backendNodeId });
  const objectId = resolve && resolve.object && resolve.object.objectId;
  if (!objectId) throw new Error('Could not resolve accessibility element to a DOM node (it may be stale). Re-run axTree.');
  try {
    const res = await cdp(tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: fnDeclaration,
      arguments: [{ value: arg }],
      returnByValue: true,
      userGesture: true,
    });
    if (res && res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || 'AX action failed in the page');
    }
    return res && res.result ? res.result.value : undefined;
  } finally {
    try { await cdp(tabId, 'Runtime.releaseObject', { objectId }); } catch { /* ignore */ }
  }
}

/** Focus an AX node (optionally require it to be editable). */
async function axFocus(tabId, target, requireEditable) {
  const res = await callFunctionOn(tabId, target, AX_FOCUS_HELPER, { requireEditable: !!requireEditable });
  if (res === false) throw new Error('Could not focus accessibility element (it may be obscured or stale). Re-run axTree.');
  return res;
}

const AX_FOCUS_HELPER = `function(argument){
  if (!this.isConnected) throw new Error("Element is no longer connected");
  var editable = (this instanceof HTMLInputElement) || (this instanceof HTMLTextAreaElement) ||
    (this instanceof HTMLSelectElement) || (this instanceof HTMLElement && this.isContentEditable);
  if (argument && argument.requireEditable && !editable) throw new Error("Element is not editable");
  if (this instanceof HTMLElement) { try { this.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {} }
  if (typeof this.focus === "function") this.focus();
  var ae = document.activeElement;
  return ae === this || (ae && ae.isContentEditable);
}`;

// ---- AX actions ------------------------------------------------------------

async function axClickCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const t = await axTarget(tabId, p.elementIndex);
  const backendNodeId = t.backendNodeId;

  // Scroll the node into view, then compute its viewport center from quads.
  let x, y;
  try { await cdp(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }); } catch { /* continue */ }
  try {
    const quadsRes = await cdp(tabId, 'DOM.getContentQuads', { backendNodeId });
    const q = quadsRes && quadsRes.quads && quadsRes.quads[0];
    if (q && q.length >= 8) {
      x = Math.round((q[0] + q[2] + q[4] + q[6]) / 4);
      y = Math.round((q[1] + q[3] + q[5] + q[7]) / 4);
    }
  } catch { /* fall through to box model */ }
  if (x == null) {
    try {
      const box = await cdp(tabId, 'DOM.getBoxModel', { backendNodeId });
      const b = box && box.model && box.model.border;
      if (b && b.length >= 8) {
        x = Math.round((b[0] + b[2] + b[4] + b[6]) / 4);
        y = Math.round((b[1] + b[3] + b[5] + b[7]) / 4);
      }
    } catch { /* ignore */ }
  }
  if (x == null) throw new Error('Could not determine a click point for accessibility element ' + p.elementIndex);

  const button = p.button || 'left';
  const clickCount = Math.max(1, p.clickCount || 1);
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
  for (let i = 0; i < clickCount; i++) {
    const cc = i + 1;
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: cc, pointerType: 'mouse' });
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: cc, pointerType: 'mouse' });
    if (i < clickCount - 1) await sleep(80);
  }
  return { clicked: true, x, y, elementIndex: p.elementIndex, role: t.role, button, clickCount };
}

async function axSetValueCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const t = await axTarget(tabId, p.elementIndex);
  if (t.isValueSettable === false) {
    throw new Error('Accessibility element ' + p.elementIndex + ' (' + (t.role || 'node') + ') has no settable value');
  }
  await callFunctionOn(tabId, t, AX_SET_VALUE_HELPER, { value: p.value });
  return { set: true, elementIndex: p.elementIndex, role: t.role, value: p.value };
}

const AX_SET_VALUE_HELPER = `function(argument){
  var t = argument && argument.value;
  var self = this;
  var check = function(label, readonly) {
    if (!self.isConnected) throw new Error(label + " is no longer connected");
    if (self.matches(":disabled") || self.getAttribute("aria-disabled") === "true") throw new Error(label + " is disabled");
    if (readonly && (self instanceof HTMLInputElement || self instanceof HTMLTextAreaElement) && self.readOnly) throw new Error(label + " is read-only");
  };
  var notify = function() {
    self.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    self.dispatchEvent(new Event("change", { bubbles: true }));
  };
  var role = self.getAttribute("role");

  if (self instanceof HTMLInputElement && (self.type === "checkbox" || self.type === "radio")) {
    if (!["0","1","false","true"].includes(t)) throw new Error("Checkbox/radio value must be 0, 1, false, or true");
    check("Checkbox");
    var want = t === "1" || t === "true";
    var changed = self.checked !== want || (self.type === "checkbox" && self.indeterminate);
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").set;
    if (!setter) throw new Error("native checked setter unavailable");
    self.focus();
    setter.call(self, want);
    if (self.type === "checkbox") {
      var iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "indeterminate").set;
      if (iset) iset.call(self, false);
    }
    if (changed) notify();
    if (!self.isConnected || self.checked !== want) throw new Error("Checkbox did not retain the requested state");
    return "done";
  }

  if (self instanceof HTMLSelectElement) {
    check("Select");
    if (self.multiple) throw new Error("Multi-select controls are not supported");
    var opts = Array.from(self.options);
    var opt = opts.find(function (x) { return x.value === t; });
    if (!opt) {
      var byLabel = opts.filter(function (x) { return x.label === t || x.text === t; });
      if (byLabel.length !== 1) throw new Error(byLabel.length === 0 ? "Select option not found" : "Select option label is ambiguous");
      opt = byLabel[0];
    }
    if (opt.disabled) throw new Error("Select option is disabled");
    var sset = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, "selected").set;
    if (!sset) throw new Error("native selected setter unavailable");
    var changedOpt = !opt.selected;
    self.focus();
    sset.call(opt, true);
    if (changedOpt) notify();
    if (!self.isConnected || self.selectedOptions[0] !== opt) throw new Error("Select did not retain the requested option");
    return "done";
  }

  if (self instanceof HTMLInputElement || self instanceof HTMLTextAreaElement) {
    var label = self instanceof HTMLTextAreaElement ? "Text area" : "Input";
    if (self instanceof HTMLInputElement && self.type === "file") throw new Error("File inputs cannot be set programmatically");
    check(label, true);
    self.focus();
    var proto = self instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var vset = Object.getOwnPropertyDescriptor(proto, "value").set;
    if (!vset) throw new Error("native value setter unavailable");
    var kb = function () {
      ["keydown","keypress","keyup"].forEach(function (k) {
        self.dispatchEvent(new KeyboardEvent(k, { bubbles: true, composed: true }));
      });
    };
    var prev = self.value;
    var next = t == null ? "" : String(t);
    kb();
    if (!self.isConnected || !self.matches(":focus")) throw new Error(label + " lost focus before setting its value");
    vset.call(self, next);
    if (self.value !== next) throw new Error(label + " rejected value");
    kb();
    if (prev !== self.value) notify();
    return "done";
  }

  if (self instanceof HTMLElement && self.isContentEditable) {
    check("Editable element");
    self.focus();
    var old = self.textContent || "";
    var nextCe = t == null ? "" : String(t);
    self.textContent = nextCe;
    if (old !== nextCe) {
      self.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: nextCe, inputType: "insertText" }));
      self.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return "done";
  }

  throw new Error("Accessibility element does not expose a settable value");
}`;

/**
 * Editor-aware trusted typing. Mirrors ChatGPT's typeText: for each character
 * dispatch Input.dispatchKeyEvent with rawKeyDown (+ editor commands for
 * newline/tab) then a trusted `char` event with the text, then keyUp. This is
 * what contenteditable editors (e.g. Confluence's ProseMirror) actually accept.
 */
async function typeTextTrusted(tabId, text) {
  const chars = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('');
  for (const a of chars) {
    const isSpecial = (a === '\n' || a === '\t');
    const common = { key: isSpecial ? 'Unidentified' : a, windowsVirtualKeyCode: 0 };
    const down = { type: 'rawKeyDown', ...common };
    if (isSpecial) down.commands = [a === '\n' ? 'insertParagraph' : 'insertTab'];
    await cdp(tabId, 'Input.dispatchKeyEvent', down);
    if (!isSpecial) {
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'char', key: a, text: a, unmodifiedText: a });
    }
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }
}

async function axTypeCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  if (p.elementIndex != null) {
    const t = await axTarget(tabId, p.elementIndex);
    await axFocus(tabId, t, true);
  }
  await typeTextTrusted(tabId, p.text);
  return { typed: true, elementIndex: p.elementIndex == null ? null : p.elementIndex, text: p.text };
}

async function axPressKeyCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  if (p.elementIndex != null) {
    const t = await axTarget(tabId, p.elementIndex);
    await axFocus(tabId, t, false);
  }
  const k = resolveKey(p.key);
  let text = (typeof p.text === 'string' && p.text !== '') ? p.text : null;
  if (text == null) {
    const raw = String(p.key == null ? '' : p.key);
    if (raw.length === 1 && !KEY_MAP[raw] && (p.modifiers || 0) === 0) text = raw;
  }
  await sendKeyCombo(tabId, {
    key: k.key, code: k.code, modifiers: p.modifiers || 0, text,
    windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
  });
  return { pressed: p.key, elementIndex: p.elementIndex == null ? null : p.elementIndex, modifiers: p.modifiers || 0, inserted: text || undefined };
}

async function axSelectTextCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const t = await axTarget(tabId, p.elementIndex);
  await callFunctionOn(tabId, t, AX_SELECT_TEXT_HELPER, {
    text: p.text, prefix: p.prefix, suffix: p.suffix,
    selectionType: p.selectionType || 'text',
  });
  return { selected: true, elementIndex: p.elementIndex, text: p.text, selectionType: p.selectionType || 'text' };
}

const AX_SELECT_TEXT_HELPER = `function(argument){
  var e = argument;
  if (!this.isConnected) throw new Error("Cannot select text in a detached element");
  var el = this instanceof Element ? this : this.parentElement;
  if (el && el.matches(":disabled")) throw new Error("Cannot select text in a disabled element");
  if (!e.text || e.text.length === 0) throw new Error("Text to select must not be empty");
  var input = (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) ? this : undefined;
  var hay = input ? input.value : (this.textContent || "");
  var prefix = e.prefix || ""; var suffix = e.suffix || "";
  var needle = prefix + e.text + suffix;
  var idx = hay.indexOf(needle);
  if (idx === -1) throw new Error("Text to select was not found");
  if (hay.indexOf(needle, idx + 1) !== -1) throw new Error("Text to select matches multiple locations");
  var s = idx + prefix.length;
  var st = e.selectionType === "cursor_after" ? s + e.text.length : s;
  var en = e.selectionType === "text" ? st + e.text.length : st;
  if (el instanceof HTMLElement) el.focus();
  if (input) { input.setSelectionRange(st, en); return true; }
  var walker = document.createTreeWalker(this, NodeFilter.SHOW_TEXT);
  var range = document.createRange(); var acc = 0; var placed = false;
  var node = this instanceof Text ? this : walker.nextNode();
  while (node) {
    var nlen = (node.textContent || "").length;
    if (!placed && st <= acc + nlen) { range.setStart(node, Math.max(st - acc, 0)); placed = true; }
    if (placed && en <= acc + nlen) {
      range.setEnd(node, Math.max(en - acc, 0));
      var sel = window.getSelection(); if (!sel) throw new Error("Could not access selection");
      sel.removeAllRanges(); sel.addRange(range); return true;
    }
    acc += nlen; node = walker.nextNode();
  }
  throw new Error("Selection range is outside the target element");
}`;

// ---- #9c: element screenshot ----------------------------------------------
// Measure the element in viewport CSS pixels after scrolling it into view.
// NOTE: CDP's Page.captureScreenshot `clip` is unreliable here (it is offset by
// the browser window chrome, so clips land on the wrong region and come back
// blank). Instead we capture the whole viewport and crop it with OffscreenCanvas,
// which is exact regardless of device pixel ratio.
const AX_RECT_HELPER = `function(){
  if (!this.isConnected) throw new Error("Element is no longer connected");
  var el = this instanceof Element ? this : this.parentElement;
  if (!el) throw new Error("Element has no box");
  try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
  var r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) throw new Error("Element has no visible box (" + Math.round(r.width) + "x" + Math.round(r.height) + ")");
  return {
    x: r.left, y: r.top, width: r.width, height: r.height,
    scrollX: window.scrollX || 0, scrollY: window.scrollY || 0,
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  };
}`;

async function selectorPageRect(tabId, selector) {
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression: '(function(){ var el = document.querySelector(' + jstr(selector) + '); ' +
      'if (!el) throw new Error("Element not found: " + ' + jstr(selector) + '); ' +
      'el.scrollIntoView({ block: "center", inline: "center" }); var r = el.getBoundingClientRect(); ' +
      'if (r.width < 1 || r.height < 1) throw new Error("Element has no visible box"); ' +
      'return { x: r.left, y: r.top, width: r.width, height: r.height, ' +
      'scrollX: window.scrollX || 0, scrollY: window.scrollY || 0, ' +
      'viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, dpr: window.devicePixelRatio || 1 }; })()',
    returnByValue: true,
  });
  if (res && res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error((d.exception && d.exception.description) || d.text || 'Could not measure element');
  }
  return res && res.result ? res.result.value : null;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  const CHUNK = 0x8000; // avoid "too many arguments" on apply()
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** Crop a CSS-pixel rect out of a full-viewport PNG (scaled by devicePixelRatio). */
async function cropPng(b64, rect, dpr) {
  const blob = new Blob([b64ToBytes(b64)], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const sx = Math.max(0, Math.min(bmp.width - 1, Math.round(rect.x * dpr)));
  const sy = Math.max(0, Math.min(bmp.height - 1, Math.round(rect.y * dpr)));
  const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rect.width * dpr)));
  const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rect.height * dpr)));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  if (typeof bmp.close === 'function') bmp.close();
  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await outBlob.arrayBuffer();
  return { data: bytesToB64(new Uint8Array(buf)), width: sw, height: sh };
}

async function axScreenshotCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  let rect = null;
  let label;
  if (p.elementIndex != null) {
    const t = await axTarget(tabId, p.elementIndex);
    rect = await callFunctionOn(tabId, t, AX_RECT_HELPER, null);
    label = 'AX element #' + p.elementIndex + ' (' + (t.role || 'node') + ')';
  } else if (p.selector) {
    rect = await selectorPageRect(tabId, p.selector);
    label = 'element "' + p.selector + '"';
  } else {
    throw new Error('axScreenshot requires elementIndex (from axTree) or selector');
  }
  if (!rect) throw new Error('Could not measure ' + label + ' for a screenshot');

  const pad = Number(p.padding) > 0 ? Number(p.padding) : 0;
  const dpr = rect.dpr > 0 ? rect.dpr : 1;
  const vw = rect.viewportWidth || 0;
  const vh = rect.viewportHeight || 0;
  const region = {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  const clipped = !!(vw && vh) &&
    (region.x < -0.5 || region.y < -0.5 || region.x + region.width > vw + 0.5 || region.y + region.height > vh + 0.5);

  let data = null;
  let imageSize = null;
  let stitched = false;
  let pageTruncated = false;

  if (!clipped) {
    // Fits in the viewport: capture it and crop (exact, one round trip).
    // Let the scroll from scrollIntoView() settle first (rAF is throttled in
    // background tabs, so sleep).
    await sleep(60);
    const vpShot = await cdp(tabId, 'Page.captureScreenshot', { format: 'png' });
    const cropped = await cropPng(vpShot.data, region, dpr);
    data = cropped.data;
    imageSize = { width: cropped.width, height: cropped.height };
  } else {
    // Taller/wider than the viewport: stitch the whole page and crop it in
    // document space (captureScreenshot's own clip is unusable, see above).
    const cap = await captureFullPage(tabId, p);
    const st = await stitchSlices(cap.slices, cap.contentW, cap.contentH, cap.vw);
    const docRegion = {
      x: region.x + (rect.scrollX || 0),
      y: region.y + (rect.scrollY || 0),
      width: region.width,
      height: region.height,
    };
    const cropped = await cropPng(st.data, docRegion, st.scale);
    data = cropped.data;
    imageSize = { width: cropped.width, height: cropped.height };
    stitched = true;
    pageTruncated = !!cap.truncated;
  }

  return {
    data, mimeType: 'image/png', label,
    elementIndex: p.elementIndex == null ? null : p.elementIndex,
    selector: p.selector || null,
    clip: {
      x: Math.round(region.x), y: Math.round(region.y),
      width: Math.round(region.width), height: Math.round(region.height),
    },
    elementSize: { width: Math.round(rect.width), height: Math.round(rect.height) },
    imageSize, dpr, stitched, pageTruncated,
    // stitched captures are complete unless the page itself was capped
    clipped: stitched ? pageTruncated : false,
    viewport: { width: Math.round(vw), height: Math.round(vh) },
  };
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

// ---- #9d: reading mode (page -> markdown) ----------------------------------
// Page-side serializer: picks the main content root, drops boilerplate, then
// walks the DOM emitting headings / paragraphs / lists / tables / code / links.
const READ_PAGE_HELPER = `function(opts){
  opts = opts || {};
  var maxChars = Math.min(Math.max(Number(opts.maxChars) || 20000, 500), 60000);
  var SKIP = { script:1, style:1, noscript:1, template:1, svg:1, canvas:1, iframe:1, nav:1, aside:1, footer:1, form:1, button:1, select:1, textarea:1, input:1 };
  var BLOCKISH = { p:1, div:1, section:1, article:1, main:1, header:1, footer:1, aside:1, nav:1, ul:1, ol:1, li:1, table:1, pre:1, blockquote:1, figure:1, figcaption:1, dl:1, dt:1, dd:1, h1:1, h2:1, h3:1, h4:1, h5:1, h6:1, hr:1, form:1 };
  // Collapse runs of spaces/tabs but keep leading/trailing whitespace: trimming
  // here would glue words together across inline tags ("the **first** paragraph").
  function norm(s){ return String(s == null ? "" : s).replace(/\\u00a0/g, " ").replace(/[ \\t]+/g, " ").replace(/[ \\t]+\\n/g, "\\n"); }
  function inlineNode(n){
    if (n.nodeType === 3) return norm(n.nodeValue);
    if (n.nodeType !== 1) return "";
    var tag = n.tagName.toLowerCase();
    if (SKIP[tag]) return "";
    if (tag === "br") return "\\n";
    if (tag === "img") {
      var src = n.getAttribute("src") || "";
      if (!src) return "";
      return "![" + (n.getAttribute("alt") || "") + "](" + src + ")";
    }
    if (tag === "a") {
      var txt = inline(n).replace(/\\s+/g, " ").trim();
      var href = n.getAttribute("href") || "";
      if (!txt) return "";
      if (!href || href.charAt(0) === "#" || href.indexOf("javascript:") === 0) return txt;
      return "[" + txt + "](" + href + ")";
    }
    if (tag === "strong" || tag === "b") { var b = inline(n).trim(); return b ? "**" + b + "**" : ""; }
    if (tag === "em" || tag === "i") { var em = inline(n).trim(); return em ? "*" + em + "*" : ""; }
    if (tag === "code") { var c = (n.textContent || "").trim(); return c ? "\`" + c + "\`" : ""; }
    if (tag === "del" || tag === "s") { var d = inline(n).trim(); return d ? "~~" + d + "~~" : ""; }
    return inline(n);
  }
  function inline(el){
    var out = "";
    for (var i = 0; i < el.childNodes.length; i++) out += inlineNode(el.childNodes[i]);
    return out;
  }
  function liText(li){
    var buf = "";
    for (var i = 0; i < li.childNodes.length; i++) {
      var c = li.childNodes[i];
      if (c.nodeType === 1 && /^(ul|ol)$/i.test(c.tagName)) continue;
      buf += inlineNode(c);
    }
    return buf.replace(/\\s+/g, " ").trim();
  }
  function collectList(el, depth, lines){
    var ordered = el.tagName.toLowerCase() === "ol";
    var idx = 0;
    for (var i = 0; i < el.children.length; i++) {
      var li = el.children[i];
      if (li.tagName.toLowerCase() !== "li") continue;
      idx++;
      var indent = new Array(depth + 1).join("  ");
      var txt = liText(li);
      if (txt) lines.push(indent + (ordered ? idx + ". " : "- ") + txt);
      for (var j = 0; j < li.children.length; j++) {
        var sub = li.children[j];
        var st = sub.tagName.toLowerCase();
        if (st === "ul" || st === "ol") collectList(sub, depth + 1, lines);
      }
    }
  }
  function listMd(el, depth, out){
    var lines = [];
    collectList(el, depth, lines);
    if (lines.length) out.push(lines.join("\\n")); // tight list: no blank lines between items
  }
  function tableMd(tbl){
    var rows = tbl.querySelectorAll("tr");
    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll("th,td");
      if (!cells.length) continue;
      var arr = [];
      for (var j = 0; j < cells.length; j++) arr.push(inline(cells[j]).replace(/\\s+/g, " ").trim());
      lines.push("| " + arr.join(" | ") + " |");
      if (i === 0) lines.push("|" + arr.map(function(){ return " --- "; }).join("|") + "|");
    }
    return lines.join("\\n");
  }
  var out = [];
  function walk(el, depth){
    for (var i = 0; i < el.children.length; i++) {
      var n = el.children[i];
      var tag = n.tagName.toLowerCase();
      if (SKIP[tag]) continue;
      var m = /^h([1-6])$/.exec(tag);
      if (m) {
        var h = inline(n).replace(/\\s+/g, " ").trim();
        if (h) out.push(new Array(Number(m[1]) + 1).join("#") + " " + h);
        continue;
      }
      if (tag === "p") { var pt = inline(n).trim(); if (pt) out.push(pt); continue; }
      if (tag === "pre") {
        var code = (n.textContent || "").replace(/\\s+$/, "");
        if (code.trim()) out.push("\`\`\`\\n" + code + "\\n\`\`\`");
        continue;
      }
      if (tag === "blockquote") {
        var bt = inline(n).trim();
        if (bt) out.push(bt.split("\\n").map(function(l){ return "> " + l; }).join("\\n"));
        continue;
      }
      if (tag === "ul" || tag === "ol") { listMd(n, 0, out); continue; }
      if (tag === "table") { var t = tableMd(n); if (t) out.push(t); continue; }
      if (tag === "hr") { out.push("---"); continue; }
      if (tag === "figcaption") { var fc = inline(n).trim(); if (fc) out.push("*" + fc + "*"); continue; }
      if (tag === "img") { var im = inlineNode(n); if (im) out.push(im); continue; }
      // Container with only inline content (e.g. <div>some text</div>): emit it,
      // otherwise its text would be silently dropped.
      var hasBlockChild = false;
      for (var k = 0; k < n.children.length; k++) {
        if (BLOCKISH[n.children[k].tagName.toLowerCase()]) { hasBlockChild = true; break; }
      }
      if (!hasBlockChild) {
        var loose = inline(n).replace(/\\s+/g, " ").trim();
        if (loose) out.push(loose);
        continue;
      }
      walk(n, depth + 1);
    }
  }
  var root = (opts.selector && document.querySelector(opts.selector)) ||
    document.querySelector("article") || document.querySelector("main") ||
    document.querySelector("[role=main]") || document.body;
  if (!root) return { title: document.title, url: location.href, markdown: "", chars: 0, blocks: 0, truncated: false };
  var clone;
  try { clone = root.cloneNode(true); } catch (e) { clone = root; }
  ["script","style","noscript","template","svg","canvas","iframe","nav","aside","footer","form","button","[aria-hidden=true]","[hidden]"].forEach(function(sel){
    var doomed;
    try { doomed = clone.querySelectorAll(sel); } catch (e) { return; }
    for (var i = doomed.length - 1; i >= 0; i--) { if (doomed[i].parentNode) doomed[i].parentNode.removeChild(doomed[i]); }
  });
  walk(clone, 0);
  var md = out.join("\\n\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
  var truncated = md.length > maxChars;
  if (truncated) md = md.slice(0, maxChars) + "\\n\\n.[truncated at " + maxChars + " chars]";
  return {
    title: document.title || "",
    url: location.href,
    markdown: md,
    chars: md.length,
    blocks: out.length,
    truncated: truncated,
  };
}`;

async function readPageCmd(p) {
  const tabId = await resolveTabId(p.tabId);
  await ensureAttached(tabId);
  const opts = { selector: p.selector || null, maxChars: Number(p.maxChars) || 20000 };
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression: '(' + READ_PAGE_HELPER + ')(' + jstr(opts) + ')',
    returnByValue: true,
  });
  if (res && res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error((d.exception && d.exception.description) || d.text || 'Reading mode failed');
  }
  const v = (res && res.result && res.result.value) || {};
  return {
    title: v.title || '', url: v.url || '', markdown: v.markdown || '',
    chars: v.chars || 0, blocks: v.blocks || 0, truncated: !!v.truncated,
  };
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
  entry.at = Date.now();
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
    case 'axScreenshot': return await axScreenshotCmd(p);
    case 'setViewport': return await setViewportCmd(p);
    case 'dialogList': return await dialogListCmd(p);
    case 'handleDialog': return await handleDialogCmd(p);
    case 'waitFor': return await waitForCmd(p);
    case 'nameSession': return await nameSessionCmd(p);
    case 'readPage': return await readPageCmd(p);
    case 'eval': return await evalCmd(p);
    case 'axTree': return await axTreeCmd(p);
    case 'axClick': return await axClickCmd(p);
    case 'axSetValue': return await axSetValueCmd(p);
    case 'axType': return await axTypeCmd(p);
    case 'axPressKey': return await axPressKeyCmd(p);
    case 'axSelectText': return await axSelectTextCmd(p);
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
    } else if (method === 'Page.javascriptDialogOpening') {
      // The page opened alert/confirm/prompt/beforeunload and is now blocked
      // until we accept or dismiss it.
      dialogsByTab.set(tabId, {
        type: params.type || 'alert',
        message: params.message || '',
        defaultPrompt: params.defaultPrompt || '',
        url: params.url || null,
        at: Date.now(),
      });
    } else if (method === 'Page.javascriptDialogClosed') {
      const d = dialogsByTab.get(tabId);
      if (d) {
        dialogsByTab.delete(tabId);
        // handleDialogCmd logs its own action; only log dialogs closed elsewhere
        // (user pressed Esc, the page dismissed it, navigation, ...).
        if (!d.pending) {
          pushDialogLog(tabId, { type: d.type, message: d.message, action: params.result ? 'accepted' : 'dismissed', at: Date.now() });
        }
      }
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
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  pushTabsChanged();
  // Invalidate captured AX indices whenever the page starts navigating or the URL changes.
  if (changeInfo && (changeInfo.status === 'loading' || changeInfo.url)) axByTab.delete(tabId);
});
chrome.tabs.onCreated.addListener(pushTabsChanged);
chrome.tabs.onRemoved.addListener((tabId) => { axByTab.delete(tabId); dialogsByTab.delete(tabId); dialogLogByTab.delete(tabId); viewportByTab.delete(tabId); pushTabsChanged(); });
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
async function loadSession() {
  try {
    const res = await chrome.storage.local.get('sessionName');
    if (res && typeof res.sessionName === 'string' && res.sessionName) sessionName = res.sessionName;
  } catch { /* ignore */ }
}

function boot() {
  getBrowserId();
  loadSession();
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

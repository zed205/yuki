/* Yuki Browser Control — popup logic. Talks to the background service worker. */
'use strict';

function setConnectedUI(on, detail) {
  const dot = document.getElementById('dot');
  const state = document.getElementById('state');
  const info = document.getElementById('info');
  dot.className = 'dot' + (on ? ' on' : '');
  state.textContent = on ? 'Connected to Yuki' : 'Not connected';
  info.innerHTML = detail;
}

async function refresh() {
  try {
    const st = await chrome.runtime.sendMessage({ cmd: 'status' });
    const on = !!(st && st.connected);
    let detail;
    if (on) {
      const attached = (st.attachedTabs || []).length;
      detail =
        'browser&nbsp;<b>' + (st.browserId || '…') + '</b><br>' +
        'active tab&nbsp;<b>' + (st.activeTabId != null ? st.activeTabId : '—') + '</b> · ' +
        'debugger attached on <b>' + attached + '</b> tab(s)';
    } else {
      detail = 'Yuki server not reachable at <b>' + (st && st.wsUrl || 'ws://localhost:3210/ws/browser-ext') + '</b>';
    }
    setConnectedUI(on, detail);
  } catch (e) {
    setConnectedUI(false, '<b>Extension error:</b> ' + (e && e.message || e));
  }
}

document.getElementById('reconnect').addEventListener('click', () => {
  chrome.runtime.sendMessage({ cmd: 'reconnect' });
  setTimeout(refresh, 400);
});

document.getElementById('detachAll').addEventListener('click', () => {
  chrome.runtime.sendMessage({ cmd: 'detachAll' });
});

refresh();

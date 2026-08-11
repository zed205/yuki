(function () {
  // DOM elements
  const messagesEl = document.getElementById('messages');
  const inputForm = document.getElementById('input-form');
  const messageInput = document.getElementById('message-input');
  const imagePreview = document.getElementById('image-preview');
  const sendBtn = document.getElementById('send-btn');
  const statusEl = document.getElementById('status');
  const sessionTreeEl = document.getElementById('session-tree');
  const newSessionBtn = document.getElementById('new-session-btn');
  const addProjectBtn = document.getElementById('add-project-btn');
  const micBtn = document.getElementById('mic-btn');
  const voiceModeBtn = document.getElementById('voice-mode-btn');
  const voiceStatusEl = document.getElementById('voice-status');
  const voiceStatusDot = document.getElementById('voice-status-dot');
  const voiceStatusLabel = document.getElementById('voice-status-label');
  const ttsBtn = document.getElementById('tts-btn');
  const stopBtn = document.getElementById('stop-btn');
  const browserImageEl = document.getElementById('browser-image');
  const browserUrlInput = document.getElementById('browser-url');
  const browserGoBtn = document.getElementById('browser-go');
  const browserScreenshotBtn = document.getElementById('browser-screenshot-btn');
  const closeBrowserBtn = document.getElementById('close-browser-btn');
  const toolsBtn = document.getElementById('tools-btn');
  const thinkingBtn = document.getElementById('thinking-btn');
  const toolsModal = document.getElementById('tools-modal');
  const toolsList = document.getElementById('tools-list');
  const closeToolsBtn = document.getElementById('close-tools-btn');
  const renameModal = document.getElementById('rename-modal');
  const renameInput = document.getElementById('rename-input');
  const renameCancelBtn = document.getElementById('rename-cancel-btn');
  const renameSaveBtn = document.getElementById('rename-save-btn');
  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
  const confirmOkBtn = document.getElementById('confirm-ok-btn');
  const addProjectModal = document.getElementById('add-project-modal');
  const addProjectInput = document.getElementById('add-project-input');
  const addProjectCancelBtn = document.getElementById('add-project-cancel-btn');
  const addProjectSaveBtn = document.getElementById('add-project-save-btn');
  const searchBtn = document.getElementById('search-btn');
  const searchModal = document.getElementById('search-modal');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const closeSearchBtn = document.getElementById('close-search-btn');
  const scrollContainer = document.getElementById('scroll-container');

  // State
  let ws = null;
  let isWaiting = false;
  let currentStreamingId = null;
  let currentStreamingContent = '';
  let currentSessionId = null;
  let activeProjectId = 'default';
  let lastAssistantMessage = '';
  let lastAssistantBubble = null;
  let thinkingBubble = null;
  let thinkingWasShown = false;
  let autoTTS = false;
  let pushToTalk = false;
  let thinkingEnabled = false;
  let pastedImages = [];
  let pastedFiles = [];
  let enableImagePaste = false;
  let connectedConfig = {};

  // voice mode state
  let voiceMode = false;
  let voiceListening = false;
  let voiceTurnInProgress = false;
  let voiceStartFailed = false;
  let voiceGen = 0;
  let lastVoiceGlobalToggleAt = 0;
  let voiceSessionStarting = false;
  let voiceNotifAsked = false;

  // tool toggling state
  let toolEnabled = {};
  let toolListData = [];
  let mcpServers = [];
  const toolGroups = [
    { name: 'File', tools: ['read', 'write', 'edit', 'patch', 'glob', 'grep'] },
    { name: 'Shell', tools: ['shell'] },
    { name: 'Web', tools: ['web_search', 'web_fetch'] },
    { name: 'Browser', tools: ['browser_navigate', 'browser_click', 'browser_fill', 'browser_screenshot', 'browser_get_content', 'browser_get_links'] },
    { name: 'Desktop', tools: ['desktop_viewport', 'desktop_screenshot', 'desktop_snapshot_region', 'desktop_click', 'desktop_type', 'desktop_move', 'desktop_drag', 'desktop_scroll', 'desktop_keypress'] },
    { name: 'Memory', tools: ['memory_save', 'memory_read', 'memory_list', 'memory_delete'] },
    { name: 'Skill', tools: ['skill_list', 'skill_load', 'skill_save', 'skill_delete'] },
    { name: 'Plan', tools: ['plan_create', 'plan_update', 'plan_get', 'plan_remove'] },
  ];

  function updateUtilitySummary() {
    const cfg = connectedConfig;

    let hostPort = '—';
    let isSecure = false;
    if (cfg.endpoint) {
      try {
        const u = new URL(cfg.endpoint);
        hostPort = u.hostname + (u.port ? ':' + u.port : '');
        isSecure = u.protocol === 'https:';
      } catch { hostPort = cfg.endpoint; }
    }
    document.getElementById('util-secure-icon').innerHTML = isSecure ? '&#x1f512;' : '&#x1f513;';
    document.getElementById('util-endpoint').textContent = hostPort;
    document.getElementById('util-endpoint').title = cfg.endpoint || '';
    updateContextUsage();
  }

  function updateContextUsage(promptTokens) {
    const maxCtx = connectedConfig.contextWindow || 64000;
    const estTokens = typeof promptTokens === 'number' ? promptTokens : (lastServerTokens ?? 0);
    const pct = Math.min(100, Math.round((estTokens / maxCtx) * 100));
    document.getElementById('util-context-bar').style.width = pct + '%';
    document.getElementById('util-context-text').textContent = `${Math.round(estTokens / 100) / 10}k / ${Math.round(maxCtx / 1000)}k`;
  }

  function updateThinkingBtnVisual() {
    if (thinkingEnabled) {
      thinkingBtn.className = 'p-2 rounded-lg text-yellow-400 hover:text-yellow-300 hover:bg-surface2 transition-colors';
      thinkingBtn.title = 'Thinking enabled — click to disable';
    } else {
      thinkingBtn.className = 'p-2 rounded-lg text-muted/50 hover:text-muted hover:bg-surface2 transition-colors';
      thinkingBtn.title = 'Thinking disabled — click to enable';
    }
  }

  function buildToolsList(tools) {
    toolsList.innerHTML = '';
    toolEnabled = {};
    for (const t of tools) toolEnabled[t.name] = t.enabled;

    for (const group of toolGroups) {
      const groupTools = group.tools.filter(t => t in toolEnabled);
      if (groupTools.length === 0) continue;

      const section = document.createElement('div');
      section.className = 'border border-border rounded-lg overflow-hidden';

      const groupRow = document.createElement('label');
      groupRow.className = 'flex items-center gap-3 px-3 py-2 bg-surface2/50 cursor-pointer hover:bg-surface2/80 transition-colors border-b border-border';

      const groupCheckbox = document.createElement('input');
      groupCheckbox.type = 'checkbox';
      groupCheckbox.className = 'accent-primaryDark cursor-pointer';

      const groupLabel = document.createElement('span');
      groupLabel.className = 'text-sm font-semibold text-text';
      groupLabel.textContent = group.name;

      groupRow.appendChild(groupCheckbox);
      groupRow.appendChild(groupLabel);
      section.appendChild(groupRow);

      const toolList = document.createElement('div');
      toolList.className = 'divide-y divide-border/50';

      for (const name of groupTools) {
        const row = document.createElement('label');
        row.className = 'flex items-center gap-3 px-3 py-1.5 pl-8 cursor-pointer hover:bg-surface2/30 transition-colors';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = toolEnabled[name];
        checkbox.className = 'accent-primaryDark cursor-pointer';

        const label = document.createElement('span');
        label.className = 'text-xs text-muted font-mono';
        label.textContent = name;

        checkbox.addEventListener('change', () => {
          toolEnabled[name] = checkbox.checked;
          send('tools:toggle', { toolName: name, enabled: checkbox.checked });
          updateGroupCheckbox(groupCheckbox, groupTools);
        });

        row.appendChild(checkbox);
        row.appendChild(label);
        toolList.appendChild(row);
      }

      groupCheckbox.addEventListener('change', () => {
        const checked = groupCheckbox.checked;
        const inputs = toolList.querySelectorAll('input[type="checkbox"]');
        for (const input of inputs) {
          const toolName = input.parentElement.querySelector('span').textContent;
          toolEnabled[toolName] = checked;
          input.checked = checked;
          send('tools:toggle', { toolName, enabled: checked });
        }
      });

      updateGroupCheckbox(groupCheckbox, groupTools);

      section.appendChild(toolList);
      toolsList.appendChild(section);
    }
  }

  function buildMCPList(servers) {
    if (!servers || servers.length === 0) return;

    const section = document.createElement('div');
    section.className = 'border border-border rounded-lg overflow-hidden mb-1';

    const header = document.createElement('div');
    header.className = 'flex items-center gap-3 px-3 py-2 bg-surface2/50 border-b border-border';
    const headerLabel = document.createElement('span');
    headerLabel.className = 'text-sm font-semibold text-text';
    headerLabel.textContent = 'MCP Servers';
    header.appendChild(headerLabel);
    section.appendChild(header);

    const serverList = document.createElement('div');
    serverList.className = 'divide-y divide-border/50';

    for (const s of servers) {
      const row = document.createElement('div');
      row.className = 'px-3 py-2';

      const topRow = document.createElement('div');
      topRow.className = 'flex items-center gap-3';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!s.enabled;
      checkbox.className = 'accent-primaryDark cursor-pointer';
      checkbox.title = 'Enable/disable MCP connection';

      const nameEl = document.createElement('span');
      nameEl.className = 'flex-1 text-xs font-medium text-text font-mono truncate';
      nameEl.textContent = s.name;

      const statusEl = document.createElement('span');
      statusEl.className = 'text-[10px] px-1.5 py-0.5 rounded-full ' + (s.connected ? 'bg-success/15 text-success' : (s.enabled ? 'bg-danger/15 text-danger' : 'bg-surface2 text-muted'));
      statusEl.textContent = s.connected ? 'connected' : (s.enabled ? 'error' : 'off');

      topRow.appendChild(checkbox);
      topRow.appendChild(nameEl);
      topRow.appendChild(statusEl);
      row.appendChild(topRow);

      if (s.tools && s.tools.length > 0) {
        const toolInfo = document.createElement('div');
        toolInfo.className = 'mt-1.5 ml-6 space-y-0.5';
        for (const t of s.tools) {
          const toolRow = document.createElement('div');
          toolRow.className = 'text-[10px] text-muted font-mono truncate';
          toolRow.textContent = t.name;
          if (t.description) toolRow.title = t.description;
          toolInfo.appendChild(toolRow);
        }
        row.appendChild(toolInfo);
      } else if (s.tools && s.tools.length === 0 && s.enabled && !s.connected && s.error) {
        const errEl = document.createElement('div');
        errEl.className = 'mt-1.5 ml-6 text-[10px] text-danger truncate';
        errEl.textContent = s.error;
        errEl.title = s.error;
        row.appendChild(errEl);
      }

      checkbox.addEventListener('change', () => {
        checkbox.disabled = true;
        send('mcp:toggle', { serverName: s.name, enabled: checkbox.checked });
      });

      serverList.appendChild(row);
    }

    section.appendChild(serverList);
    toolsList.appendChild(section);
  }

  function renderToolsUI() {
    buildToolsList(toolListData);
    buildMCPList(mcpServers);
  }

  function updateGroupCheckbox(groupCheckbox, groupTools) {
    const checked = groupTools.every(n => toolEnabled[n]);
    const some = groupTools.some(n => toolEnabled[n]);
    groupCheckbox.checked = checked;
    groupCheckbox.indeterminate = !checked && some;
  }

  // --- Context ---
  let lastServerTokens = null;

  // --- Plan ---
  let planExpanded = true;

  // --- Thinking streaming ---
  let thinkingStreamed = false;

  function updatePlanBar(plan) {
    const bar = document.getElementById('plan-bar');
    const title = document.getElementById('plan-title');
    const progress = document.getElementById('plan-progress');
    const steps = document.getElementById('plan-steps');
    const chevron = document.getElementById('plan-chevron');
    if (!bar) return;

    if (!plan) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');
    title.textContent = plan.title;

    const total = plan.steps.length;
    const done = plan.steps.filter(s => s.status === 'completed').length;
    progress.textContent = `${done}/${total} completed`;

    steps.innerHTML = '';
    for (const step of plan.steps) {
      const el = document.createElement('div');
      el.className = 'flex items-center gap-2 text-xs text-muted';
      const color = step.status === 'completed' ? 'text-success' : step.status === 'in_progress' ? 'text-primary' : step.status === 'cancelled' ? 'text-danger' : 'text-muted';
      el.innerHTML = `<span class="${color} text-lg leading-none">●</span> <span class="${step.status === 'completed' ? 'line-through text-muted/60' : ''}">${escapeHtml(step.description)}</span>`;
      steps.appendChild(el);
    }

    chevron.classList.toggle('-rotate-90', !planExpanded);
    steps.classList.toggle('hidden', !planExpanded);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // --- Markdown ---
  let markdownReady = false;

  function initMarkdown() {
    if (typeof marked !== 'undefined' && !markdownReady) {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
      markdownReady = true;
    }
  }

  // Wait for marked to load
  function waitForMarked() {
    if (typeof marked !== 'undefined') {
      initMarkdown();
    } else {
      setTimeout(waitForMarked, 50);
    }
  }
  waitForMarked();

  function renderMarkdown(text) {
    if (!text) return '';
    initMarkdown();
    if (!markdownReady) {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    try {
      return marked.parse(text);
    } catch (e) {
      console.error('Markdown parse error:', e);
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  function renderMath(container) {
    if (typeof renderMathInElement === 'function') {
      try {
        renderMathInElement(container, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          throwOnError: false,
        });
      } catch (e) {
        console.error('KaTeX error:', e);
      }
    }
  }

  // --- WebSocket ---
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);

    ws.onopen = () => {
      updateStatus('Connected', true);
    };

    ws.onclose = () => {
      updateStatus('Disconnected', false);
      if (!isWaiting) {
        setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      updateStatus('Error', false);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
  }

  function updateStatus(text, connected) {
    statusEl.textContent = text;
    statusEl.className = connected
      ? 'text-sm mt-1 text-success font-normal'
      : 'text-sm mt-1 text-danger font-normal';
  }

  function send(type, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }

  // --- Message Handling ---
  function handleMessage(data) {
    switch (data.type) {
      case 'session:connected':
        currentSessionId = data.data.sessionId;
        activeProjectId = data.data.activeProjectId || 'default';
        thinkingEnabled = data.data.thinkingEnabled === true;
        enableImagePaste = !!data.data.config?.enableImagePaste;
        connectedConfig = data.data.config || {};
        voiceMode = !!data.data.voiceMode;
        updateVoiceModeVisual();
        updateUtilitySummary();
        buildModelSelect(data.data.models || [], data.data.activeModel);
        const savedModel = localStorage.getItem('yukiweb_model');
        if (savedModel && savedModel !== data.data.activeModel && (data.data.models || []).some(m => m.name === savedModel)) {
          send('model:switch', { modelName: savedModel });
        }
        loadTree();
        loadSessionMessages(currentSessionId);
        updateThinkingBtnVisual();
        if (voiceMode) {
          startVoiceListen();
        }
        break;

      case 'chat:message':
        {
          const msgs = messagesEl.querySelectorAll('[data-message-id=""]');
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].className.includes('justify-end')) {
              msgs[i].dataset.messageId = data.data.messageId;
              break;
            }
          }
        }
        break;

      case 'chat:chunk':
        streamingChunk(data.data.chunk, data.data.messageId);
        break;

      case 'thinking:chunk':
        if (!thinkingStreamed && thinkingBubble) {
          finalizeThinkingBubble();
        }
        const typingEl = document.querySelector('.typing-indicator');
        if (typingEl) typingEl.remove();
        thinkingStreamed = true;
        if (!thinkingBubble) showThinkingBubble();
        if (thinkingBubble) {
          thinkingBubble.body.textContent += data.data.chunk;
          thinkingBubble.details.open = connectedConfig.expandThinking !== false;
          scrollToBottom();
        }
        break;

      case 'thinking:toggled':
        thinkingEnabled = data.data.enabled;
        updateThinkingBtnVisual();
        break;

      case 'voice:status':
        syncVoiceMode(!!data.data.enabled);
        break;

      case 'voice:global-toggle':
        handleGlobalVoiceToggle();
        break;

      case 'chat:response':
        if (thinkingStreamed) {
          // Thinking was streamed via chunks — finalize bubble only if no tool calls follow
          if (!data.data.toolCalls || data.data.toolCalls.length === 0) {
            if (thinkingBubble) finalizeThinkingBubble();
          }
          // Otherwise keep it open during tool execution
        } else {
          // No streamed thinking — finalize any leftover bubble from prior iteration
          if (thinkingBubble) finalizeThinkingBubble();
          // Show fallback thinking bubble only if content wasn't already streamed
          if (!currentStreamingContent) {
            const hasReasoning = !!data.data.reasoningContent;
            const hasThinkTag = !hasReasoning && data.data.message && data.data.message.indexOf('<think>') !== -1;
            let thinkText = '';
            if (hasReasoning) {
              thinkText = data.data.reasoningContent;
            } else if (hasThinkTag) {
              const m = data.data.message.match(/<think>([\s\S]*?)<\/think>/);
              if (m) thinkText = m[1].trim();
            }
            if (thinkText) {
              const typingEl2 = document.querySelector('.typing-indicator');
              if (typingEl2) typingEl2.remove();
              showThinkingBubble();
              updateThinkingBubble(thinkText);
              if (!data.data.toolCalls || data.data.toolCalls.length === 0) {
                finalizeThinkingBubble();
              }
            }
          }
        }
        thinkingStreamed = false;
        if (data.data.toolCalls) {
          for (const tc of data.data.toolCalls) {
            showToolCall(tc);
          }
        }
        if (data.data.message) {
          if (currentStreamingContent) {
            // Content was already streamed — update the live message with final content
            updateLastMessage(data.data.message);
          } else {
            appendMessage('assistant', data.data.message);
          }
        }
        lastAssistantMessage = data.data.message || '';
        currentStreamingId = null;
        currentStreamingContent = '';
        if (!data.data.toolCalls || data.data.toolCalls.length === 0) {
          setIsWaiting(false);
          voiceTurnInProgress = false;
        }
        if (voiceMode && lastAssistantMessage) {
          handleVoiceResponse();
        } else if (!voiceMode && autoTTS && lastAssistantMessage && (!data.data.toolCalls || data.data.toolCalls.length === 0)) {
          playLastResponse();
        }
        break;

      case 'tool:call':
        updateToolCall(data.data.toolCall);
        break;

      case 'tool:result':
        updateToolResult(data.data.toolCallId, data.data.result, data.data.status);
        break;

      case 'context:update':
        lastServerTokens = data.data.promptTokens;
        updateContextUsage(data.data.promptTokens);
        break;

      case 'tools:list':
        toolListData = data.data.tools || [];
        renderToolsUI();
        break;

      case 'mcp:list':
        mcpServers = data.data.servers || [];
        renderToolsUI();
        break;

      case 'mcp:toggled':
        mcpServers = mcpServers.map(s => s.name === data.data.serverName ? { ...s, enabled: data.data.enabled, error: data.data.error, connected: data.data.success && data.data.enabled } : s);
        renderToolsUI();
        break;

      case 'session:switched':
        currentSessionId = data.data.sessionId;
        activeProjectId = data.data.projectId || 'default';
        thinkingEnabled = data.data.thinkingEnabled === true;
        updateThinkingBtnVisual();
        syncVoiceMode(!!data.data.voiceMode);
        loadTree();
        loadSessionMessages(currentSessionId);
        break;

      case 'project:switched':
        currentSessionId = data.data.sessionId;
        activeProjectId = data.data.projectId;
        thinkingEnabled = data.data.thinkingEnabled === true;
        updateThinkingBtnVisual();
        syncVoiceMode(!!data.data.voiceMode);
        loadTree();
        loadSessionMessages(currentSessionId);
        break;

      case 'session:moved':
        if (data.data.sessionId === currentSessionId) {
          activeProjectId = data.data.projectId || activeProjectId;
        }
        loadTree();
        break;

      case 'model:switched':
        if (data.data.activeModel) {
          localStorage.setItem('yukiweb_model', data.data.activeModel);
          const modelSelect = document.getElementById('model-select');
          if (modelSelect) modelSelect.value = data.data.activeModel;
          connectedConfig = { ...connectedConfig, ...data.data };
          if (typeof data.data.thinkingEnabled === 'boolean') {
            thinkingEnabled = data.data.thinkingEnabled;
            updateThinkingBtnVisual();
          }
          updateUtilitySummary();
        }
        break;

      case 'session:cleared':
        clearChatDisplay();
        break;

      case 'session:renamed':
        loadTree();
        break;

      case 'plan:updated':
        updatePlanBar(data.data.plan);
        break;

      case 'message:reverted':
        messageInput.value = data.data.text;
        messageInput.dispatchEvent(new Event('input'));
        setTimeout(() => messageInput.focus(), 0);
        loadSessionMessages(currentSessionId);
        break;

      case 'message:pruned':
      case 'message:unpruned':
        loadSessionMessages(currentSessionId);
        break;

      case 'chat:stopped':
        AudioPlayer.stop();
        if (thinkingBubble) removeThinkingBubble();
        setIsWaiting(false);
        lastAssistantMessage = '';
        stopBtn.disabled = true;
        voiceTurnInProgress = false;
        if (voiceMode) startVoiceListen();

        {
          const el = document.createElement('div');
          el.className = 'flex justify-center';
          const bubble = document.createElement('div');
          bubble.className = 'bg-surface border border-border/50 rounded-xl px-4 py-2 text-sm text-danger/70 italic';
          bubble.textContent = '[Action stopped]';
          el.appendChild(bubble);
          messagesEl.appendChild(el);
          scrollToBottom();
        }
        break;
    }
  }

  // --- Thinking & Content Rendering ---
  function buildThinkingBlock(thought, isOpen) {
    const details = document.createElement('details');
    details.className = 'bg-surface/50 border border-yellow-500/20 rounded-lg mb-2 group text-xs thinking-block';

    const summary = document.createElement('summary');
    summary.className = 'flex items-center gap-2 px-3 py-1.5 cursor-pointer text-muted hover:text-text rounded-lg list-none';

    const arrow = document.createElement('span');
    arrow.className = 'text-muted transition-transform group-open:rotate-90 text-[10px]';
    arrow.textContent = '▶';

    const label = document.createElement('span');
    label.className = 'text-yellow-400 font-medium';
    label.textContent = isOpen ? 'Thinking...' : 'Thought';

    summary.appendChild(arrow);
    summary.appendChild(label);

    const body = document.createElement('div');
    body.className = 'px-3 pb-2 text-muted leading-relaxed border-t border-yellow-500/10 pt-2 mt-1 break-words';
    body.innerHTML = renderMarkdown(thought);

    details.appendChild(summary);
    details.appendChild(body);
    return details;
  }

  function renderAssistantContent(container, text) {
    container.innerHTML = '';

    if (!text) return;

    if (thinkingWasShown) {
      text = text
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<\/?think>/g, '')
        .replace(/^\s+/, '');
    }

    if (text.indexOf('<think') === -1) {
      container.innerHTML = renderMarkdown(text);
      renderMath(container);
      return;
    }

    let idx = 0;
    const closeTag = '</think>';

    while (idx < text.length) {
      const openStart = text.indexOf('<think>', idx);
      if (openStart === -1) {
        container.innerHTML += renderMarkdown(text.slice(idx));
        break;
      }

      if (openStart > idx) {
        container.innerHTML += renderMarkdown(text.slice(idx, openStart));
      }

      const thinkContentStart = openStart + '<think>'.length;
      const closeEnd = text.indexOf(closeTag, thinkContentStart);

      if (closeEnd === -1) {
        const rest = text.slice(thinkContentStart);
        const block = buildThinkingBlock(rest, true);
        container.appendChild(block);
        break;
      }

      const thinkContent = text.slice(thinkContentStart, closeEnd);
      const block = buildThinkingBlock(thinkContent, false);
      container.appendChild(block);

      idx = closeEnd + closeTag.length;
    }

    renderMath(container);
  }

  // --- Thinking Bubble ---
  function showThinkingBubble() {
    if (thinkingBubble) return;
    thinkingWasShown = true;

    const wrapper = document.createElement('div');
    wrapper.className = 'flex justify-start thinking-wrapper';

    const details = document.createElement('details');
    details.className = 'bg-surface/50 border border-yellow-500/20 rounded-lg text-xs thinking-block max-w-[90%] font-mono group';
    details.open = connectedConfig.expandThinking !== false;

    const summary = document.createElement('summary');
    summary.className = 'flex items-center gap-2 px-3 py-1.5 cursor-pointer text-muted hover:text-text rounded-lg list-none';

    const arrow = document.createElement('span');
    arrow.className = 'text-muted transition-transform group-open:rotate-90 text-[10px]';
    arrow.textContent = '▶';

    const label = document.createElement('span');
    label.className = 'text-yellow-400 font-medium';
    label.textContent = 'Thinking';

    const dot1 = document.createElement('span');
    dot1.className = 'animate-pulse';
    dot1.textContent = '.';

    const dot2 = document.createElement('span');
    dot2.className = 'animate-pulse animation-delay-200';
    dot2.textContent = '.';

    const dot3 = document.createElement('span');
    dot3.className = 'animate-pulse animation-delay-400';
    dot3.textContent = '.';

    const statusDot = document.createElement('span');
    statusDot.className = 'ml-auto inline-block w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse';

    summary.appendChild(arrow);
    summary.appendChild(label);
    summary.appendChild(dot1);
    summary.appendChild(dot2);
    summary.appendChild(dot3);
    summary.appendChild(statusDot);

    const body = document.createElement('div');
    body.className = 'thinking-body px-3 pb-2 text-xs text-muted font-mono border-t border-yellow-500/10 pt-2 mt-1 whitespace-pre-wrap break-words';

    details.appendChild(summary);
    details.appendChild(body);
    wrapper.appendChild(details);
    messagesEl.appendChild(wrapper);

    thinkingBubble = { wrapper, details, body, summary, label, statusDot };
    scrollToBottom();
  }

  function updateThinkingBubble(text) {
    if (!thinkingBubble) return;
    thinkingBubble.body.textContent = text;
    scrollToBottom();
  }

  function finalizeThinkingBubble() {
    if (!thinkingBubble) return;
    thinkingBubble.details.open = false;
    thinkingBubble.label.textContent = 'Thought';
    thinkingBubble.details.className = 'bg-surface/50 border border-border rounded-lg text-xs thinking-block max-w-[90%] font-mono group';
    if (thinkingBubble.statusDot) {
      thinkingBubble.statusDot.remove();
    }
    const dots = thinkingBubble.summary.querySelectorAll('.animate-pulse');
    for (const d of dots) d.remove();

    const raw = thinkingBubble.body.textContent || '';
    const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinkingBubble.body.textContent = thinkMatch[1].trim();
    }
    thinkingBubble = null;
  }

  function removeThinkingBubble(delayed) {
    if (!thinkingBubble) return;
    const doRemove = () => {
      thinkingBubble.wrapper.remove();
      thinkingBubble = null;
    };
    if (delayed) {
      setTimeout(doRemove, 300);
    } else {
      doRemove();
    }
  }

  // --- Chat Display ---
  function createMsgMenu(items) {
    const menu = document.createElement('div');
    menu.className = 'msg-menu hidden z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[100px]';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'w-full text-left px-3 py-1.5 text-xs text-text hover:bg-surface2 transition-colors';
      btn.textContent = item.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        item.action();
        menu.classList.add('hidden');
      });
      menu.appendChild(btn);
    }
    return menu;
  }

  function closeAllMsgMenus() {
    document.querySelectorAll('.msg-menu').forEach(m => m.classList.add('hidden'));
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.msg-menu') && !e.target.closest('.msg-menu-btn')) {
      closeAllMsgMenus();
    }
  });

  function toggleMsgMenu(menuEl, btnEl) {
    closeAllMsgMenus();
    const rect = btnEl.getBoundingClientRect();
    menuEl.classList.remove('hidden');
    menuEl.style.position = 'fixed';
    menuEl.style.top = (rect.bottom + 4) + 'px';
    menuEl.style.left = rect.left + 'px';
  }

  function appendMessage(role, content, messageId, pruned) {
    const msgEl = document.createElement('div');
    msgEl.dataset.messageId = messageId || '';
    if (pruned) msgEl.dataset.pruned = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'relative group';

    if (role === 'user') {
      msgEl.className = 'flex justify-end';
      const bubble = document.createElement('div');
      bubble.className = (pruned ? 'opacity-40 ' : '') + 'bg-userMsg rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed';

      const contentEl = document.createElement('div');
      contentEl.className = 'message-content whitespace-pre-wrap break-words';
      contentEl.textContent = content || '';
      bubble.appendChild(contentEl);

      const ts = document.createElement('div');
      ts.className = 'text-[10px] text-muted/60 mt-1 text-right';
      ts.textContent = new Date().toLocaleTimeString();
      bubble.appendChild(ts);

      wrapper.appendChild(bubble);

      const menuBtn = document.createElement('button');
      menuBtn.className = 'msg-menu-btn absolute -left-6 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-text p-0.5 text-xs';
      menuBtn.textContent = '···';
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMsgMenu(menuEl, menuBtn);
      });
      wrapper.appendChild(menuBtn);

      const menuEl = createMsgMenu([
        { label: 'Revert', action: () => { send('message:revert', { messageId: msgEl.dataset.messageId, sessionId: currentSessionId }); } },
        { label: pruned ? 'Unprune' : 'Prune', action: () => { send(pruned ? 'message:unprune' : 'message:prune', { messageId: msgEl.dataset.messageId, sessionId: currentSessionId }); } },
      ]);
      wrapper.appendChild(menuEl);

      msgEl.appendChild(wrapper);
    } else {
      msgEl.className = 'flex justify-start';
      const bubble = document.createElement('div');
      bubble.className = (pruned ? 'opacity-40 ' : '') + 'bg-asstMsg border border-border rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed';

      const contentEl = document.createElement('div');
      contentEl.className = 'message-content prose prose-sm prose-invert max-w-none break-words';
      if (content) renderAssistantContent(contentEl, content);
      bubble.appendChild(contentEl);

      const ts = document.createElement('div');
      ts.className = 'text-[10px] text-muted/60 mt-1';
      ts.textContent = new Date().toLocaleTimeString();
      bubble.appendChild(ts);

      wrapper.appendChild(bubble);

      const menuBtn = document.createElement('button');
      menuBtn.className = 'msg-menu-btn absolute -right-6 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-text p-0.5 text-xs';
      menuBtn.textContent = '···';
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMsgMenu(menuEl, menuBtn);
      });
      wrapper.appendChild(menuBtn);

      const menuEl = createMsgMenu([
        { label: 'Read', action: () => {
          if (content) AudioPlayer.playSynthesized(content);
        }},
      ]);
      wrapper.appendChild(menuEl);

      msgEl.appendChild(wrapper);
      lastAssistantBubble = msgEl;
    }

    messagesEl.appendChild(msgEl);
    scrollToBottom();
    updateContextUsage();
    return msgEl;
  }

  function streamingChunk(chunk, messageId) {
    // If thinking bubble is open, finalize it — content streaming means thinking is done
    if (thinkingBubble) {
      finalizeThinkingBubble();
    }

    if (messageId !== currentStreamingId) {
      currentStreamingId = messageId;
      currentStreamingContent = chunk;
      appendMessage('assistant', chunk);
    } else {
      currentStreamingContent += chunk;
      updateLastMessage(currentStreamingContent);
    }
    scrollToBottom();
  }

  function updateLastMessage(newContent) {
    const bubble = lastAssistantBubble || document.querySelector('.assistant-bubble:last-child');
    if (bubble) {
      const contentEl = bubble.querySelector('.message-content');
      if (contentEl) {
        let renderContent = newContent;
        if (thinkingWasShown) {
          renderContent = renderContent
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/<\/?think>/g, '')
            .replace(/^\s+/, '');
        }
        renderAssistantContent(contentEl, renderContent);
      }
    }
  }

  function showToolCall(toolCall) {
    const details = document.createElement('details');
    details.className = 'bg-surface/50 border border-border rounded-lg text-sm group font-mono w-full min-w-0';
    details.id = `tool-${toolCall.id}`;
    details.open = connectedConfig.expandToolOutputs !== false;

    const summary = document.createElement('summary');
    summary.className = 'flex items-center gap-2 px-3 py-2 cursor-pointer text-xs text-muted hover:text-text hover:bg-surface2/50 rounded-lg list-none overflow-hidden';

    const arrow = document.createElement('span');
    arrow.className = 'text-muted transition-transform group-open:rotate-90 text-[10px] shrink-0';
    arrow.innerHTML = '▶';

    const icon = document.createElement('span');
    icon.className = 'shrink-0';
    icon.textContent = '⚙';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-mono text-primary font-medium shrink-0';
    nameSpan.textContent = `${toolCall.name}`;

    const paramsSpan = document.createElement('span');
    paramsSpan.className = 'text-muted truncate min-w-0';
    paramsSpan.textContent = JSON.stringify(toolCall.parameters);

    const statusBadge = document.createElement('span');
    statusBadge.className = 'tool-status ml-auto text-xs text-yellow-400 font-medium shrink-0';
    statusBadge.textContent = '...';

    summary.appendChild(arrow);
    summary.appendChild(icon);
    summary.appendChild(nameSpan);
    summary.appendChild(paramsSpan);
    summary.appendChild(statusBadge);

    const body = document.createElement('div');
    body.className = 'px-3 pb-2';

    const resultEl = document.createElement('div');
    resultEl.className = 'tool-result text-xs text-muted font-mono bg-bg rounded p-2 max-h-32 overflow-y-auto hidden';

    body.appendChild(resultEl);
    details.appendChild(summary);
    details.appendChild(body);

    const wrapper = document.createElement('div');
    wrapper.className = 'flex justify-start tool-call-wrapper max-w-[90%]';
    wrapper.appendChild(details);
    messagesEl.appendChild(wrapper);
    scrollToBottom();
  }

  function updateToolCall(toolCall) {
    const el = document.getElementById(`tool-${toolCall.id}`);
    if (el) {
      const statusEl = el.querySelector('.tool-status');
      if (statusEl) {
        if (toolCall.status === 'running') {
          statusEl.textContent = '...';
          statusEl.className = 'tool-status ml-auto text-xs text-yellow-400 font-medium';
        } else if (toolCall.status === 'completed') {
          statusEl.textContent = '✓';
          statusEl.className = 'tool-status ml-auto text-xs text-success font-bold';
        } else if (toolCall.status === 'error') {
          statusEl.textContent = '✗';
          statusEl.className = 'tool-status ml-auto text-xs text-danger font-bold';
        }
      }
    }
  }

  function updateToolResult(toolCallId, result, status) {
    const el = document.getElementById(`tool-${toolCallId}`);
    if (el) {
      const statusEl = el.querySelector('.tool-status');
      if (statusEl) {
        if (status === 'completed') {
          statusEl.textContent = '✓';
          statusEl.className = 'tool-status ml-auto text-xs text-success font-bold';
        } else if (status === 'error') {
          statusEl.textContent = '✗';
          statusEl.className = 'tool-status ml-auto text-xs text-danger font-bold';
        } else {
          statusEl.textContent = '...';
          statusEl.className = 'tool-status ml-auto text-xs text-yellow-400 font-medium';
        }
      }

      const resultEl = el.querySelector('.tool-result');
      if (resultEl && result) {
        resultEl.classList.remove('hidden');
        let displayResult = result.substring(0, 500);
        if (result.length > 500) {
          displayResult += '... (truncated)';
        }
        resultEl.textContent = displayResult;
      }
    }
  }

function scrollToBottom() {
  scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

  function setIsWaiting(waiting) {
    isWaiting = waiting;
    sendBtn.disabled = waiting;
    messageInput.disabled = waiting;
    stopBtn.disabled = !waiting;

    const existing = document.querySelector('.typing-indicator');
    if (waiting && !existing) {
      const el = document.createElement('div');
      el.className = 'typing-indicator flex justify-start';
      el.innerHTML = '<div class="bg-surface border border-border rounded-2xl rounded-bl-md px-4 py-2 text-xs text-muted">Yuki is processing<span class="animate-pulse">...</span></div>';
      messagesEl.appendChild(el);
      scrollToBottom();
    } else if (!waiting && existing) {
      existing.remove();
    }
  }

  function clearChatDisplay() {
    messagesEl.innerHTML = '';
    lastAssistantMessage = '';
    lastAssistantBubble = null;
    thinkingBubble = null;
    thinkingWasShown = false;
    updateContextUsage();
  }

  // --- Session tree (jsTree: Project > Sessions) ---
  let treeInstance = null;
  let nodeMenuEl = null;
  let confirmCallback = null;

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function sessionNodeHtml(s) {
    const title = s.title || `${s.messageCount} messages`;
    return '<span class="tree-session">' +
      '<span class="tree-node-title">' + esc(title) + '</span>' +
      '<span class="tree-node-meta">' + (s.messageCount || 0) + '</span>' +
      '<button type="button" class="tree-menu-btn" data-kind="session" data-id="' + s.id + '">&#183;&#183;&#183;</button>' +
    '</span>';
  }

  function projectNodeHtml(p) {
    const count = (p.sessions || []).length;
    return '<span class="tree-node">' +
      '<span class="tree-node-text"><span class="tree-node-title">' + esc(p.name) + '</span></span>' +
      '<span class="tree-node-meta">' + count + '</span>' +
      '<button type="button" class="tree-menu-btn" data-kind="project" data-id="' + p.id + '">&#183;&#183;&#183;</button>' +
    '</span>';
  }

  function buildTreeNodes(treeData) {
    const nodes = [];
    for (const p of treeData.projects || []) {
      nodes.push({
        id: 'proj-' + p.id,
        parent: '#',
        text: projectNodeHtml(p),
        state: { opened: false },
        data: { kind: 'project', projectId: p.id, name: p.name },
      });
      for (const s of (p.sessions || [])) {
        nodes.push({
          id: 'sess-' + s.id,
          parent: 'proj-' + p.id,
          text: sessionNodeHtml(s),
          data: { kind: 'session', sessionId: s.id, projectId: p.id, title: s.title || '' },
        });
      }
    }
    return nodes;
  }

  function initTree() {
    if (treeInstance || !window.jQuery || !window.jQuery.fn.jstree) return;
    window.jQuery(sessionTreeEl).jstree({
      core: {
        multiple: false,
        themes: { name: 'default', dots: false, icons: false, responsive: true },
        data: [],
        check_callback: (operation, node, parent) => {
          if (operation !== 'move_node') return true;
          const kind = node && node.data && node.data.kind;
          if (kind === 'project') {
            return parent && parent.id === '#';
          }
          if (kind === 'session') {
            return parent && parent.data && parent.data.kind === 'project';
          }
          return true;
        },
      },
      plugins: ['dnd', 'wholerow', 'state'],
      state: { key: 'yukiweb-tree-v2' },
      dnd: {
        copy: false,
        is_draggable: (nodes) => {
          for (const n of nodes) {
            if (n.data && n.data.kind === 'project' && n.data.projectId === 'default') return false;
          }
          return true;
        },
      },
    });
    treeInstance = window.jQuery(sessionTreeEl).jstree(true);
    bindTreeEvents();
  }

  function bindTreeEvents() {
    window.jQuery(sessionTreeEl).on('activate_node.jstree', (e, data) => {
      const node = data.node;
      const kind = node && node.data && node.data.kind;
      if (kind === 'project') {
        treeInstance.toggle_node(node);
        if (currentSessionId) treeInstance.select_node('sess-' + currentSessionId, false, true);
      } else if (kind === 'session') {
        if (node.data.sessionId !== currentSessionId) switchSession(node.data.sessionId);
      }
    });

    window.jQuery(sessionTreeEl).on('refresh.jstree', () => {
      if (!currentSessionId || !treeInstance) return;
      const sessId = 'sess-' + currentSessionId;
      const node = treeInstance.get_node(sessId);
      if (node && node.parent && node.parent !== '#') {
        treeInstance.open_node(node.parent, false);
      }
      treeInstance.deselect_all();
      treeInstance.select_node(sessId, false);
    });

    window.jQuery(sessionTreeEl).on('move_node.jstree', (e, data) => {
      const node = data.node;
      const kind = node && node.data && node.data.kind;
      if (kind === 'session') {
        const parentNode = data.parent !== '#' ? treeInstance.get_node(data.parent) : null;
        const targetProjectId = parentNode && parentNode.data ? parentNode.data.projectId : null;
        if (targetProjectId && targetProjectId !== node.data.projectId) {
          node.data.projectId = targetProjectId;
          send('session:move', { sessionId: node.data.sessionId, projectId: targetProjectId });
        } else {
          loadTree();
        }
      } else if (kind === 'project') {
        persistProjectOrder();
      }
    });

    sessionTreeEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.tree-menu-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openNodeMenu(btn.dataset.kind, btn.dataset.id, e.clientX, e.clientY);
    }, true);

    sessionTreeEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tree-menu-btn')) e.stopPropagation();
    }, true);
  }

  let treeRefreshInFlight = false;
  let treeRefreshQueued = false;
  let treeRefreshTimer = null;

  function runRefresh() {
    treeRefreshInFlight = true;
    clearTimeout(treeRefreshTimer);
    treeRefreshTimer = setTimeout(() => {
      treeRefreshInFlight = false;
      if (treeRefreshQueued) {
        treeRefreshQueued = false;
        runRefresh();
      }
    }, 3000);
    window.jQuery(sessionTreeEl).one('refresh.jstree', () => {
      clearTimeout(treeRefreshTimer);
      treeRefreshInFlight = false;
      if (treeRefreshQueued) {
        treeRefreshQueued = false;
        runRefresh();
      }
    });
    treeInstance.refresh();
  }

  function refreshTree(treeData) {
    if (!treeInstance) initTree();
    treeInstance.settings.core.data = buildTreeNodes(treeData);
    if (treeRefreshInFlight) {
      treeRefreshQueued = true;
      return;
    }
    runRefresh();
  }

  async function loadTree() {
    try {
      const res = await fetch('/api/tree');
      const data = await res.json();
      if (typeof data.activeProjectId === 'string') activeProjectId = data.activeProjectId;
      refreshTree(data);
    } catch (err) {
      console.error('Failed to load tree:', err);
    }
  }

  function persistProjectOrder() {
    const order = [];
    const container = sessionTreeEl.querySelector('ul.jstree-container-ul');
    if (container) {
      for (const li of container.children) {
        if (li.id && li.id.startsWith('proj-')) order.push(li.id.slice(5));
      }
    }
    if (order.length) {
      fetch('/api/projects/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: order }),
      }).catch(() => {});
    }
  }

  // --- Node context menu ---
  function closeNodeMenu() {
    if (nodeMenuEl) {
      nodeMenuEl.remove();
      nodeMenuEl = null;
    }
  }

  function openNodeMenu(kind, id, x, y) {
    closeNodeMenu();
    nodeMenuEl = document.createElement('div');
    nodeMenuEl.className = 'tree-node-menu';

    function addMenuItem(label, fn, danger) {
      const b = document.createElement('button');
      b.textContent = label;
      if (danger) b.className = 'danger';
      b.addEventListener('click', () => { closeNodeMenu(); fn(); });
      nodeMenuEl.appendChild(b);
    }

    if (kind === 'project') {
      addMenuItem('New Session', () => createSession(id));
      if (id !== 'default') {
        addMenuItem('Delete Project', () => {
          const node = treeInstance.get_node('proj-' + id);
          const name = (node && node.data && node.data.name) || id;
          showConfirmModal(
            `Delete "${name}"?`,
            'All sessions in this project will be deleted. The workspace folder will be kept.',
            () => deleteProject(id)
          );
        }, true);
      }
    } else {
      addMenuItem('Rename', () => {
        const node = treeInstance.get_node('sess-' + id);
        showRenameModal(id, (node && node.data && node.data.title) || '');
      });
      addMenuItem('Delete', () => deleteSessionById(id), true);
    }

    document.body.appendChild(nodeMenuEl);
    const mw = nodeMenuEl.offsetWidth;
    const mh = nodeMenuEl.offsetHeight;
    let nx = x;
    let ny = y;
    if (nx + mw > window.innerWidth - 8) nx = window.innerWidth - mw - 8;
    if (ny + mh > window.innerHeight - 8) ny = window.innerHeight - mh - 8;
    nodeMenuEl.style.left = nx + 'px';
    nodeMenuEl.style.top = ny + 'px';
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tree-node-menu')) closeNodeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNodeMenu();
  });

  let renameSessionId = null;

  function showRenameModal(sessionId, currentTitle) {
    renameSessionId = sessionId;
    renameInput.value = currentTitle || '';
    renameModal.classList.remove('hidden');
    setTimeout(() => renameInput.focus(), 100);
  }

  function renameSession() {
    const title = renameInput.value.trim();
    if (!title || !renameSessionId) return;
    send('session:rename', { sessionId: renameSessionId, title });
    renameModal.classList.add('hidden');
    renameSessionId = null;
  }

  function switchSession(id) {
    if (id === currentSessionId) return;
    send('session:switch', { sessionId: id });
    currentSessionId = id;
    loadTree();
  }

  function buildModelSelect(models, activeModel) {
    const select = document.getElementById('model-select');
    if (!select) return;
    select.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      if (m.name === activeModel) opt.selected = true;
      select.appendChild(opt);
    }
    select.value = activeModel;
    if (connectedConfig) {
      connectedConfig.model = (models.find(m => m.name === activeModel) || {}).model || connectedConfig.model;
    }
  }

  document.addEventListener('change', (e) => {
    if (e.target.id === 'model-select') {
      const modelName = e.target.value;
      send('model:switch', { modelName });
    }
  });

  async function loadSessionMessages(id) {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const session = await res.json();
      clearChatDisplay();
      thinkingBubble = null;
      for (let mi = 0; mi < session.messages.length; mi++) {
        const msg = session.messages[mi];
        if (msg.role !== 'system') {
          if (msg.role === 'assistant') {
            // Finalize previous thinking bubble before showing a new step
            if (thinkingBubble) {
              finalizeThinkingBubble();
            }
            thinkingWasShown = false;
            if (msg.reasoningContent) {
              showThinkingBubble();
              updateThinkingBubble(msg.reasoningContent);
            }
            if (msg.toolCalls) {
              for (const tc of msg.toolCalls) {
                showToolCall(tc);
                updateToolCall(tc);
                if (tc.result) {
                  updateToolResult(tc.id, tc.result, tc.status);
                }
              }
            }
          }
          if (msg.content) {
            appendMessage(msg.role, msg.content, msg.id, msg.pruned);
            if (msg.role === 'assistant') {
              lastAssistantMessage = msg.content;
            }
          }
        }
      }
      if (thinkingBubble) {
        finalizeThinkingBubble();
      }
      updateContextUsage();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  }

  async function createSession(projectId) {
    try {
      const pid = String(projectId || activeProjectId || 'default');
      const res = await fetch(`/api/sessions?projectId=${encodeURIComponent(pid)}`, { method: 'POST' });
      const data = await res.json();
      currentSessionId = data.id;
      activeProjectId = pid;
      clearChatDisplay();
      loadTree();
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }

  async function deleteSessionById(id) {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (currentSessionId === id) {
        currentSessionId = null;
        clearChatDisplay();
      }
      loadTree();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }

  // --- Audio ---
  async function toggleRecording() {
    if (AudioRecorder.isRecording) {
      AudioRecorder.stopRecording();
      micBtn.classList.remove('ring-2', 'ring-danger', 'ring-offset-2', 'ring-offset-bg', 'text-danger');
      return;
    }

    const started = await AudioRecorder.start();
    if (!started) {
      appendMessage('assistant', 'Could not access microphone. Please check permissions.');
      return;
    }

    micBtn.classList.add('ring-2', 'ring-danger', 'ring-offset-2', 'ring-offset-bg', 'text-danger');
    messageInput.disabled = true;
  }

  async function startPushToTalk() {
    if (voiceMode) return;
    if (AudioRecorder.isRecording) return;
    pushToTalk = true;
    const started = await AudioRecorder.start();
    if (!started) {
      pushToTalk = false;
      appendMessage('assistant', 'Could not access microphone. Please check permissions.');
      return;
    }
    micBtn.classList.add('ring-2', 'ring-danger', 'ring-offset-2', 'ring-offset-bg', 'text-danger');
    messageInput.disabled = true;
  }

  function stopPushToTalk() {
    if (!pushToTalk) return;
    pushToTalk = false;
    stopRecordingAndTranscribe();
  }

  async function stopRecordingAndTranscribe() {
    if (!AudioRecorder.isRecording) return;

    const base64 = await AudioRecorder.stop();
    micBtn.classList.remove('ring-2', 'ring-danger', 'ring-offset-2', 'ring-offset-bg', 'text-danger');
    messageInput.disabled = false;
    if (!base64) return;

    try {
      const res = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64 }),
      });

      const data = await res.json();

      if (data.text) {
        messageInput.value = data.text;
        inputForm.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    } catch (err) {
      console.error('Transcription failed:', err);
    }
  }

  async function playLastResponse() {
    if (!lastAssistantMessage) return;
    await AudioPlayer.playSynthesized(lastAssistantMessage);
  }

  function setAutoTTS(on) {
    autoTTS = on;
    if (on) {
      ttsBtn.classList.remove('text-muted');
      ttsBtn.classList.add('text-primary', 'bg-surface2');
      ttsBtn.title = 'Auto TTS: on (click to disable)';
    } else {
      ttsBtn.classList.remove('text-primary', 'bg-surface2');
      ttsBtn.classList.add('text-muted');
      ttsBtn.title = 'Auto TTS: off (click to enable)';
    }
  }

  // --- Voice Mode ---
  function setVoiceStatus(state, detail) {
    if (!voiceStatusEl || !voiceStatusLabel) return;
    if (state === 'off') {
      voiceStatusEl.classList.add('hidden');
      return;
    }
    const states = {
      listening: { label: detail || 'Listening…', dot: 'bg-success' },
      transcribing: { label: detail || 'Transcribing…', dot: 'bg-yellow-400' },
      thinking: { label: detail || 'Waiting for Yuki…', dot: 'bg-yellow-400' },
      speaking: { label: detail || 'Speaking…', dot: 'bg-primary' },
      error: { label: detail || 'Voice error', dot: 'bg-danger' },
    };
    const s = states[state] || states.listening;
    voiceStatusLabel.textContent = s.label;
    if (voiceStatusDot) {
      voiceStatusDot.className = 'voice-status-dot w-2 h-2 rounded-full ' + s.dot + ' animate-pulse';
    }
    voiceStatusEl.classList.remove('hidden');
  }

  function updateVoiceModeVisual() {
    if (voiceMode) {
      voiceModeBtn.classList.remove('text-muted');
      voiceModeBtn.classList.add('text-primary', 'bg-surface2');
      voiceModeBtn.title = 'Voice mode: on (click to exit)';
    } else {
      voiceModeBtn.classList.remove('text-primary', 'bg-surface2');
      voiceModeBtn.classList.add('text-muted');
      voiceModeBtn.title = 'Voice mode — continuous voice conversation (Ctrl+Alt+V)';
    }
  }

  function syncVoiceMode(enabled) {
    if (enabled === voiceMode) return;
    voiceMode = enabled;
    if (voiceMode) {
      updateVoiceModeVisual();
      updateVoiceTitle();
      startVoiceListen();
    } else {
      voiceTurnInProgress = false;
      voiceListening = false;
      voiceGen++;
      if (AudioRecorder.isRecording) AudioRecorder.stopRecording();
      AudioPlayer.stop();
      setVoiceStatus('off');
      updateVoiceModeVisual();
      updateVoiceTitle();
    }
  }

  function toggleVoiceMode() {
    if (voiceMode) {
      if (voiceStartFailed) {
        voiceStartFailed = false;
        startVoiceListen();
        return;
      }
      exitVoiceMode();
    } else {
      enterVoiceMode();
    }
  }

  function enterVoiceMode() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (AudioRecorder.isRecording) AudioRecorder.stopRecording();
    AudioPlayer.stop();
    AudioPlayer.ensureUnlocked();
    voiceMode = true;
    voiceTurnInProgress = false;
    voiceGen = 0;
    ensureNotificationPermission();
    updateVoiceModeVisual();
    updateVoiceTitle();
    send('voice:toggle', { enabled: true });
    startVoiceListen();
  }

  function exitVoiceMode() {
    voiceMode = false;
    voiceTurnInProgress = false;
    voiceListening = false;
    voiceGen++;
    if (AudioRecorder.isRecording) AudioRecorder.stopRecording();
    AudioPlayer.stop();
    setVoiceStatus('off');
    updateVoiceModeVisual();
    updateVoiceTitle();
    send('voice:toggle', { enabled: false });
    console.log('[voice] mode off');
  }

  async function startVoiceListen() {
    if (!voiceMode || voiceTurnInProgress || isWaiting) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (AudioRecorder.isRecording) return;
    voiceListening = true;
    setVoiceStatus('listening');
    console.log('[voice] listening start');
    const started = await AudioRecorder.startContinuous(
      (hadVoice) => stopVoiceListen(hadVoice),
      1200,
      30000
    );
    if (!started) {
      voiceListening = false;
      voiceStartFailed = true;
      setVoiceStatus('error', 'Microphone unavailable');
      console.error('Voice mode: failed to start listening');
    } else {
      voiceStartFailed = false;
    }
  }

  async function stopVoiceListen(hadVoice) {
    if (!AudioRecorder.isRecording) return;
    const base64 = await AudioRecorder.stop();
    voiceListening = false;
    console.log(`[voice] utterance stopped hadVoice=${!!hadVoice} base64=${base64 ? Math.round(base64.length / 1024) : 0}KB`);
    if (!voiceMode) return;
    if (!hadVoice || !base64) {
      startVoiceListen();
      return;
    }
    setVoiceStatus('transcribing');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64 }),
        signal: controller.signal,
      });
      const data = await res.json();
      const text = (data.text || '').trim();
      console.log('[voice] transcription:', JSON.stringify(text.slice(0, 120)), 'error:', data.error || '');
      if (!text) {
        setVoiceStatus('listening');
        setTimeout(() => { if (voiceMode) startVoiceListen(); }, 400);
        return;
      }
      voiceTurnInProgress = true;
      appendMessage('user', text);
      send('chat:message', { message: text });
      setVoiceStatus('thinking');
      setIsWaiting(true);
    } catch (err) {
      console.error('Transcription failed:', err);
      setVoiceStatus('error', 'Transcription failed');
      setTimeout(() => { if (voiceMode) startVoiceListen(); }, 800);
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleVoiceResponse() {
    if (!voiceMode) return;
    const gen = ++voiceGen;
    if (lastAssistantMessage) {
      setVoiceStatus('speaking');
      await AudioPlayer.playSynthesized(lastAssistantMessage);
    }
    // A newer response (or exiting voice mode) supersedes this one.
    if (!voiceMode || gen !== voiceGen) return;
    if (voiceTurnInProgress || isWaiting) {
      setVoiceStatus('thinking');
    } else {
      setVoiceStatus('listening');
      startVoiceListen();
    }
  }

  function updateVoiceTitle() {
    document.title = voiceMode ? '🎤 Yuki — Voice mode' : 'Yuki';
  }

  function ensureNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default' || voiceNotifAsked) return;
    voiceNotifAsked = true;
    try { Notification.requestPermission().catch(() => {}); } catch {}
  }

  function notifyVoiceActive() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('Yuki — Voice mode', {
        body: 'Voice mode is active. Press Ctrl+Alt+V or use the tray icon to stop.',
        tag: 'yuki-voice',
      });
    } catch {}
  }

  function handleGlobalVoiceToggle() {
    const now = Date.now();
    if (now - lastVoiceGlobalToggleAt < 400) return;
    lastVoiceGlobalToggleAt = now;
    if (voiceMode) {
      exitVoiceMode();
      return;
    }
    startVoiceSessionAndMode();
  }

  async function startVoiceSessionAndMode() {
    if (voiceSessionStarting || voiceMode) return;
    voiceSessionStarting = true;
    try {
      const projRes = await fetch('/api/projects');
      const projects = await projRes.json();
      let voiceProject = (projects || []).find(p => String(p.name || '').toLowerCase() === 'voice');
      if (!voiceProject) {
        const createRes = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Voice' }),
        });
        const created = await createRes.json();
        voiceProject = { id: created.id, name: created.name };
      }
      await createSession(voiceProject.id);
      enterVoiceMode();
      if (document.hidden) notifyVoiceActive();
    } catch (err) {
      console.error('Failed to start voice session:', err);
    } finally {
      voiceSessionStarting = false;
    }
  }

  // --- Browser Panel ---
  async function toggleBrowserPanel() {
    if (browserPanelEl.classList.contains('hidden')) {
      browserPanelEl.classList.remove('hidden');
    } else {
      browserPanelEl.classList.add('hidden');
    }
  }

  async function updateBrowserScreenshot() {
    try {
      const res = await fetch('/api/browser/screenshot');
      const data = await res.json();
      if (data.screenshot) {
        browserImageEl.src = `data:image/png;base64,${data.screenshot}`;
      }
    } catch (err) {
      console.error('Browser screenshot failed:', err);
    }
  }

  // --- Image Paste ---
  function compressImage(dataUrl, maxDim = 2048, quality = 0.8) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    });
  }

  function addImagePreview(dataUrl) {
    pastedImages.push(dataUrl);

    const wrapper = document.createElement('div');
    wrapper.className = 'relative group';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.className = 'h-16 w-auto rounded-lg border border-border object-cover';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity';
    removeBtn.textContent = '×';
    removeBtn.dataset.url = dataUrl;
    removeBtn.addEventListener('click', () => {
      pastedImages = pastedImages.filter((u) => u !== dataUrl);
      wrapper.remove();
      if (pastedImages.length === 0) imagePreview.classList.add('hidden');
    });

    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);
    imagePreview.appendChild(wrapper);
    imagePreview.classList.remove('hidden');
  }

  messageInput.addEventListener('paste', (e) => {
    if (!enableImagePaste) return;

    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          const compressed = await compressImage(reader.result, 800, 0.5);
          addImagePreview(compressed);
        };
        reader.readAsDataURL(file);
      }
    }
  });

  function addFilePreview(file) {
    pastedFiles.push(file);

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center gap-2 bg-surface2 border border-border rounded-lg px-3 py-1.5 text-xs text-text';

    const icon = document.createElement('span');
    icon.textContent = '📄';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-medium max-w-[200px] truncate';
    nameSpan.textContent = file.name;

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'text-muted';
    sizeSpan.textContent = (file.size / 1024).toFixed(1) + ' KB';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'w-4 h-4 bg-danger text-white rounded-full text-[10px] flex items-center justify-center hover:bg-danger/80 transition-colors shrink-0';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      pastedFiles = pastedFiles.filter((f) => f !== file);
      wrapper.remove();
      if (pastedFiles.length === 0 && pastedImages.length === 0) imagePreview.classList.add('hidden');
    });

    wrapper.appendChild(icon);
    wrapper.appendChild(nameSpan);
    wrapper.appendChild(sizeSpan);
    wrapper.appendChild(removeBtn);
    imagePreview.appendChild(wrapper);
    imagePreview.classList.remove('hidden');
  }

  async function handleDroppedFiles(fileList) {
    for (const file of fileList) {
      if (!file) continue;
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const compressed = await compressImage(dataUrl, 800, 0.5);
          addImagePreview(compressed);
        } catch (err) {
          console.error('Failed to read image:', err);
        }
      } else {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          addFilePreview({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl });
        } catch (err) {
          console.error('Failed to read file:', err);
        }
      }
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Drag & drop any file onto the input area as context
  const dropZone = document.getElementById('input-form').parentElement;
  let dragDepth = 0;
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    dropZone.classList.add('drop-active');
  });
  dropZone.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      dropZone.classList.remove('drop-active');
    }
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove('drop-active');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      handleDroppedFiles(files);
    }
  });

  // --- Event Listeners ---
  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const message = messageInput.value.trim();
    if ((!message && pastedImages.length === 0 && pastedFiles.length === 0) || isWaiting || !ws || ws.readyState !== WebSocket.OPEN) return;

    const text = message || '(attached file)';

    thinkingBubble = null;
    thinkingWasShown = false;
    currentStreamingContent = '';
    appendMessage('user', text);

    const data = { message: text };
    if (pastedImages.length > 0) {
      data.images = pastedImages;
    }
    if (pastedFiles.length > 0) {
      data.files = pastedFiles;
    }

    send('chat:message', data);
    AudioPlayer.stop();
    messageInput.value = '';
    messageInput.style.height = 'auto';
    pastedImages = [];
    pastedFiles = [];
    imagePreview.innerHTML = '';
    imagePreview.classList.add('hidden');
    setIsWaiting(true);
  });

  newSessionBtn.addEventListener('click', () => createSession());

  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebarToggle.innerHTML = sidebar.classList.contains('collapsed') ? '&#187;' : '&#171;';
  });

  const sidebarResizer = document.getElementById('sidebar-resizer');
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 480;

  function applySidebarWidth(w) {
    sidebar.style.width = w + 'px';
    try { localStorage.setItem('yukiweb-sidebar-width', String(w)); } catch (e) {}
  }

  try {
    const saved = parseInt(localStorage.getItem('yukiweb-sidebar-width'), 10);
    if (saved && window.innerWidth >= 768 && !sidebar.classList.contains('collapsed')) {
      applySidebarWidth(Math.min(Math.max(saved, SIDEBAR_MIN), SIDEBAR_MAX));
    }
  } catch (e) {}

  sidebarResizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sidebar.classList.add('resizing');
    document.body.classList.add('resizing-sidebar');
    const startX = e.clientX;
    const startW = sidebar.getBoundingClientRect().width;
    function onMove(ev) {
      const max = Math.min(SIDEBAR_MAX, Math.round(window.innerWidth * 0.5));
      const w = Math.min(Math.max(startW + (ev.clientX - startX), SIDEBAR_MIN), max);
      applySidebarWidth(w);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      sidebar.classList.remove('resizing');
      document.body.classList.remove('resizing-sidebar');
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    sidebarBackdrop.classList.remove('hidden');
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    sidebarBackdrop.classList.add('hidden');
  }

  mobileMenuBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  });

  sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      closeMobileSidebar();
    }
  });

  micBtn.addEventListener('click', () => {
    if (voiceMode) {
      exitVoiceMode();
      return;
    }
    if (AudioRecorder.isRecording) {
      stopRecordingAndTranscribe();
    } else {
      toggleRecording();
    }
  });

  voiceModeBtn.addEventListener('click', toggleVoiceMode);

  ttsBtn.addEventListener('click', () => setAutoTTS(!autoTTS));

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      startPushToTalk();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && pushToTalk) {
      e.preventDefault();
      stopPushToTalk();
    }
  });

  window.addEventListener('blur', () => {
    if (pushToTalk) stopPushToTalk();
  });
  function handleStop() {
    send('chat:stop', {});
    AudioPlayer.stop();
    setIsWaiting(false);
    stopBtn.disabled = true;
  }
  stopBtn.addEventListener('click', handleStop);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  });

  browserGoBtn.addEventListener('click', () => {
    const url = browserUrlInput.value.trim();
    if (url) {
      send('chat:message', { message: `Navigate to ${url}` });
      messageInput.value = '';
      messageInput.style.height = 'auto';
      setIsWaiting(true);
    }
  });

  browserScreenshotBtn.addEventListener('click', updateBrowserScreenshot);
  closeBrowserBtn.addEventListener('click', () => {
    browserPanelEl.classList.add('hidden');
  });

  document.getElementById('plan-toggle').addEventListener('click', () => {
    planExpanded = !planExpanded;
    const steps = document.getElementById('plan-steps');
    const chevron = document.getElementById('plan-chevron');
    if (steps) steps.classList.toggle('hidden', !planExpanded);
    if (chevron) chevron.classList.toggle('-rotate-90', !planExpanded);
  });

  toolsBtn.addEventListener('click', () => {
    toolsModal.classList.remove('hidden');
    renderToolsUI();
  });

  thinkingBtn.addEventListener('click', () => {
    thinkingEnabled = !thinkingEnabled;
    updateThinkingBtnVisual();
    send('thinking:toggle', { enabled: thinkingEnabled });
  });

  closeToolsBtn.addEventListener('click', () => {
    toolsModal.classList.add('hidden');
  });

  toolsModal.addEventListener('click', (e) => {
    if (e.target === toolsModal) toolsModal.classList.add('hidden');
  });

  renameSaveBtn.addEventListener('click', renameSession);
  renameCancelBtn.addEventListener('click', () => {
    renameModal.classList.add('hidden');
    renameSessionId = null;
  });
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameSession();
    if (e.key === 'Escape') { renameModal.classList.add('hidden'); renameSessionId = null; }
  });
  renameModal.addEventListener('click', (e) => {
    if (e.target === renameModal) { renameModal.classList.add('hidden'); renameSessionId = null; }
  });

  // --- Session Search Modal ---
  let searchTimer = null;

  function openSearchModal() {
    searchInput.value = '';
    searchResults.innerHTML = '';
    searchModal.classList.remove('hidden');
    searchInput.focus();
  }

  function closeSearchModal() {
    searchModal.classList.add('hidden');
    searchResults.innerHTML = '';
  }

  async function runSessionSearch(query) {
    const q = query.trim();
    if (!q) {
      searchResults.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(q)}`);
      const results = await res.json();
      renderSearchResults(results);
    } catch (err) {
      console.error('Session search failed:', err);
    }
  }

  function renderSearchResults(results) {
    searchResults.innerHTML = '';
    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'px-4 py-8 text-center text-sm text-muted';
      empty.textContent = 'No sessions found';
      searchResults.appendChild(empty);
      return;
    }
    for (const r of results) {
      const el = document.createElement('div');
      el.className = 'flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-surface2 transition-colors';
      el.dataset.sessionId = r.id;
      el.addEventListener('click', () => {
        closeSearchModal();
        switchSession(r.id);
      });

      const initial = (r.title || '?').charAt(0).toUpperCase();
      const avatar = document.createElement('div');
      avatar.className = 'session-avatar w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 bg-surface2/70 text-muted';
      avatar.textContent = initial;

      const info = document.createElement('div');
      info.className = 'flex-1 min-w-0';

      const top = document.createElement('div');
      top.className = 'flex items-center justify-between gap-2';

      const titleEl = document.createElement('div');
      titleEl.className = 'truncate text-xs font-medium text-text';
      titleEl.textContent = r.title;

      const metaEl = document.createElement('div');
      metaEl.className = 'text-[10px] text-muted shrink-0';
      metaEl.textContent = new Date(r.updatedAt).toLocaleDateString() + ' · ' + r.matchCount + ' hit' + (r.matchCount === 1 ? '' : 's');

      top.appendChild(titleEl);
      top.appendChild(metaEl);

      const snippetEl = document.createElement('div');
      snippetEl.className = 'text-[11px] text-muted truncate mt-0.5';
      snippetEl.textContent = r.snippet || r.title;

      info.appendChild(top);
      info.appendChild(snippetEl);

      el.appendChild(avatar);
      el.appendChild(info);
      searchResults.appendChild(el);
    }
  }

  searchBtn.addEventListener('click', openSearchModal);
  closeSearchBtn.addEventListener('click', closeSearchModal);
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSessionSearch(e.target.value), 250);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSearchModal(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = searchResults.querySelector('[data-session-id]');
      if (first) first.click();
    }
  });
  searchModal.addEventListener('click', (e) => {
    if (e.target === searchModal) closeSearchModal();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearchModal();
    }
  });

  // --- Confirm Modal ---
  function showConfirmModal(title, message, cb) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmCallback = cb;
    confirmModal.classList.remove('hidden');
  }

  function closeConfirmModal() {
    confirmModal.classList.add('hidden');
    confirmCallback = null;
  }

  confirmCancelBtn.addEventListener('click', closeConfirmModal);
  confirmOkBtn.addEventListener('click', () => {
    const cb = confirmCallback;
    closeConfirmModal();
    if (cb) cb();
  });
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirmModal();
  });

  // --- Add Project Modal ---
  function openAddProjectModal() {
    addProjectInput.value = '';
    addProjectSaveBtn.disabled = true;
    addProjectModal.classList.remove('hidden');
    setTimeout(() => addProjectInput.focus(), 100);
  }

  function closeAddProjectModal() {
    addProjectModal.classList.add('hidden');
  }

  addProjectBtn.addEventListener('click', openAddProjectModal);
  addProjectCancelBtn.addEventListener('click', closeAddProjectModal);
  addProjectInput.addEventListener('input', () => {
    addProjectSaveBtn.disabled = !addProjectInput.value.trim();
  });
  addProjectInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addProjectSaveBtn.click();
    if (e.key === 'Escape') closeAddProjectModal();
  });
  addProjectSaveBtn.addEventListener('click', async () => {
    const name = addProjectInput.value.trim();
    if (!name) return;
    closeAddProjectModal();
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      loadTree();
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  });
  addProjectModal.addEventListener('click', (e) => {
    if (e.target === addProjectModal) closeAddProjectModal();
  });

  async function deleteProject(projectId) {
    try {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (activeProjectId === projectId) {
        activeProjectId = 'default';
        send('project:switch', { projectId: 'default' });
      }
      loadTree();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }

  // --- Rename Modal wiring ---
  renameSaveBtn.addEventListener('click', renameSession);
  renameCancelBtn.addEventListener('click', () => {
    renameModal.classList.add('hidden');
    renameSessionId = null;
  });
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameSession();
    if (e.key === 'Escape') { renameModal.classList.add('hidden'); renameSessionId = null; }
  });
  renameModal.addEventListener('click', (e) => {
    if (e.target === renameModal) { renameModal.classList.add('hidden'); renameSessionId = null; }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (isWaiting || AudioPlayer.isPlaying)) {
      e.preventDefault();
      AudioPlayer.stop();
      if (isWaiting) {
        handleStop();
      }
    }
    if (e.ctrlKey && e.key === 'm') {
      e.preventDefault();
      if (voiceMode) {
        exitVoiceMode();
      } else {
        micBtn.click();
      }
    }
    if (e.ctrlKey && e.altKey && e.code === 'KeyV') {
      e.preventDefault();
      handleGlobalVoiceToggle();
    }
  });

  // Notify when voice mode is active and the UI is not focused
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && voiceMode) notifyVoiceActive();
  });
  window.addEventListener('blur', () => {
    if (voiceMode) notifyVoiceActive();
  });

  // Start
  initTree();
  connect();
})();
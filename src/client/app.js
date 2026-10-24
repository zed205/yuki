(function () {
  // DOM elements
  const messagesEl = document.getElementById('messages');
  const inputForm = document.getElementById('input-form');
  const messageInput = document.getElementById('message-input');
  const imagePreview = document.getElementById('image-preview');
  const sendBtn = document.getElementById('send-btn');
  const statusEl = document.getElementById('status');
  const sessionTreeEl = document.getElementById('session-tree');
  const addProjectBtn = document.getElementById('add-project-btn');
  const optionsMenuBtn = document.getElementById('options-menu-btn');
  const optionsMenu = document.getElementById('options-menu');
  const optionsVoiceModeBtn = document.getElementById('options-voice-mode-btn');
  const optionsMicBtn = document.getElementById('options-mic-btn');
  const optionsTtsBtn = document.getElementById('options-tts-btn');
  const optionsThinkingBtn = document.getElementById('options-thinking-btn');
  const optionsToolsBtn = document.getElementById('options-tools-btn');
  const optionsCompactBtn = document.getElementById('options-compact-btn');
  const compactIndicator = document.getElementById('compact-indicator');
  const voiceModeIndicator = document.getElementById('voice-mode-indicator');
  const micIndicator = document.getElementById('mic-indicator');
  const ttsIndicator = document.getElementById('tts-indicator');
  const voiceStatusEl = document.getElementById('voice-status');
  const voiceStatusDot = document.getElementById('voice-status-dot');
  const voiceStatusLabel = document.getElementById('voice-status-label');
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
  const renameModalTitle = document.getElementById('rename-modal-title');
  const renameError = document.getElementById('rename-error');
  const renamePathWrap = document.getElementById('rename-path-wrap');
  const renamePathInput = document.getElementById('rename-path-input');
  const renamePathBrowseBtn = document.getElementById('rename-path-browse-btn');
  const renameCancelBtn = document.getElementById('rename-cancel-btn');
  const renameSaveBtn = document.getElementById('rename-save-btn');
  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
  const confirmOkBtn = document.getElementById('confirm-ok-btn');
  const addProjectModal = document.getElementById('add-project-modal');
  const addProjectInput = document.getElementById('add-project-input');
  const addProjectPathWrap = document.getElementById('add-project-path-wrap');
  const addProjectPathInput = document.getElementById('add-project-path-input');
  const addProjectPathBrowseBtn = document.getElementById('add-project-path-browse-btn');
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
  let pendingCompactionRefresh = false;
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
  let collapseTT = true;
  let ttGroup = null;
  let enableImagePaste = false;
  let connectedConfig = {};
  // Stores auto-generated summaries per session
  const sessionSummaries = new Map();

  // voice mode state
  let voiceMode = false;
  let voiceListening = false;
  let voiceTurnInProgress = false;
  let voiceStartFailed = false;
  let voiceGen = 0;
  let lastVoiceGlobalToggleAt = 0;
  let voiceSessionStarting = false;
  let voiceNotifAsked = false;
  let voiceDropdownOpen = false;

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
    
    // Update top bar context circle (mobile)
    const circle = document.getElementById('topbar-context-circle');
    const circleText = document.getElementById('topbar-context-text');
    if (circle) {
      // Circumference = 2 * PI * r = 2 * PI * 15.915 ≈ 100
      circle.setAttribute('stroke-dasharray', `${pct} 100`);
      // Change color based on usage
      if (pct > 90) circle.setAttribute('stroke', '#f85149'); // red
      else if (pct > 70) circle.setAttribute('stroke', '#f0883e'); // orange
      else circle.setAttribute('stroke', '#58a6ff'); // blue
    }
    if (circleText) {
      circleText.textContent = pct + '%';
    }
  }

  function updateThinkingBtnVisual() {
    if (thinkingEnabled) {
      if (thinkingBtn) {
        thinkingBtn.className = 'p-2 rounded-lg text-yellow-400 hover:text-yellow-300 hover:bg-surface2 transition-colors';
        thinkingBtn.title = 'Thinking enabled — click to disable';
      }
      const ind = document.getElementById('thinking-indicator');
      if (ind) {
        ind.textContent = 'On';
        ind.className = 'text-xs text-primary';
      }
    } else {
      if (thinkingBtn) {
        thinkingBtn.className = 'p-2 rounded-lg text-muted/50 hover:text-muted hover:bg-surface2 transition-colors';
        thinkingBtn.title = 'Thinking disabled — click to enable';
      }
      const ind = document.getElementById('thinking-indicator');
      if (ind) {
        ind.textContent = 'Off';
        ind.className = 'text-xs text-muted';
      }
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
        collapseTT = connectedConfig.collapseThinkingTools !== false;
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

      case 'session:summary':
        sessionSummaries.set(data.data.sessionId, data.data.summary);
        if (data.data.sessionId === currentSessionId) {
          loadTree();
        }
        break;

      case 'plan:updated':
        updatePlanBar(data.data.plan);
        break;

      case 'observer:feedback':
        showObserverFeedback(data.data.feedback, data.data.sessionId);
        break;

      case 'message:reverted':
        messageInput.value = data.data.text;
        messageInput.dispatchEvent(new Event('input'));
        setTimeout(() => messageInput.focus(), 0);
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

      case 'context:compacted':
        if (compactIndicator) compactIndicator.textContent = 'Done';
        // Refresh the transcript so the freshly-written summary shows up in history.
        // If the model is mid-turn, defer until it finishes (see setIsWaiting).
        if (currentSessionId) {
          if (!isWaiting) {
            loadSessionMessages(currentSessionId);
          } else {
            pendingCompactionRefresh = true;
          }
        }
        setTimeout(() => { if (compactIndicator && !isWaiting) compactIndicator.textContent = 'Ready'; }, 3000);
        break;

      case 'context:compact-failed':
        console.log('[Compaction] Failed:', data.data.reason);
        if (compactIndicator) compactIndicator.textContent = 'Failed';
        setTimeout(() => { if (compactIndicator && !isWaiting) compactIndicator.textContent = 'Ready'; }, 3000);
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

    if (!addToTTGroup(wrapper, 'Thinking…')) {
      messagesEl.appendChild(wrapper);
    }

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
    if (ttGroup && ttGroup.lastEl === thinkingBubble.wrapper) {
      updateTTGroupSummary(ttGroup, 'Thought');
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

  // --- Collapsible thinking/tool-use groups ---
  // When collapseTT is enabled, thinking bubbles and tool call bubbles created
  // between a user prompt and an assistant response are collected into a single
  // container that shows only the latest operation summary on one line. Clicking
  // the line expands the full history; clicking again collapses it.
  function createTTGroup() {
    const el = document.createElement('div');
    el.className = 'flex justify-start tt-group';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'tt-group-header flex items-center gap-2 px-3 py-1.5 rounded-full border border-dashed border-border text-xs text-muted hover:text-text hover:bg-surface2/50 hover:border-primary/40 transition-colors cursor-pointer text-left';

    const arrow = document.createElement('span');
    arrow.className = 'text-[10px] text-muted shrink-0';
    arrow.textContent = '▶';

    const icon = document.createElement('span');
    icon.className = 'shrink-0';
    icon.textContent = '⚙';

    const label = document.createElement('span');
    label.className = 'truncate min-w-0';
    label.textContent = '…';

    header.appendChild(arrow);
    header.appendChild(icon);
    header.appendChild(label);

    const body = document.createElement('div');
    body.className = 'tt-group-body hidden flex flex-col gap-2 mt-2 w-full max-w-[90%]';

    el.appendChild(header);
    el.appendChild(body);

    const group = { el, header, body, arrow, icon, label, lastEl: null, count: 0, sealed: false };
    header.addEventListener('click', () => toggleTTGroup(group));
    return group;
  }

  function toggleTTGroup(group) {
    const isCollapsed = group.body.classList.contains('hidden');
    if (isCollapsed) {
      group.body.classList.remove('hidden');
      group.arrow.textContent = '▼';
      group.header.title = 'Collapse thinking/tool history';
      renderTTIconTrail(group);
    } else {
      group.body.classList.add('hidden');
      group.arrow.textContent = '▶';
      group.header.title = 'Expand thinking/tool history';
      scrollToBottom();
    }
  }

  // Render just the most recent operation's icon, so the collapsed summary
  // stays a single short line even with lots of autonomous activity. The full
  // icon history is still visible when the group is expanded.
  function renderTTIconTrail(group) {
    let lastIcon = '';
    for (const child of group.body.children) {
      if (child.classList.contains('thinking-wrapper')) lastIcon = '🧠';
      else if (child.classList.contains('tool-call-wrapper')) lastIcon = '⚙';
    }
    group.icon.textContent = lastIcon;
  }

  function updateTTGroupSummary(group, text) {
    group.label.textContent = text;
  }

  function addToTTGroup(item, summary) {
    if (!collapseTT) return false;
    let g = ttGroup && !ttGroup.sealed ? ttGroup : null;
    if (!g) {
      g = createTTGroup();
      ttGroup = g;
      messagesEl.appendChild(g.el);
    }
    g.body.appendChild(item);
    g.lastEl = item;
    g.count++;
    g.label.textContent = summary;
    scrollToBottom();
    return true;
  }

  function sealTTGroup() {
    if (ttGroup && !ttGroup.sealed) {
      ttGroup.sealed = true;
    }
  }

  function resetTTGroup() {
    ttGroup = null;
  }

  // If `item` is the latest operation in an open group, refresh the single-line
  // summary so it always reflects the most recent state.
  function refreshTTGroupSummary(item) {
    if (!ttGroup || !item || ttGroup.lastEl !== item) return;
    if (item.classList.contains('tool-call-wrapper')) {
      const nameEl = item.querySelector('.font-mono.text-primary');
      const statusEl = item.querySelector('.tool-status');
      if (nameEl) {
        const status = statusEl ? statusEl.textContent : '';
        updateTTGroupSummary(ttGroup, `${nameEl.textContent} ${status}`);
      }
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

  function appendMessage(role, content, messageId, compacted) {
    const msgEl = document.createElement('div');
    msgEl.dataset.messageId = messageId || '';
    if (compacted) msgEl.dataset.compacted = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'relative group';

    if (role === 'user') {
      resetTTGroup();
      msgEl.className = 'flex justify-end';
      const bubble = document.createElement('div');
      bubble.className = (compacted ? 'opacity-40 ' : '') + 'bg-userMsg rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed';

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
        { label: 'Compact', action: () => { send('context:compact', {}); } },
      ]);
      wrapper.appendChild(menuEl);

      msgEl.appendChild(wrapper);
    } else {
      sealTTGroup();
      msgEl.className = 'flex justify-start';
      const bubble = document.createElement('div');
      bubble.className = (compacted ? 'opacity-40 ' : '') + 'bg-asstMsg border border-border rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed';

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

  const SUMMARY_PREFIX = 'Summary of previous conversation:';

  function isSummaryMessage(msg) {
    return msg && msg.role === 'system' && typeof msg.content === 'string' && msg.content.startsWith(SUMMARY_PREFIX);
  }

  function appendSummaryMessage(content) {
    const el = document.createElement('div');
    el.className = 'flex justify-start my-2';

    const details = document.createElement('details');
    details.className = 'summary-card max-w-[85%] bg-summaryBg border border-summaryBorder rounded-xl text-sm group';
    details.open = false; // collapsed by default, like other bubbles

    const summary = document.createElement('summary');
    summary.className = 'flex items-center gap-2 px-4 py-2.5 cursor-pointer text-text rounded-xl list-none select-none';

    const arrow = document.createElement('span');
    arrow.className = 'text-muted transition-transform group-open:rotate-90 text-[10px]';
    arrow.textContent = '▶';

    const label = document.createElement('span');
    label.className = 'text-sm leading-relaxed text-text';
    label.textContent = 'Compaction';

    summary.appendChild(arrow);
    summary.appendChild(label);

    const body = document.createElement('div');
    body.className = 'whitespace-pre-wrap break-words leading-relaxed px-4 pb-2.5 pt-1 text-muted border-t border-summaryBorder/50';
    body.textContent = content.slice(SUMMARY_PREFIX.length).replace(/^\n/, '');

    details.appendChild(summary);
    details.appendChild(body);

    el.appendChild(details);
    messagesEl.appendChild(el);
    scrollToBottom();
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

    if (!addToTTGroup(wrapper, `⚙ ${toolCall.name}`)) {
      messagesEl.appendChild(wrapper);
    }
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
      const wrapper = el.closest('.tool-call-wrapper');
      if (wrapper) refreshTTGroupSummary(wrapper);
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

  /** Display observer feedback as a distinct collapsible block in the chat. */
  function showObserverFeedback(feedback, sessionId) {
    if (!feedback || (!feedback.concern && !feedback.suggestion)) return;

    const details = document.createElement('details');
    details.className = 'bg-amber-950/20 border border-amber-700/40 rounded-lg text-sm group font-sans w-full min-w-0';
    details.id = 'observer-' + sessionId + '-' + Date.now();
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'flex items-center gap-2 px-3 py-2 cursor-pointer text-xs hover:bg-amber-900/20 rounded-lg list-none overflow-hidden';

    const arrow = document.createElement('span');
    arrow.className = 'text-amber-400 transition-transform group-open:rotate-90 text-[10px] shrink-0';
    arrow.innerHTML = '\u25B6';

    const icon = document.createElement('span');
    icon.className = 'shrink-0 text-amber-400';
    icon.textContent = '\u26A0';

    const label = document.createElement('span');
    label.className = 'font-medium text-amber-300 shrink-0';
    label.textContent = 'Observer';

    const statusSpan = document.createElement('span');
    const statusColors = {
      on_track: 'text-green-400',
      drifting: 'text-yellow-400',
      stuck: 'text-orange-400',
      off_track: 'text-red-400',
      complete: 'text-green-400',
    };
    const color = statusColors[feedback.status] || 'text-muted';
    statusSpan.className = 'ml-auto text-xs ' + color + ' font-medium shrink-0 capitalize';
    statusSpan.textContent = feedback.status.replace(/_/g, ' ');

    summary.appendChild(arrow);
    summary.appendChild(icon);
    summary.appendChild(label);
    summary.appendChild(statusSpan);

    const body = document.createElement('div');
    body.className = 'px-3 pb-2 pt-1';

    if (feedback.concern) {
      const concernP = document.createElement('p');
      concernP.className = 'text-amber-200/80 text-xs mb-1';
      concernP.innerHTML = '<span class="text-amber-400 font-medium">Concern:</span> ' + escapeHtml(feedback.concern);
      body.appendChild(concernP);
    }

    if (feedback.suggestion) {
      const suggP = document.createElement('p');
      suggP.className = 'text-amber-200/80 text-xs';
      suggP.innerHTML = '<span class="text-amber-400 font-medium">Suggestion:</span> ' + escapeHtml(feedback.suggestion);
      body.appendChild(suggP);
    }

    details.appendChild(summary);
    details.appendChild(body);

    const wrapper = document.createElement('div');
    wrapper.className = 'flex justify-start observer-feedback-wrapper max-w-[85%] my-1';
    wrapper.appendChild(details);

    messagesEl.appendChild(wrapper);
    scrollToBottom();
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
      const wrapper = el.closest('.tool-call-wrapper');
      if (wrapper) refreshTTGroupSummary(wrapper);
    }
  }

function scrollToBottom() {
  scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

  function setIsWaiting(waiting) {
    isWaiting = waiting;
    if (sendBtn) sendBtn.disabled = waiting;
    if (messageInput) messageInput.disabled = waiting;
    if (stopBtn) stopBtn.disabled = !waiting;
    if (optionsCompactBtn) optionsCompactBtn.disabled = waiting;
    if (compactIndicator) compactIndicator.textContent = waiting ? 'Busy' : 'Ready';

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

    // If a compaction happened while the model was busy, refresh now that we are idle.
    if (!waiting && wasWaiting && pendingCompactionRefresh) {
      pendingCompactionRefresh = false;
      if (currentSessionId) {
        loadSessionMessages(currentSessionId);
      }
    }
  }

  function clearChatDisplay() {
    messagesEl.innerHTML = '';
    lastAssistantMessage = '';
    lastAssistantBubble = null;
    thinkingBubble = null;
    thinkingWasShown = false;
    ttGroup = null;
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
    const summary = s.summary || sessionSummaries.get(s.id) || '';
    let html = '<span class="tree-session">' +
      '<span class="tree-node-title">' + esc(title) + '</span>';
    if (summary) {
      html += '<span class="tree-node-summary">' + esc(summary) + '</span>';
    }
    html += '<span class="tree-node-meta">' + (s.messageCount || 0) + '</span>' +
      '<button type="button" class="tree-menu-btn" data-kind="session" data-id="' + s.id + '">&#183;&#183;&#183;</button>' +
    '</span>';
    return html;
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
        title: p.name,
        state: { opened: false },
        data: { kind: 'project', projectId: p.id, name: p.name },
      });
      for (const s of (p.sessions || [])) {
        nodes.push({
          id: 'sess-' + s.id,
          parent: 'proj-' + p.id,
          text: sessionNodeHtml(s),
          title: s.title || 'Session',
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
      addMenuItem('Modify Project', () => {
        const node = treeInstance.get_node('proj-' + id);
        showRenameModal('project', id, (node && node.data && node.data.name) || '', (node && node.data && node.data.path) || '');
      });
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
        showRenameModal('session', id, (node && node.data && node.data.title) || '');
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

  let renameTarget = null; // { kind: 'session' | 'project', id }

  function hideRenameError() {
    renameError.textContent = '';
    renameError.classList.add('hidden');
  }

  function closeRenameModal() {
    renameModal.classList.add('hidden');
    renameTarget = null;
    renamePathInput.value = '';
    hideRenameError();
  }

  function showRenameModal(kind, id, currentValue, currentPath) {
    renameTarget = { kind, id };
    renameInput.value = currentValue || '';
    renameModalTitle.textContent = kind === 'project' ? 'Modify Project' : 'Rename Session';
    renameInput.placeholder = kind === 'project' ? 'Project name' : 'Session name';
    if (kind === 'project') {
      renamePathWrap.classList.remove('hidden');
      renamePathInput.value = currentPath || '';
      renamePathInput.placeholder = 'Directory (leave empty to keep current)';
    } else {
      renamePathWrap.classList.add('hidden');
      renamePathInput.value = '';
    }
    hideRenameError();
    renameModal.classList.remove('hidden');
    setTimeout(() => renameInput.focus(), 100);
  }

  async function submitRename() {
    if (!renameTarget) return;
    const value = renameInput.value.trim();
    if (!value) return;
    if (renameTarget.kind === 'session') {
      send('session:rename', { sessionId: renameTarget.id, title: value });
      closeRenameModal();
    } else {
      try {
        const res = await fetch(`/api/projects/${renameTarget.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: value, path: renamePathInput.value.trim() || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to rename project');
        closeRenameModal();
        loadTree();
      } catch (err) {
        renameError.textContent = err.message || 'Failed to rename project';
        renameError.classList.remove('hidden');
      }
    }
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
        if (isSummaryMessage(msg)) {
          appendSummaryMessage(msg.content);
          continue;
        }
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
            appendMessage(msg.role, msg.content, msg.id, msg.compacted);
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
      updateMicIndicator('Idle');
      return;
    }

    const started = await AudioRecorder.start();
    if (!started) {
      appendMessage('assistant', 'Could not access microphone. Please check permissions.');
      return;
    }

    updateMicIndicator('Recording...');
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
    updateMicIndicator('Push-to-talk');
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
    updateMicIndicator('Idle');
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

  function updateMicIndicator(state) {
    if (!micIndicator) return;
    if (state === 'Recording...' || state === 'Push-to-talk') {
      micIndicator.textContent = state;
      micIndicator.className = 'text-xs text-danger';
      optionsMicBtn.classList.add('menu-item-active');
    } else {
      micIndicator.textContent = state || 'Idle';
      micIndicator.className = 'text-xs text-muted';
      optionsMicBtn.classList.remove('menu-item-active');
    }
  }

  function setAutoTTS(on) {
    autoTTS = on;
    if (ttsIndicator) {
      ttsIndicator.textContent = on ? 'On' : 'Off';
      ttsIndicator.className = on ? 'text-xs text-primary' : 'text-xs text-muted';
    }
    if (on) {
      optionsTtsBtn.classList.add('menu-item-active');
    } else {
      optionsTtsBtn.classList.remove('menu-item-active');
    }
    optionsTtsBtn.title = on ? 'Auto TTS: on (click to disable)' : 'Toggle auto TTS';
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
      optionsVoiceModeBtn.classList.add('menu-item-active');
      voiceModeIndicator.textContent = 'On';
      voiceModeIndicator.className = 'text-xs text-primary';
      optionsMenuBtn.classList.add('text-primary');
    } else {
      optionsVoiceModeBtn.classList.remove('menu-item-active');
      voiceModeIndicator.textContent = 'Off';
      voiceModeIndicator.className = 'text-xs text-muted';
      optionsMenuBtn.classList.remove('text-primary');
    }
    optionsMenuBtn.title = voiceMode ? 'Voice mode: on (click to exit)' : 'Voice options';
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


  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarClose = document.getElementById('sidebar-close');
  const topbarMenuBtn = document.getElementById('topbar-menu-btn');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebarToggle.innerHTML = sidebar.classList.contains('collapsed') ? '&#187;' : '&#171;';
    try { localStorage.setItem('yukiweb-sidebar-collapsed', String(sidebar.classList.contains('collapsed'))); } catch (e) {}
  });

  // Restore collapsed state from localStorage
  try {
    if (localStorage.getItem('yukiweb-sidebar-collapsed') === 'true') {
      sidebar.classList.add('collapsed');
      sidebarToggle.innerHTML = '&#187;';
    }
  } catch (e) {}

  sidebarClose.addEventListener('click', () => {
    if (window.innerWidth < 768) {
      closeMobileSidebar();
    } else {
      sidebar.classList.toggle('collapsed');
      sidebarToggle.innerHTML = sidebar.classList.contains('collapsed') ? '&#187;' : '&#171;';
      try { localStorage.setItem('yukiweb-sidebar-collapsed', String(sidebar.classList.contains('collapsed'))); } catch (e) {}
    }
  });

  // --- Collapsed sidebar tooltips ---
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'jstree-item-tooltip';
  document.body.appendChild(tooltipEl);

  function showTooltip(text, x, y) {
    if (!text) { tooltipEl.style.display = 'none'; return; }
    tooltipEl.textContent = text;
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = (x + 12) + 'px';
    tooltipEl.style.top = (y - 10) + 'px';
    tooltipEl.style.opacity = '1';
  }

  function hideTooltip() {
    tooltipEl.style.opacity = '0';
    setTimeout(() => { tooltipEl.style.display = 'none'; }, 150);
  }

  // Delegate hover events for jstree anchors
  sessionTreeEl.addEventListener('mouseenter', (e) => {
    if (!sidebar.classList.contains('collapsed')) return;
    const anchor = e.target.closest('.jstree-anchor');
    if (!anchor) return;
    const title = anchor.getAttribute('title') || anchor.textContent.trim();
    const rect = anchor.getBoundingClientRect();
    showTooltip(title, rect.right, rect.top);
  });

  sessionTreeEl.addEventListener('mousemove', (e) => {
    if (!sidebar.classList.contains('collapsed')) return;
    const anchor = e.target.closest('.jstree-anchor');
    if (!anchor) return;
    const title = anchor.getAttribute('title') || anchor.textContent.trim();
    showTooltip(title, e.clientX, e.clientY);
  });

  sessionTreeEl.addEventListener('mouseleave', () => {
    if (tooltipEl.style.display === 'block') hideTooltip();
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

  if (topbarMenuBtn) topbarMenuBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
    } else {
      // If collapsed, expand first then open
      if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        sidebarToggle.innerHTML = '&#171;';
        try { localStorage.removeItem('yukiweb-sidebar-collapsed'); } catch (e) {}
      }
      openMobileSidebar();
    }
  });

  sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  window.addEventListener('resize', () => {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      // When entering mobile: if sidebar was collapsed on desktop, keep it collapsed
      // and close any mobile-open state
      if (sidebar.classList.contains('collapsed')) {
        closeMobileSidebar();
      }
    } else {
      // When entering desktop: close mobile sidebar but preserve collapsed state
      closeMobileSidebar();
    }
  });

  // --- Options Menu ---
  let optionsMenuOpen = false;
  function toggleOptionsMenu(open) {
    if (typeof open === 'boolean') {
      optionsMenuOpen = open;
      optionsMenu.style.setProperty('display', open ? 'block' : 'none', 'important');
      if (open) {
        optionsMenu.classList.add('show');
      } else {
        optionsMenu.classList.remove('show');
      }
    } else {
      optionsMenuOpen = !optionsMenuOpen;
      optionsMenu.style.setProperty('display', optionsMenuOpen ? 'block' : 'none', 'important');
    }
  }

  optionsMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOptionsMenu();
  });

  optionsVoiceModeBtn.addEventListener('click', () => {
    toggleOptionsMenu(false);
    toggleVoiceMode();
  });

  optionsMicBtn.addEventListener('click', () => {
    toggleOptionsMenu(false);
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

  optionsTtsBtn.addEventListener('click', () => {
    toggleOptionsMenu(false);
    setAutoTTS(!autoTTS);
  });

  optionsThinkingBtn.addEventListener('click', () => {
    toggleOptionsMenu(false);
    toggleThinking();
  });

  optionsToolsBtn.addEventListener('click', () => {
    toggleOptionsMenu(false);
    toggleTools();
  });

  if (optionsCompactBtn) {
    optionsCompactBtn.addEventListener('click', () => {
      if (!isWaiting) {
        toggleOptionsMenu(false);
        send('context:compact', {});
      }
    });
  }

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (optionsMenu && optionsMenuOpen &&
        !optionsMenu.contains(e.target) && !optionsMenuBtn.contains(e.target)) {
      toggleOptionsMenu(false);
    }
  });

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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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

  if (toolsBtn) toolsBtn.addEventListener('click', () => {
    toolsModal.classList.remove('hidden');
    renderToolsUI();
  });

  if (thinkingBtn) thinkingBtn.addEventListener('click', () => {
    toggleThinking();
  });

  closeToolsBtn.addEventListener('click', () => {
    toolsModal.classList.add('hidden');
  });

  toolsModal.addEventListener('click', (e) => {
    if (e.target === toolsModal) toolsModal.classList.add('hidden');
  });

  // --- Thinking & Tools toggle functions ---
  function toggleThinking() {
    thinkingEnabled = !thinkingEnabled;
    updateThinkingBtnVisual();
    send('thinking:toggle', { enabled: thinkingEnabled });
  }

  function toggleTools() {
    toolsModal.classList.remove('hidden');
    renderToolsUI();
  }

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
    addProjectPathInput.value = '';
    addProjectSaveBtn.disabled = true;
    addProjectPathWrap.classList.remove('hidden');
    addProjectModal.classList.remove('hidden');
    setTimeout(() => addProjectInput.focus(), 100);
  }

  function closeAddProjectModal() {
    addProjectPathWrap.classList.add('hidden');
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
    const path = addProjectPathInput.value.trim() || undefined;
    closeAddProjectModal();
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path }),
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
  renameSaveBtn.addEventListener('click', submitRename);
  renameCancelBtn.addEventListener('click', () => {
    closeRenameModal();
  });
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitRename();
    if (e.key === 'Escape') closeRenameModal();
  });
  renameModal.addEventListener('click', (e) => {
    if (e.target === renameModal) closeRenameModal();
  });

  // Rename path browse button
  if (renamePathBrowseBtn) {
    renamePathBrowseBtn.addEventListener('click', async () => {
      try {
        // Try showDirectoryPicker first (Chrome/Edge 86+)
        if (window.showDirectoryPicker) {
          const dirHandle = await window.showDirectoryPicker({ mode: 'readonly' });
          renamePathInput.value = dirHandle.path || dirHandle.name;
          return;
        }
        // Fallback: use hidden file input with webkitdirectory
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        input.mozdirectory = true;
        input.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length > 0) {
            // Get the first file's path and extract the directory name
            const firstFile = e.target.files[0];
            const fullPath = firstFile.webkitRelativePath || firstFile.name;
            const dirName = fullPath.split('/')[0];
            renamePathInput.value = dirName;
          }
          input.remove();
        });
        input.click();
      } catch (err) {
        console.error('Directory picker error:', err.message || err);
      }
    });
  }

  // Add project path browse button
  if (addProjectPathBrowseBtn) {
    addProjectPathBrowseBtn.addEventListener('click', async () => {
      try {
        // Try showDirectoryPicker first (Chrome/Edge 86+)
        if (window.showDirectoryPicker) {
          const dirHandle = await window.showDirectoryPicker({ mode: 'readonly' });
          addProjectPathInput.value = dirHandle.path || dirHandle.name;
          return;
        }
        // Fallback: use hidden file input with webkitdirectory
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        input.mozdirectory = true;
        input.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length > 0) {
            // Get the first file's path and extract the directory name
            const firstFile = e.target.files[0];
            const fullPath = firstFile.webkitRelativePath || firstFile.name;
            const dirName = fullPath.split('/')[0];
            addProjectPathInput.value = dirName;
          }
          input.remove();
        });
        input.click();
      } catch (err) {
        console.error('Directory picker error:', err.message || err);
      }
    });
  }

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
        micMenuItem.click();
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
  setIsWaiting(false);
})();
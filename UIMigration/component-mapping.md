# Component Mapping: Current YUi → New @opencode/ui

This document maps every UI element in the current YUi (src/client/app.js + styles.css) to its replacement in the new SolidJS + @opencode/ui architecture.

---

## DOM Element Mapping

### Main Layout Structure

| Current (app.js/CSS) | New (SolidJS) | Component File |
|---|---|---|
| `<body>` with flex layout | `<App />` → `<MainLayout />` | `src/App.tsx` → `src/components/Layout/MainLayout.tsx` |
| `<div id="sidebar-backdrop">` | `<Box class="backdrop">` in `Sidebar.tsx` | `src/components/Sidebar/Sidebar.tsx` |
| `<div id="sidebar">` | `<aside>` with `Box` | `src/components/Sidebar/Sidebar.tsx` |
| `<div id="main">` | `<main>` with `Box` | `src/components/Layout/MainLayout.tsx` |
| `<div id="messages">` | `<ChatPanel />` | `src/components/Chat/ChatPanel.tsx` |
| `<div id="input-container">` | `<Composer />` | `src/components/Chat/Composer.tsx` |
| `<div id="status">` | Status text in `MainLayout` | `src/components/Layout/MainLayout.tsx` |

---

### Chat Messages

| Current HTML Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `div.chat-message` with `.user` class | `<MessageBubble role="user">` | `Box`, `Text` | User message styling |
| `div.chat-message` with `.assistant` class | `<MessageBubble role="assistant">` | `Box`, `Text` | Assistant message styling |
| `div.chat-message` with `.summary` class | `<SummaryBubble />` | `Box`, `Badge`, `Text` | Compaction summary |
| `div.chat-message` with `.agent` class | `<AgentBubble />` | `Box`, `Badge`, `Text` | Sub-agent message |
| `<div class="code-block">` | `<CodeBlock />` | `Code`, `LineNumbers`, `Diff` | Syntax highlighting |
| `<span class="streaming-cursor">` | Streaming indicator in MessageBubble | `ActivityRing` | Blinking cursor |

---

### Composer / Input

| Current Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `#message-input` (textarea) | `Textarea` prop on `Composer` | `Textarea` | With Enter/Shift+Enter handling |
| `#send-btn` | `Button` in `Composer` | `Button` variant="submit" | Send message |
| `#stop-btn` | `Button` in `Composer` | `Button` variant="danger" | Stop streaming |
| `#image-preview` | `FilePreview` component | `Box` with `img` | Image attachment preview |
| `#options-menu-btn` | `IconButton` in `Sidebar` | `IconButton` | Options trigger |
| `#options-menu` | `<Box>` with conditional rendering | `Box` | Dropdown menu |

---

### Sidebar Toggles

| Current Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `#options-voice-mode-btn` | `Switch` | `Switch` | Voice mode toggle |
| `#options-mic-btn` | `Switch` | `Switch` | Mic toggle |
| `#options-tts-btn` | `Switch` | `Switch` | TTS toggle |
| `#options-thinking-btn` | `Switch` | `Switch` | Thinking toggle |
| `#options-tools-btn` | `Switch` | `Switch` | Tools toggle |
| `#options-compact-btn` | `Switch` | `Switch` | Compact mode toggle |
| `#options-notifications-btn` | `Switch` | `Switch` | Notifications toggle |

---

### Voice Indicators

| Current Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `#voice-status-dot` | `ActivityRing` | `ActivityRing` | Pulsing voice indicator |
| `#voice-status-label` | `Text` | `Text` | Status text |
| `#voice-status` | `VoicePanel` | Custom | Voice controls container |
| `#voice-status-dot` + `#mic-indicator` | Combined indicator | `ActivityRing` + `Text` | Mic status |
| `#tts-indicator` | Status indicator | `Text` | TTS status |
| `#thinking-indicator` | Thinking indicator | `ActivityRing` | Thinking state |
| `#tools-indicator` | Tool indicator | `ActivityRing` | Tool usage |

---

### Browser View

| Current Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `#browser-view` | `<BrowserView />` | Custom (iframe wrapper) | Browser iframe container |
| `#browser-url` | `TextInput` | `TextInput` | URL bar |
| `#browser-go-btn` | `Button` | `Button` | Go button |
| `#browser-screenshot-btn` | `Button icon="camera"` | `Button` | Screenshot |
| `#close-browser-btn` | `Button icon="x"` | `Button` | Close browser |
| `#browser-image` | `img` in BrowserView | `Box` with `img` | Screenshot display |

---

### Session Tree / Projects

| Current Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `#session-tree` | `<SessionTree />` | Custom tree component | Session navigation |
| `#add-project-btn` | `Button icon="plus"` | `Button` | Add project |
| Project items in sidebar | `ProjectList` items | `Box`, `Text`, `Icon` | Project entries |

---

### Modals

| Current Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `#tools-modal` | `<Dialog>` | `Dialog` size="x-large" | Tools log modal |
| `#rename-modal` | `<Dialog>` | `Dialog` size="normal" | Rename modal |
| `#rename-input` | `TextInput` | `TextInput` | Rename input |
| `#rename-path-input` | `TextInput` | `TextInput` | Path rename |
| `#rename-path-browse-btn` | `Button` | `Button` | Browse path |
| `#rename-cancel-btn` | `Button` | `Button` variant="ghost" | Cancel rename |
| `#rename-save-btn` | `Button` | `Button` variant="submit" | Save rename |
| `#confirm-modal` | `<Dialog>` | `Dialog` size="normal" | Confirm dialog |
| `#confirm-title` | `DialogTitle` | `DialogTitle` | Confirm title |
| `#confirm-message` | `DialogDescription` | `DialogDescription` | Confirm message |
| `#confirm-cancel-btn` | `Button` | `Button` variant="ghost" | Cancel |
| `#confirm-ok-btn` | `Button` | `Button` variant="submit" | Confirm |

---

### Status Indicators (Footer)

| Current Element | New Component | `@opencode/ui` Component | Notes |
|---|---|---|---|
| `#notifications-indicator` | Badge indicator | `Badge` | Notification count |
| `#compact-indicator` | Status badge | `Badge` | Compact mode indicator |
| `#voice-mode-indicator` | Status indicator | `Badge` | Voice mode indicator |
| `#mic-indicator` | Status dot | `ActivityRing` | Mic status |
| `#tts-indicator` | Status text | `Text` | TTS status |

---

## Event Handler Migration

| Current Handler (app.js) | New SolidJS Event | Component |
|---|---|---|
| `inputForm.onsubmit` | `onSubmit` prop on `Composer` | `Composer.tsx` |
| `sendBtn.onclick` | `onClick` on Send `Button` | `Composer.tsx` |
| `stopBtn.onclick` | `onClick` on Stop `Button` | `Composer.tsx` |
| `messageInput.onkeydown` | `onKeyDown` on `Textarea` | `Composer.tsx` |
| `optionsMenuBtn.onclick` | `onClick` on `IconButton` | `Sidebar.tsx` |
| `addProjectBtn.onclick` | `onClick` on `Button` | `Sidebar.tsx` |
| Browser nav buttons | `onClick` on buttons | `BrowserToolbar.tsx` |
| Modal close buttons | `onClose` prop on Dialog | Various modals |
| Toggle buttons | `onChange` on `Switch` | Sidebar toggles |
| Session tree click | `onClick` on tree items | `SessionTree.tsx` |

---

## State Variable Migration

| Current Global Variable | New SolidJS Signal | Context |
|---|---|---|
| `let messages = []` | `const [messages, setMessages] = createSignal([])` | SessionContext |
| `let isStreaming = false` | `const [isStreaming, setIsStreaming] = createSignal(false)` | SessionContext |
| `let voiceMode = false` | `const [voiceMode, setVoiceMode] = createSignal(false)` | AudioContext |
| `let mic = false` | `const [mic, setMic] = createSignal(false)` | AudioContext |
| `let tts = false` | `const [tts, setTts] = createSignal(false)` | AudioContext |
| `let thinking = false` | `const [thinking, setThinking] = createSignal(false)` | SessionContext |
| `let tools = false` | `const [tools, setTools] = createSignal(false)` | SessionContext |
| `let compact = false` | `const [compact, setCompact] = createSignal(false)` | SessionContext |
| `let notifications = false` | `const [notifications, setNotifications] = createSignal(false)` | SessionContext |
| `let sessions = {}` | `const [sessions, setSessions] = createSignal({})` | SessionContext |
| `let projects = []` | `const [projects, setProjects] = createSignal([])` | ProjectContext |
| `let currentProject` | `const [currentProject, setCurrentProject] = createSignal(null)` | ProjectContext |
| WebSocket `ws` | `const [ws, setWs] = createSignal<WebSocket | null>(null)` | WebSocketContext |
| `let browser` state | `const [browser, setBrowser] = createSignal({})` | BrowserContext |

---

## CSS Class Mapping

| Current CSS Class | Tailwind Equivalent | Notes |
|---|---|---|
| `.sidebar` | `w-64 flex flex-col border-r border-border` | Sidebar container |
| `.main-content` | `flex-1 flex flex-col` | Main area |
| `.messages-container` | `flex-1 overflow-y-auto p-4` | Scrollable messages |
| `.chat-message` | `rounded-lg p-3` | Message wrapper |
| `.user` | `bg-userMsg` | User bg color |
| `.assistant` | `bg-asstMsg` | Assistant bg color |
| `.summary` | `bg-summaryBg border-border` | Summary bg |
| `.agent` | `bg-agentBg border-agentBorder` | Agent bg |
| `.code-block` | `rounded-lg p-3 font-mono text-sm bg-surface2` | Code block |
| `.streaming-cursor` | `inline-block w-2 h-4 bg-primary animate-pulse` | Cursor blink |
| `.composer` | `p-3 border-t border-border bg-surface2` | Composer bar |
| `.modal-backdrop` | `fixed inset-0 bg-black/50 z-50` | Modal backdrop |
| `.modal-content` | `bg-surface rounded-lg shadow-xl` | Modal content |
| `.toggle` | `flex items-center gap-2` | Toggle row |
| `.indicator` | `w-2 h-2 rounded-full` | Status dot |

---

## CSS Variable Mapping

| Current CSS Variable | New CSS Variable | Notes |
|---|---|---|
| `--bg` | `--oc-color-background` or keep custom | Background |
| `--surface` | `--oc-color-surface` or keep custom | Surface |
| `--surface2` | `--oc-color-surface-2` or keep custom | Elevated surface |
| `--border` | `--oc-color-border` or keep custom | Borders |
| `--primary` | `--oc-color-primary` | Primary accent |
| `--primaryDark` | `--oc-color-primary-dark` | Primary dark variant |
| `--userMsg` | `--oc-color-user-bg` | User message bg |
| `--asstMsg` | `--oc-color-assistant-bg` | Assistant message bg |
| `--danger` | `--oc-color-danger` | Danger/error |
| `--success` | `--oc-color-success` | Success |
| `--muted` | `--oc-color-muted` | Muted text |
| `--text` | `--oc-color-text` | Primary text |

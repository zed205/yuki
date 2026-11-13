# Quick Reference: Vanilla JS → SolidJS + @opencode/ui

> **Status:** Migration complete ✅ (committed to `feat/ui-migration` branch)
>
> This guide serves as a reference for the migration patterns used. See `plan.md` for full status.

---

### Before (Vanilla JS)
```javascript
let isStreaming = false;
function updateUI() {
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (isStreaming) {
    sendBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
  } else {
    sendBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }
}
```

### After (SolidJS)
```typescript
import { createSignal } from 'solid-js';

const [isStreaming, setIsStreaming] = createSignal(false);

// JSX automatically re-renders when signal changes
<>
  <Button classList={{ hidden: isStreaming() }}>Send</Button>
  <Button classList={{ hidden: !isStreaming() }}>Stop</Button>
</>
```

---

## List Rendering

### Before
```javascript
function renderMessages(messages) {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `chat-message ${msg.role}`;
    div.innerHTML = escapeHtml(msg.content);
    container.appendChild(div);
  });
}
```

### After
```typescript
import { For } from 'solid-js';
import { MessageBubble } from '@/components/Chat/MessageBubble';

// In JSX:
<For each={messages()}>
  {(msg) => <MessageBubble role={msg.role} content={msg.content} />}
</For>
```

---

## DOM Event Handling

### Before
```javascript
document.getElementById('input-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('message-input');
  sendMessage(input.value);
  input.value = '';
});
```

### After
```typescript
// In JSX:
<Composer
  onSubmit={(text) => {
    sendMessage(text);
  }}
  isStreaming={isStreaming()}
  onStop={() => stopStreaming()}
/>
```

---

## State Management

### Before
```javascript
let sessions = {};
localStorage.setItem('sessions', JSON.stringify(sessions));
```

### After
```typescript
// SessionContext.tsx
import { createContext, useContext } from 'solid-js';

const SessionContext = createContext<{
  sessions: Signal<Map<string, Session>>;
  addSession: (s: Session) => void;
  removeSession: (id: string) => void;
}>();

export function SessionProvider(props: { children: JSX.Element }) {
  const [sessions, setSessions] = createSignal(new Map());

  onMount(() => {
    const saved = localStorage.getItem('sessions');
    if (saved) setSessions(new Map(JSON.parse(saved)));
  });

  const addSession = (session: Session) => {
    setSessions(prev => {
      const next = new Map(prev);
      next.set(session.id, session);
      return next;
    });
  };

  return (
    <SessionContext.Provider value={{ sessions, addSession, removeSession }}>
      {props.children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
```

---

## Modal / Dialog

### Before
```javascript
function openRenameModal() {
  document.getElementById('rename-modal').classList.remove('hidden');
}
function closeRenameModal() {
  document.getElementById('rename-modal').classList.add('hidden');
}
```

### After
```typescript
import { Dialog, DialogTitle, DialogBody, DialogFooter } from '@opencode/ui/dialog';
import { Button } from '@opencode/ui/button';
import { TextInput } from '@opencode/ui/text-input';

export function RenameModal() {
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Rename</Button>
      <Dialog open={open()} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Rename Project</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <TextInput placeholder="Project name" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleRename}>Save</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
```

---

## Theme Switching

### Before
```javascript
const themes = {
  dark: { '--bg': '#0d1117', '--surface': '#161b22' },
  light: { '--bg': '#ffffff', '--surface': '#f0f0f0' }
};
function applyTheme(mode) {
  const root = document.documentElement;
  Object.entries(themes[mode]).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });
}
```

### After
```typescript
import { useTheme } from '@opencode/ui/theme/context';

export function ThemeSettings() {
  const { themeId, setThemeId, colorScheme, setColorScheme } = useTheme();

  return (
    <Box>
      <Select
        value={themeId()}
        onChange={(v) => setThemeId(v)}
      >
        <Select.Option value="catppuccin-macchiato">Catppuccin Macchiato</Select.Option>
        <Select.Option value="dracula">Dracula</Select.Option>
        <Select.Option value="github">GitHub Dark</Select.Option>
        {/* ... 40+ themes ... */}
      </Select>
    </Box>
  );
}
```

---

## WebSocket Communication

### Before
```javascript
let ws;
function connect() {
  ws = new WebSocket('ws://' + location.host);
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'message') addMessage(data.message);
  };
}
```

### After
```typescript
// WebSocketContext.tsx
import { createContext, useContext } from 'solid-js';

const WebSocketContext = createContext<{
  send: (data: any) => void;
  isConnected: Signal<boolean>;
  onMessage: (handler: (data: any) => void) => void;
}>();

export function WebSocketProvider(props: { children: JSX.Element }) {
  const [isConnected, setIsConnected] = createSignal(false);

  const send = (data: any) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  };

  return (
    <WebSocketContext.Provider value={{ send, isConnected, onMessage }}>
      {props.children}
    </WebSocketContext.Provider>
  );
}
```

---

## Component Pattern

### Before
```javascript
function createMessageElement(msg) {
  const div = document.createElement('div');
  div.className = `chat-message ${msg.role}`;
  div.innerHTML = formatMessage(msg.content);
  return div;
}
```

### After
```typescript
// MessageBubble.tsx
import { splitProps } from 'solid-js';

export function MessageBubble(props: MessageBubbleProps) {
  const [local] = splitProps(props, ['role', 'content']);

  const roleClasses = {
    user: 'bg-userMsg',
    assistant: 'bg-asstMsg',
    system: 'bg-summaryBg',
  };

  return (
    <Box classList={{ [roleClasses[local.role]]: !!roleClasses[local.role] }}>
      <Text>{formatMarkdown(local.content)}</Text>
    </Box>
  );
}
```

---

## Key Takeaways

1. **Signals** replace all imperative DOM updates — just update the signal and the DOM updates automatically
2. **@opencode/ui components** replace most DOM elements — use `Box` for divs, `Button` for buttons, `Dialog` for modals
3. **Context providers** replace global variables — lift state into contexts and consume with hooks
4. **Tailwind + design tokens** replace hand-written CSS — leverage the existing `@opencode/ui` styling system
5. **Event delegation** replaces event listeners — bind events directly in JSX with `onClick`, `onSubmit`, etc.
6. **Conditional rendering** replaces class toggling — use SolidJS's conditional rendering (`{if} {show}`) instead of add/remove class

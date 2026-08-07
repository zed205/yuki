# YukiWeb - Specification

## Overview

YukiWeb is a personal AI agent application with a web-based interface, designed for speech-to-speech interaction and complex automation. The agent can drive browser interactions, control the desktop visually, perform filesystem operations, search the web, and maintain long-term memories and skills.

## Core Capabilities

### 1. Speech-to-Speech Interaction
- Real-time microphone input → STT → agent processing → TTS → speaker output
- Low-latency conversational loop using WebSocket streaming
- Configurable STT/TTS providers (local via Python subprocess, or cloud APIs via endpoint)

### 2. Browser Automation
- Playwright-based browser control under the hood
- Model-driven page interaction (clicking, form filling, navigation, data extraction)
- Screenshot and content extraction tools

### 3. Desktop Visual Automation
- Screen capture and streaming to web UI (live feed at configurable FPS)
- Computer-use agent capabilities (mouse/keyboard control via pyautogui)
- Visual reasoning — model sees the screen and decides actions

### 4. Filesystem Tools
- `read`, `write`, `edit`, `glob`, `grep` — file manipulation and search
- File editing with exact string replacement

### 5. Shell Integration
- Command execution via Node.js child_process
- Output capture and return to agent

### 6. Web Tools
- `web_search` — DEFAULT web search (DuckDuckGo HTML scrape, or Exa AI when configured)
- `web_fetch` — Fetch full page HTML, returns markdown by default; also supports raw HTML and accessibility-tree output modes
- Tool descriptions explicitly prefer web_search over web_fetch/browsernavigate for simple lookups

### 7. Memory & Skills
- **Project-Level Memories**: Persistent key-value store at `~/.config/yukiweb/memories.json`
  - `memory_save(key, value)` — store a memory across sessions
  - `memory_read(key)` — retrieve a stored memory
  - `memory_list()` — list all memory keys
  - `memory_delete(key)` — remove a memory
- **Project-Level Skills**: Reusable capabilities stored as markdown files at `~/.config/yukiweb/skills/`
  - `skill_list()` — list installed skill names
  - `skill_load(name)` — load full skill instructions
  - `skill_save(name, description, instructions)` — create/update a skill
  - `skill_delete(name)` — remove a skill

## Architecture

### Backend (Node.js)
- **Runtime:** Node.js with TypeScript compilation
- **Server:** Express for HTTP, `ws` for WebSocket real-time communication
- **Agent Core:** LLM orchestration with tool calling loop (up to 10 iterations)
- **Context Management:** Configurable sliding window with truncation at configurable threshold (default 95%), minimum turns preservation, and optional tool output pruning
- **Audio Pipeline:** Python subprocess calls for STT (Whisper) and TTS (local)
- **Automation Services:** Python scripts for desktop automation
- **Config:** JSON config file at `~/.config/yukiweb/config.json` with deep-merge of nested sections
- **System Prompt:** Read from `~/.config/yukiweb/system_prompt.txt` at startup

### Frontend (Web)
- **Single-page application — pure display layer, no agent logic**
- All orchestration (LLM calls, tool execution, context building) happens server-side
- Tailwind CSS via CDN with custom dark-theme config (bg/surface/primary/userMsg colors)
- Markdown rendering via `marked.js` CDN
- Real-time streaming of assistant responses (3-char chunks)
- Thinking bubble: collapsible `<details>` element, appears during streaming when `<think>` tags are detected or via `reasoning_content` field
- Tool calls rendered as standalone collapsible elements in message feed
- Stop button with ESC key support + AbortController for instant cancellation
- Collapsible sidebar (<< / >>) with iconified collapsed state (Yuki avatar, + button, session initial circles)
- Utility summary in sidebar: model name (last segment), endpoint host:port with HTTPS lock icon, context usage bar (estimated tokens)
- Image paste support (base64 data URLs, thumbnail preview with remove)
- Audio controls: mic toggle (STT), TTS playback of last response
- Multi-line text input (Enter to submit, Shift+Enter for newline)
- Session history, switching, and per-session delete via ··· menu

### Python Microservices (via subprocess)
- STT: `faster-whisper` or `openai-whisper` (Python warnings suppressed)
- TTS: Local TTS engine
- Desktop automation: `pyautogui`
- Screen capture: `mss`, `pyautogui.screenshot`

## Configuration

### `~/.config/yukiweb/config.json`
```json
{
  "endpoint": "http://debby:1234/v1",
  "apiKey": "",
  "model": "unsloth/Qwen3.6-27B-MTP-GGUF/Qwen3.6-27B-Q4_K_M",
  "maxTokens": 8000,
  "contextWindow": 64000,
  "exaApiKey": "",
  "stt": {
    "provider": "whisper",
    "model": "medium",
    "language": "auto"
  },
  "tts": {
    "provider": "local",
    "voice": "default"
  },
  "ui": {
    "showThinking": true,
    "showToolOutputs": true,
    "enableImagePaste": true
  },
  "desktop": {
    "enableAutomation": false,
    "screenCaptureFPS": 5
  },
  "contextManagement": {
    "enabled": true,
    "truncationThreshold": 0.95,
    "minTurns": 3,
    "toolOutputPruning": false,
    "pruningSummary": "[Tool output pruned for context optimization]"
  }
}
```

### Context Management
- `enabled` (bool, default true) — Enable/disable automatic context window management
- `truncationThreshold` (0.0–1.0, default 0.95) — Percentage of context window at which truncation triggers
- `minTurns` (int, default 3) — Minimum number of conversation turns to always retain
- `toolOutputPruning` (bool, default false) — When enabled, replaces tool result content with a short summary string
- `pruningSummary` (string) — The replacement text for pruned tool outputs

### `~/.config/yukiweb/system_prompt.txt`
Optional file for custom system prompt. Auto-created with defaults if missing.

## Project Structure

```
YukiWeb/
├── src/
│   ├── server/
│   │   ├── index.ts        # Server entry point, Express + WebSocket
│   │   ├── config.ts       # Configuration management with deep-merge
│   │   ├── agent.ts        # Agent orchestration + context management
│   │   ├── tools.ts        # 27 tool implementations + LLM tool definitions
│   │   ├── memory.ts       # Persistent key-value memory store
│   │   ├── skill.ts        # Skill file management
│   │   ├── audio.ts        # Audio pipeline (STT/TTS)
│   │   ├── automation.ts   # Desktop automation coordination
│   │   └── browser.ts      # Browser automation
│   ├── client/
│   │   ├── index.html      # Main UI (Tailwind CDN)
│   │   ├── app.js          # Frontend logic
│   │   ├── audio.js        # Audio recorder & player
│   │   └── styles.css      # Custom styling
│   └── shared/
│       └── types.ts        # Shared TypeScript types
├── python/
│   ├── stt.py              # STT service
│   ├── tts.py              # TTS service
│   ├── desktop.py          # Desktop automation service
│   └── requirements.txt
├── scripts/
│   └── copy-client.js      # Build script: copies client files to dist/
├── SPEC.md                 # This specification
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Node.js
- `express` — HTTP server
- `ws` — WebSocket support
- `playwright` — Browser automation
- `turndown` — HTML to Markdown conversion
- `nodemon` + `ts-node` — Development auto-reload

### Python
- `faster-whisper` or `openai-whisper` — STT
- `pyautogui` — Desktop automation
- `mss` — Screen capture

## WebSocket Protocol

All real-time communication uses a JSON message protocol over a single WebSocket (`ws://127.0.0.1:3210`).

### Client → Server
| Type | Data | Description |
|------|------|-------------|
| `chat:message` | `{message, images?}` | Send user message (text + optional base64 images) |
| `chat:stop` | `{}` | Cancel current agent execution |
| `session:switch` | `{sessionId}` | Switch to a different session |

### Server → Client
| Type | Data | Description |
|------|------|-------------|
| `session:connected` | `{sessionId, config}` | Initial connection handshake with session + UI config |
| `chat:message` | `{message}` | Echo of user message (client appends optimistically) |
| `chat:chunk` | `{chunk, messageId}` | Streaming 3-char chunks of assistant response |
| `chat:response` | `{message, reasoningContent?, toolCalls?, messageId}` | Complete assistant response with optional reasoning and tool calls |
| `chat:stopped` | `{}` | Agent execution was cancelled |
| `tool:call` | `{toolCall}` | A tool has started execution |
| `tool:result` | `{toolCallId, result, status}` | Tool execution result |
| `session:switched` | `{sessionId}` | Session switch confirmed |
| `session:cleared` | `{}` | Current session cleared |

## Frontend State

- **`thinkingBubble`** — Singleton DOM reference; reset to `null` at start of each new message turn
- **`currentStreamingContent`** — Accumulated streamed text; set to `''` on new message
- **`connectedConfig`** — Config object from `session:connected`; used for utility summary (model, endpoint, contextWindow)
- **`enableImagePaste`** — Controls paste handler for clipboard images

## Thinking & Reasoning

Two formats are supported for model reasoning:
1. **`reasoning_content`** field — Extracted from the API response (e.g., Gemma models), sent as `reasoningContent` in `chat:response`
2. **`<think>` tags** — Detected during streaming; thinking bubble is created on first `<think>` occurrence

Priority: streaming `<think>` bubble → `reasoningContent` → message `<think>` tags. The thinking bubble is only shown when actual reasoning content is present.

## Security Considerations

- Desktop automation requires explicit opt-in via config flag
- Local-only by default (binds to 127.0.0.1)
- No external API keys required for core functionality (local STT/TTS option)
- Exa AI integration optional via `exaApiKey` in config

## License

MIT License

## Copyright

Copyright (c) 2026 Jordan Smith

## Attribution

This project is inspired by opencode and its tooling.

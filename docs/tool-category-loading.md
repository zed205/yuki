# Tool Category Loading (On-Demand Tool Groups)

## Problem

Injecting a RAG-selected subset of tools causes the model to stop calling tools
entirely — it doesn't see the full toolbox and assumes tools are unavailable.

## Solution: `tool_load` Meta-Tool

The model itself decides when to expand its toolset, not a server-side RAG pass.

### Always-Injected Tools

These are injected on every request — the core capabilities the model needs for
nearly any task:

- `shell` — run commands
- `read` — read files
- `write` — write files
- `edit` — edit files
- `patch` — apply patches
- `glob` — find files by pattern
- `grep` — search file contents
- `web_search` — search the web
- `web_fetch` — fetch a URL
- `memory_save` / `memory_read` / `memory_list` / `memory_delete`
- `skill_list` / `skill_load`

### Loadable Tool Categories

One meta-tool (injected always) lets the model pull in categories on demand:

#### `tool_load(name)` meta-tool

| Name | Tools Injected |
|---|---|
| `browser` | `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_get_content`, `browser_get_links` |
| `desktop` | `desktop_screenshot`, `desktop_click`, `desktop_type`, `desktop_move`, `desktop_drag`, `desktop_scroll`, `desktop_keypress`, `desktop_viewport`, `desktop_snapshot_region` |
| `plan` | `plan_create`, `plan_update`, `plan_get`, `plan_remove` |
| `skills_write` | `skill_save`, `skill_delete` |

### System Prompt Wording

The system prompt lists every tool by name with a one-line description, grouped
by category, so the model knows the full capability set exists even when only
the always-injected tools + `tool_load` are currently available. Example:

```
## Available Tools

Always available:
  shell, read, write, edit, patch, glob, grep,
  web_search, web_fetch,
  memory_save, memory_read, memory_list, memory_delete,
  skill_list, skill_load

Load on demand (use tool_load to activate):
  browser  — browser_navigate, browser_click, browser_fill,
             browser_screenshot, browser_get_content, browser_get_links
  desktop  — desktop_screenshot, desktop_click, desktop_type,
             desktop_move, desktop_drag, desktop_scroll,
             desktop_keypress, desktop_viewport, desktop_snapshot_region
  plan     — plan_create, plan_update, plan_get, plan_remove
  skills_write — skill_save, skill_delete

Call tool_load("category_name") when you need one of these groups.
```

### Server Behaviour

1. On each `chat:message`, always inject the core tool definitions + `tool_load`.
2. When the model calls `tool_load("browser")`, inject all browser tool
   definitions into subsequent iterations of the same request.
3. Loaded categories persist for the remainder of the request (all iterations).
4. The `tool_load` call is consumed server-side — no result is sent to the
   model as a tool response.

### Why This Works

- The model is explicitly aware of all tools at all times via the system prompt.
- The model decides what it needs — no server-side guessing.
- Each category is a coherent subsystem; injecting partial categories doesn't
  happen.
- Works with the existing tool execution dispatch in `agent.ts:executeTool()` —
  the category definitions just need to be injected into `toolDefinitions` at
  the right point.

# Background Sub-Agents

Yuki's `spawn_agent` runs sub-agents **independently of the main turn**. The parent
gets an id immediately, keeps working, and can spawn more work as slots free up.
Reports are pushed back into the parent's context automatically.

## Lifecycle

```
parent turn ──spawn──► registry ──slot free?──► running ──► report
                         │                                  │
                         └── slots full ──► FIFO queue ─────┘
                                              │
parent next iteration ◄── inject report ◄─────┘  (or wake if idle + enabled)
```

- **`spawn_agent`** (default `background: true`) registers a job and returns
  `(id: agent_…)` immediately. `wait: true` restores the old blocking behaviour.
- **Slots** are process-wide and exclude the main agent: `subAgents.maxAgentSlots`
  children may run at once. Extra spawns enter a FIFO queue (`maxQueued`, default 8)
  and start automatically when a slot frees.
- **Delegation is one level deep**: children cannot spawn or manage agents.

## Result delivery

1. **Mid-turn (running):** at the top of every iteration, finished reports are
   injected as a `user`-role context block (`Background Sub-Agent Results`), then
   marked delivered. No polling is required.
2. **Idle, `wakeOnComplete: false` (default):** the report stays pending; it is
   injected at the start of the user's next turn. The sidebar shows a `new` badge.
3. **Idle, `wakeOnComplete: true`:** the server starts a turn in the session
   (only if a client is viewing it) so the model can report immediately. Reports
   are still injected by the normal queue, not duplicated into the prompt.

The model can also pull explicitly:

| Tool | Purpose |
|---|---|
| `agent_result(agentId, wait_ms)` | Collect one report, optionally wait (≤ 10 min) |
| `agent_list()` | Status, elapsed time, queue position, free slots |
| `agent_kill(agentId)` | Cancel a running/queued agent (also available in the UI panel) |

## Isolation guarantees

Each job owns:

- its **own `AbortController`** — stopping one agent never aborts the main turn or
  its siblings; `chat:stop` cancels everything;
- a **snapshot of `projectPath`**, so switching projects mid-run cannot redirect
  a child's file/shell operations;
- a **per-model OpenAI client** (cached), so concurrent models do not thrash one
  shared client;
- a **per-agent durable shell cwd**, so `cd` in one agent does not move another.

Shared stateful services are still serialised by mutexes: `browser_*` and
`desktop_*` calls queue behind one another because there is only one page/desktop.

## Server sizing

`--parallel` must equal `maxAgentSlots + 1` (main + children). llama.cpp splits
`-c` across slots, so each child gets roughly `contextWindow / (1 + maxAgentSlots)`
unless `subAgents.perSlotContextTokens` is set. Example for `--parallel 4`
(main + 3 children, `-c 256000` → 64000 tokens per slot):

```json
"subAgents": {
  "enabled": true,
  "maxAgentSlots": 3,
  "background": true,
  "wakeOnComplete": false,
  "maxQueued": 8,
  "maxRuntimeMs": 0,
  "perSlotContextTokens": 64000
}
```

## UI

- Live bubble per agent in the message feed: thinking, tool calls, report.
- `#agent-activity` sidebar panel survives session switches and reconnects:
  slot usage, queue, elapsed time, pending reports, and a cancel button.
- On `session:connected` / `session:switch` the server sends `subagent:list` and
  the client rehydrates from it.

## Limitations

- Jobs are **in-memory**; a server restart loses them (the parent may still have
  the report in its own transcript if it was already delivered).
- File tools (`read`/`write`/`edit`) still resolve relative paths against the
  server's `process.cwd()`, not `projectPath`; give children absolute paths.
- No cross-session agent sharing: a job is bound to the session that spawned it
  and is cancelled when that session is deleted.

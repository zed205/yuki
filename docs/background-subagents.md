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

A finished sub-agent **always alerts the main agent**, and the main agent is
expected to review and validate the work rather than trust the report:

1. **Mid-turn (parent running):** at the top of every iteration, finished reports
   are injected as a `user`-role context block (`Background Sub-Agent Results`),
   then marked delivered. The block instructs the parent to check the claims
   (open the files, inspect the diff, re-run the command/test) before reporting
   success. No polling is required.
2. **Idle:** the server starts a review turn in the session (only if a client is
   viewing it) after a 2 s debounce, so several agents finishing together produce
   **one** wake turn instead of one per agent. The prompt is a notice; the reports
   themselves still arrive through the normal injection queue.
3. **No client watching:** the report stays pending and is injected at the start of
   the next turn (nothing is lost); the sidebar shows a `new` badge.

A **failed** child (`error`) also triggers a review turn: a crashed agent may have
left the tree in a broken state. A user-initiated cancellation (`agent_kill`,
`chat:stop`) does not.

The model can also pull explicitly:

| Tool | Purpose |
|---|---|
| `agent_result(agentId, wait_ms)` | Collect one report, optionally wait (≤ 10 min) |
| `agent_list()` | Status, elapsed time, queue position, free slots |
| `agent_kill(agentId)` | Cancel a running/queued agent (also available in the UI panel) |

## Context management

A child has no `Session`, so the parent's anchored-summary machinery does not apply.
Instead its transcript is kept inside the per-slot window by two layers, checked at
the top of **every** iteration:

1. **Compaction (primary).** Once the transcript passes 72% of the budget, the head
   (system prompt + task) and the newest turns are kept verbatim and everything
   between is replaced by one summary written by the same model with **all tools
   disabled**. The summary keeps the goal, what was tried, paths/identifiers,
   commands that worked or failed, and unfinished steps — and is injected as a
   `user` message (never a mid-conversation `system` message, which Qwen rejects).
   At most **3** compactions per child; the summarizer's own prompt is capped at 50%
   of the budget so the rescue call cannot itself overflow.
2. **Mechanical trim (fallback).** Old `tool` payloads are replaced with a marker.
   Runs after compaction as a safety net, and alone once the compaction cap is hit.

Structure is always preserved: an assistant `tool_calls` message and its `tool`
results are kept or dropped together, and the split never leaves an orphan. If the
summarization call fails (endpoint error, cancellation), the child keeps working and
falls back to trimming. If a child still overruns, the request fails, the agent is
marked `error`, and the main agent is alerted to retry with a narrower task.

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

Each child is budgeted the **full context window** of the model it runs on
(`contextWindow`). Prompt caching means the shared prefix — system prompt and
tool definitions — is computed once and reused across concurrent slots, so a large
per-child window does not cost a large prompt every turn. Override
`subAgents.perSlotContextTokens` if the server's real per-slot window is smaller
(for example when `-c` is split across `--parallel` slots).

`--parallel` should still cover `maxAgentSlots + 1` (main + children). Example for
`--parallel 4` with a 256k model:

```json
"subAgents": {
  "enabled": true,
  "maxAgentSlots": 3,
  "background": true,
  "maxQueued": 8
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

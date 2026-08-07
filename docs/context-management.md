# Context Management: Summary Compaction

Compaction replaces older conversation history with a model-generated summary
when the estimated token count exceeds a threshold. This keeps the conversation
within the model's context window without losing critical context.

## Config

```jsonc
{
  "contextManagement": {
    "enabled": true,
    "compactionThreshold": 0.85,   // trigger at 85% of context window
    "compactionTarget": 0.25       // aim to reduce to 25% after compaction
  }
}
```

## Flow

1. At the start of each `chat()` call, `estimateSessionTokens(session)`
   checks if the conversation exceeds `contextWindow * compactionThreshold`.
2. If so, the agent makes a non-streaming LLM call asking for a structured
   summary of older messages.
3. Old messages are replaced with a single system message containing the
   summary. The last 4 messages (2 exchanges) are kept for continuity.
4. The estimate is always `f(session.messages)` — single source of truth,
   identical before and after refresh.

## Compaction Prompt

The system prompt tells the model it is an "anchored context summarization
assistant for coding sessions." The user prompt follows opencode's format:

**First compaction:**
> Create a new anchored summary from the conversation history above.
>
> [SUMMARY_TEMPLATE]

**Subsequent compactions (updates existing summary):**
> Update the anchored summary below using the conversation history above.
> Preserve still-true details, remove stale details, and merge in the new
> facts.
> <previous-summary>
> [prior summary text]
> </previous-summary>
>
> [SUMMARY_TEMPLATE]

## Summary Template

```
---
## Goal

- [single-sentence task summary]

## Constraints & Preferences

- [user constraints, preferences, specs, or "(none)"]

## Accomplished

- [completed work or "(none)"]

### In Progress

- [current work or "(none)"]

### Blocked

- [blockers or "(none)"]

## Key Decisions

- [decision and why, or "(none)"]

## Next Steps

- [ordered next actions or "(none)"]

## Critical Context

- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files

- [file or directory path: why it matters, or "(none)"]
---
```

Rules: keep every section (even when empty), terse bullets over prose,
preserve exact paths/commands/errors/identifiers, never mention compaction.

## `context:compacted` WS Event

After compaction, the server sends:

```json
{
  "type": "context:compacted",
  "data": {
    "savedTokens": 42000,
    "messagesCompacted": 24,
    "sessionId": "..."
  }
}
```

## File

- `agent.ts:compactConversation()` — the compaction implementation
- `agent.ts:estimateSessionTokens()` — token estimation used for threshold
  check, display, and savings calculation

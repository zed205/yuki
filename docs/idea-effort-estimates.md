# Yuki Development Ideas — Effort Estimates (AI-codes / user-tests model)

Date: 2026-08-07
Source: `Projects/ideas/ideas.xlsx` (IDs 1–20)

Working model: the coding agent makes the code changes; the user provides testing and
feedback. Under this model, effort shifts away from lines-of-code and toward **test/feedback
rounds, local-machine infrastructure, and genuinely hard domains (security, distributed
systems, R&D)**.

| ID | Idea | Adjusted effort | Why it changed |
|----|------|-----------------|----------------|
| 1 | OS Notifications | ~1 day | Trivial code, trivial test |
| 2 | Voice Mode | ~1 wk | Code is fast; real audio round-trips are slow to iterate |
| 3 | Remote Agent | High (4–6 wk) | No reduction — security/distributed is where the user can't be the agent's eyes; multi-device testing is painful |
| 4 | Per-Project Skills | ~2–3 days | Easy code; user tests by dropping a `.yukiskills` folder |
| 5 | Global Voice Shortcut | ~1 wk | Tray app + hotkey code is easy; installing/running it while testing voice is fiddly |
| 6 | Kanban Backlog | ~2–3 wk | Agent writes a lot fast, but drag-drop/attachments/status flows need many interaction rounds from the user |
| 7 | Validator Agent | ~1 wk | Orchestration/prompts agent can write; user tests against real tasks |
| 8 | Themes | ~1 day | CSS tokens, instant visual feedback |
| 9 | Mobile Apps | High (4–6 wk) | User needs emulators/devices to test; the loop is slow |
| 10 | Auth | ~1–2 wk | Code moderate; security review is the real cost |
| 11 | Installer Package | ~1–2 wk | Code (bundler) is easy; the cost is clean-machine/QA rounds, whisper+model downloads |
| 14 | Autonomous Workflows | ~2 wk (after #6) | Orchestration easy; observing agent behavior over days is the testing bottleneck |
| 15 | Vector DB & Sessionless | ~3–4 wk | Agent refactors fast, but it touches the whole data path — regression testing is heavy |
| 16 | Configurable Reporting | ~1 wk | Scheduler + templates; easy-ish to verify |
| 17 | MCP per-Project | ~2 days | Pure config plumbing |
| 19 | AI Time Tracker | ~1 wk | Easy UI; accuracy needs multi-day observation |
| 20 | In-Situ GPU Training | High / HW-bound | User's GPU is the bottleneck, not code |
| 18 | Mixture of Specialists | Unchanged (R&D) | Compute/data-gated — not a coding task either way |

## Takeaways

- **Best value under this model:** #1 OS Notifications, #4 Per-Project Skills, #8 Themes,
  #17 MCP per-Project (~a week combined).
- **Biggest strategic pivot:** #6 Kanban Backlog → #14 Autonomous Workflows (Kanban unlocks
  autonomy). This is the largest change and largest gain, and it runs mostly on the user's
  testing bandwidth.
- Optional quality gate on autonomous output: #7 Validator Agent.

## Not included

IDs 12 (Subscription), 13 (AI-Readable HTML), 22 (RFP Evaluation & Risk Platform) are not
agent-core features and were scoped out of this estimate.

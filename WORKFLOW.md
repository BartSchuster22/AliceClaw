# WORKFLOW.md - Build Discipline

Use this during coding/build projects to keep quality high and token burn under control.

## Startup Context Budget

Default startup reads should stay minimal.

Read by default:
- `SOUL.md`
- `USER.md`
- `memory/YYYY-MM-DD.md` for today if it exists
- `PROJECT-STATE.md` if active project work is likely
- `MEMORY.md` only in main session

Do not read by default unless needed by the task:
- `DECISIONS.md`
- older daily memory files
- large reference files
- raw transcripts/log dumps

If today already has a good handoff note, do not also load yesterday's full daily file unless needed.

## Core Rule

After each major phase or sub-phase:
- summarize what changed
- record durable decisions in files
- hard memorize the result in workspace files
- avoid carrying the full debugging history forward
- update `PROJECT-STATE.md` with the next exact step

"Hard memorize" means the important state must be written down, not merely left in chat history.

## Session Discipline

- Prefer a fresh session or a hard summary after every major phase
- Do not let one coding session grow forever
- If context becomes bloated, stop and compress before continuing

Suggested breakpoints:
- after scaffold/infra
- after schema/db
- after auth
- after billing
- after frontend
- after any long debugging cycle

## Logging Discipline

- Do not keep pasting large raw logs once the root cause is known
- Read logs, extract the cause, then summarize in 1-3 lines
- Keep only the actionable conclusion in chat or memory

## Isolation Discipline

- Use isolated phase work where possible
- Keep the main session for coordination, decisions, and concise summaries
- Put implementation churn in narrower work units when feasible

## File-First Discipline

Write stable project knowledge down early:
- `PROJECT-STATE.md` for current active handoff
- `DECISIONS.md` for live locked decisions only
- `memory/YYYY-MM-DD.md` for concise daily context
- `MEMORY.md` for lean long-term memory

Do not rely on giant chat history as the source of truth.
For resource-intensive coding projects, file updates are mandatory at major phase boundaries.

## Debugging Discipline

After 2-3 failed attempts on the same issue:
- pause
- state the current hypothesis clearly
- inspect the real root cause
- continue only after the cause is named

Avoid blind patch/rebuild loops.

## Throughput Discipline

- Reduce throughput when the project enters a heavy debugging phase
- Compress throughput for resource-intensive projects: fewer larger justified moves, less reactive churn
- Favor fewer, better-justified edits over rapid speculative changes
- Keep changes modular and checkpoint often with commits

## Daily Reconnection Protocol

When resuming an ongoing project in a new session:
1. Read `PROJECT-STATE.md` first.
2. Read today's daily note.
3. Read `DECISIONS.md` only if the task touches locked product/build rules.
4. Read older daily notes only if the handoff is insufficient.
5. Update `PROJECT-STATE.md` at the end of the work block.

## End-of-Phase Summary Template

Capture:
- what changed
- what was verified
- what remains broken or uncertain
- commit hash(es)
- next exact step

## Goal

Operate with:
- lower token waste
- better traceability
- smaller context windows
- cleaner handoffs between phases
- less hidden complexity accumulation

# Symphoneer Domain Language

## Task and execution state

- `issuePhase`: Tracker-derived `backlog | ready | review | closed`.
- `blocked`: an independent Tracker label, not a workflow lane.
- `executionState`: live Runtime ownership: `idle | preparing | running | waiting_input | retry_wait | stopping`.
- `displayState`: UI-only derivation. Priority is closed, live ownership, review, ready, then backlog.
- `lastAttemptOutcome`: durable `succeeded | failed | interrupted` history badge; it never changes the Issue phase.

`in_progress` therefore means the current Runtime owns execution. A Provider Session reference or an
unfinished historical Attempt does not prove that work is running.

Process-wide execution capacity is shared by every Project Runtime in the same Symphoneer process.
Project Scheduler limits remain narrower constraints; both limits must allow a Task before it starts.

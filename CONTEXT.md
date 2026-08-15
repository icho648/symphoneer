# Symphoneer Domain Language

## Task workflow

- `backlog`: eligible or ineligible work that has not started.
- `in_progress`: work owned by an active Attempt.
- `in_review`: execution finished and awaits a human decision.
- `done`: the human-approved terminal state.
- `blocked`: an independent marker explaining why progress cannot continue; it is not a workflow state.

`dispatchable` is Tracker-derived eligibility. The `symphoneer:ready` label may contribute to that
eligibility, but `ready` is not a Task workflow state.

Workspace and Assistant readiness are separate lifecycle concepts and may still use `ready`.

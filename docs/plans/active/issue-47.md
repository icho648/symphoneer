# Issue #47 Local Recovery Plan

> Plan status: Active
> Decision status: Accepted
> Implementation evidence: Implemented and verified locally, in CI, and through two real Web/Desktop Host fixture runs; [Draft PR #48](https://github.com/icho648/symphoneer/pull/48) is the live review source
> Canonical task source: [GitHub Issue #47](https://github.com/icho648/symphoneer/issues/47)

## Purpose / Big Picture

This file stores only the local recovery boundary for Issue #47. The Issue is the scope and acceptance source; the Draft PR is the implementation and CI evidence source.

## Progress

Resume from branch `codex/issue-47`. Read the Issue, branch, worktree, PR, CI and retained Smoke resources live before continuing.

## Surprises & Discoveries

The local Node 24 installation required rebuilding `better-sqlite3`; CI remains pinned by `.nvmrc` to Node 22.18. Dated research is historical input and is not rewritten as implementation evidence.

## Decision Log

Reuse `CoreScheduler`, `WorkspaceManager`, `RealSingleAgentOrchestration` and `scripts/real-fixture-smoke.ts`. Do not add another Scheduler or Harness. Do not merge or close Issue #47 automatically.

## Outcomes & Retrospective

Deterministic gates and CI pass. Development restore drill passed. Real Web/Desktop Host integration passed twice against fixture [#8](https://github.com/icho648/symphoneer-fixtures/issues/8) and [#9](https://github.com/icho648/symphoneer-fixtures/issues/9): both reached Tracker Review with clean retained Workspaces and successful Attempts. #8 used one PID and Thread across three Turns; #9 completed poll, dispatch, commit, push, labels and evidence comment without a manual Start. Earlier #4/#5 failure resources remain retained as diagnostic history. Final evidence belongs in the Draft PR and Issue.

## Context and Orientation

Primary implementation seams are `src/runtime/orchestration/single-agent.ts`, `src/runtime/scheduler/`, `src/runtime/workspace/`, `src/runtime/executor/`, `src/runtime/workflow/`, and `scripts/real-fixture-smoke.ts`.

## Plan of Work

Keep the Draft PR and Issue open for human review. Preserve review-state #8/#9 Workspaces until terminal reconciliation, and preserve failed #4/#5 resources until their manifests are explicitly cleaned.

## Concrete Steps

Use `pnpm check` as the repository gate. Before real Smoke, confirm no Development Runtime owns the data directory, create the timestamped backup and credential-free manifest, and exercise restore without deleting the backup.

## Validation and Acceptance

Deterministic validation is `pnpm check`. Real GitHub/Codex/Desktop Host execution is verified by #8/#9 IDs, HEADs, labels and operator logs in Draft PR #48. Terminal cleanup of these review-state Workspaces is intentionally not claimed; cleanup safety remains deterministic test evidence until the Issues become terminal.

## Idempotence and Recovery

Never force-clean a Workspace. On Smoke failure, retain the Issue, branch, Runtime data and manifest. Cleanup must reject HEAD, fingerprint or dirty-state drift. Restore the Development directory only by atomic rename after confirming no owning Runtime.

## Artifacts and Notes

Local backup manifest: `/Users/icho/Library/Application Support/Symphoneer/Development.backup-20260812T102421Z/issue47-backup-manifest.json`; restore drill passed and the final backup is retained. Failed Smoke manifests: `/var/folders/8_/7hbyc9q53ll0dzwxs569lbm00000gn/T/symphoneer-fixture-smoke-IV7GVv/manifest.json` (#4) and `/var/folders/8_/7hbyc9q53ll0dzwxs569lbm00000gn/T/symphoneer-fixture-smoke-l8KQZL/manifest.json` (#5). Web evidence: #8 HEAD `ef71863`, #9 HEAD `c9edba0`, project `project-cbd1a912-9b23-4984-9245-97e6721e2146`. Draft PR: [#48](https://github.com/icho648/symphoneer/pull/48). Do not store credentials, prompts, source or Provider payloads.

## Interfaces and Dependencies

Issue #47 depends on the existing Tracker, Scheduler, Workspace, Codex App Server and Desktop Host seams. Team and explicit Verification Gate contracts remain unchanged.

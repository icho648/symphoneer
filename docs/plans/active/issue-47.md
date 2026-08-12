# Issue #47 Local Recovery Plan

> Plan status: Active
> Decision status: Accepted
> Implementation evidence: In progress; GitHub Issue and Draft PR remain the live evidence sources
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

Deterministic gates pass. Development restore drill passed. Real Smoke is `Not verified`: the initial sandboxed #4 run could not initialize Codex state; the sandbox-exempt Host retried #4 and ran #5, and both real PID/Thread/Turn executions ended `codex_turn_failed` before any file or GitHub write. Fixture #4 and #5, their stable Workspaces and manifests remain retained. The harness now scopes each subsequent run to its newly created Issue. Final acceptance and evidence belong in the Draft PR and Issue.

## Context and Orientation

Primary implementation seams are `src/runtime/orchestration/single-agent.ts`, `src/runtime/scheduler/`, `src/runtime/workspace/`, `src/runtime/executor/`, `src/runtime/workflow/`, and `scripts/real-fixture-smoke.ts`.

## Plan of Work

Finish deterministic checks, preserve or clean Smoke resources using their manifest, then publish the Draft PR with `Fixes #47`.

## Concrete Steps

Use `pnpm check` as the repository gate. Before real Smoke, confirm no Development Runtime owns the data directory, create the timestamped backup and credential-free manifest, and exercise restore without deleting the backup.

## Validation and Acceptance

Deterministic validation is `pnpm check`. Real GitHub/Codex/Desktop Host behavior remains `Not verified` unless the fixture Smoke completes and its IDs, HEAD, labels, operator log and cleanup evidence are recorded.

## Idempotence and Recovery

Never force-clean a Workspace. On Smoke failure, retain the Issue, branch, Runtime data and manifest. Cleanup must reject HEAD, fingerprint or dirty-state drift. Restore the Development directory only by atomic rename after confirming no owning Runtime.

## Artifacts and Notes

Local backup manifest: `/Users/icho/Library/Application Support/Symphoneer/Development.backup-20260812T102421Z/issue47-backup-manifest.json`; restore drill passed and the final backup is retained. Failed Smoke manifests: `/var/folders/8_/7hbyc9q53ll0dzwxs569lbm00000gn/T/symphoneer-fixture-smoke-IV7GVv/manifest.json` (#4) and `/var/folders/8_/7hbyc9q53ll0dzwxs569lbm00000gn/T/symphoneer-fixture-smoke-l8KQZL/manifest.json` (#5). Draft PR: add the URL here after publication. Do not store credentials, prompts, source or Provider payloads.

## Interfaces and Dependencies

Issue #47 depends on the existing Tracker, Scheduler, Workspace, Codex App Server and Desktop Host seams. Team and explicit Verification Gate contracts remain unchanged.

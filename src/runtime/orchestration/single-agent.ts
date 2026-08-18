import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  type ExecutionSession,
  type ExecutionState,
  InterventionSchema,
  type RuntimeCommand,
  type TaskSummary,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type {
  AgentRunEvent,
  AgentRunner,
  AgentRunRequest,
  AttemptWorker,
  InterventionResponse,
  RunHandle,
} from "../executor/agent-runner.ts";
import { ClaudeCodeAdapter } from "../executor/claude-code/runner.ts";
import { CodexAppServerAdapter } from "../executor/codex-app-server/runner.ts";
import { sessionExecutionActivities } from "../executor/session-activities.ts";
import {
  type CorePolicy,
  CoreScheduler,
  evaluateEligibility,
  type RetryEntry,
  sortTasksForDispatch,
} from "../scheduler/index.ts";
import type { EventLog } from "../service/event-log.ts";
import { OperatorLog, type OperatorRecord } from "../service/operator-log.ts";
import {
  recordAgentActivity,
  recordAttempt,
  recordExecutionSession,
  recordIntervention,
  recordTask,
  recordWorkspace,
} from "../service/recording.ts";
import type { Tracker } from "../tracker/tracker.ts";
import { loadProjectProfile, type ProjectProfile, renderPrompt } from "../workflow/index.ts";
import { GitWorktreeDriver } from "../workspace/git-worktree/index.ts";
import { WorkspaceManager } from "../workspace/manager.ts";
import type { OrchestrationMode } from "./mode.ts";

const CONTINUATION_PROMPT =
  "Continue working on the same issue. Re-read its current tracker state, finish any remaining acceptance work, and report the result.";
const execFile = promisify(execFileCallback);

interface TaskLocator {
  repository: string;
  issueNumber: number;
}

interface ActiveRun {
  attempt: ReturnType<typeof AttemptSnapshotSchema.parse>;
  log: EventLog;
  manager: WorkspaceManager;
  workspace: WorkspaceReference;
  workflow: ProjectProfile;
  task: TaskSummary;
  settings: Pick<AgentRunRequest, "effort" | "model" | "sandbox">;
  turnCount: number;
  worker?: AttemptWorker;
  handle?: RunHandle;
  handoffRequested?: boolean;
  settled: ReturnType<typeof Promise.withResolvers<void>>;
  stopping?: boolean;
}

export class RealSingleAgentOrchestration implements OrchestrationMode {
  #tracker: Tracker;
  #projectRoot: string | undefined;
  #workspaceRoot: string;
  readonly #now: () => Date;
  readonly #runnerFactory: (
    workflow: ProjectProfile,
    provider?: "codex-app-server" | "claude-code",
  ) => AgentRunner;
  readonly #operatorLog: OperatorLog;
  readonly #runs = new Map<string, ActiveRun>();
  readonly #jobs = new Set<Promise<void>>();
  readonly #runningTasks = new Set<string>();
  readonly #interventions = new Map<
    string,
    { handle: RunHandle; questionIds: string[] | undefined }
  >();
  #scheduler: CoreScheduler | undefined;
  #workflow: ProjectProfile | undefined;
  #tickTail = Promise.resolve();
  readonly #retryTimers = new Map<string, NodeJS.Timeout>();
  #stopping = false;

  constructor(options: {
    dataDir: string;
    tracker: Tracker;
    workspaceRoot: string;
    projectRoot?: string;
    now?: () => Date;
    runnerFactory?: (
      workflow: ProjectProfile,
      provider?: "codex-app-server" | "claude-code",
    ) => AgentRunner;
    operatorLogPath?: string;
  }) {
    this.#tracker = options.tracker;
    this.#projectRoot = options.projectRoot ? resolve(options.projectRoot) : undefined;
    this.#workspaceRoot = resolve(options.workspaceRoot);
    this.#now = options.now ?? (() => new Date());
    this.#runnerFactory =
      options.runnerFactory ??
      ((workflow, provider) => createAgentRunner(workflow, this.#now, provider));
    this.#operatorLog = new OperatorLog(
      options.operatorLogPath ?? resolve(options.dataDir, "operator.jsonl"),
    );
  }

  setTracker(tracker: Tracker): void {
    this.#tracker = tracker;
  }

  setWorkspaceRoot(workspaceRoot: string): void {
    this.#workspaceRoot = resolve(workspaceRoot);
  }

  setProjectRoot(projectRoot: string | undefined): void {
    this.#projectRoot = projectRoot ? resolve(projectRoot) : undefined;
  }

  executionState(taskId: string): ExecutionState {
    const run = [...this.#runs.values()].find((candidate) => candidate.task.id === taskId);
    if (run?.stopping || (this.#stopping && this.#runningTasks.has(taskId))) return "stopping";
    if (
      run?.handle &&
      [...this.#interventions.values()].some((item) => item.handle === run.handle)
    ) {
      return "waiting_input";
    }
    if (run) {
      return run.attempt.status === "streaming_turn" || run.attempt.status === "finishing"
        ? "running"
        : "preparing";
    }
    if (this.#retryTimers.has(taskId)) return "retry_wait";
    if (this.#runningTasks.has(taskId)) return "preparing";
    return "idle";
  }

  tick(input: { tasks: readonly TaskSummary[]; log: EventLog }): Promise<void> {
    const startedAt = Date.now();
    const tick = this.#tickTail.then(async () => {
      try {
        await this.#tick(input.tasks, input.log);
        await this.#operator({
          operation: "scheduler.tick",
          outcome: "succeeded",
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        await this.#operator({
          operation: "scheduler.tick",
          outcome: "failed",
          durationMs: Date.now() - startedAt,
          errorKind: errorKind(error),
        });
        throw error;
      }
    });
    this.#tickTail = tick.catch(() => undefined);
    return tick;
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#clearRetryTimers();
    await this.#tickTail;
    await Promise.all(
      [...this.#runs.values()].map((run) =>
        run.stopping || run.attempt.finishedAt !== null
          ? run.settled.promise
          : this.#interrupt(run, true),
      ),
    );
    await Promise.allSettled([...this.#jobs]);
    this.#clearRetryTimers();
  }

  async listModels() {
    if (!this.#projectRoot) {
      throw new RuntimeError("conflict", "Project root is required to list Codex models");
    }
    const workflow = await loadWorkflow(this.#projectRoot, this.#workspaceRoot);
    return (await createAgentRunner(workflow, this.#now).listModels?.()) ?? [];
  }

  async readSession(attempt: AttemptSnapshot): Promise<ExecutionSession | null> {
    const threadId = attempt.providerSession?.threadId;
    if (!threadId || !this.#projectRoot) return null;
    const workflow = await loadWorkflow(this.#projectRoot, this.#workspaceRoot);
    return (
      (await createAgentRunner(workflow, this.#now, providerForAttempt(attempt)).readSession?.(
        threadId,
        attempt.id,
        this.#timestamp(),
      )) ?? null
    );
  }

  async start(input: {
    task: TaskSummary;
    command: Extract<RuntimeCommand, { kind: "start_run" }>;
    log: EventLog;
  }) {
    this.#launch(input.task, input.log, "dispatch", {
      ...(input.command.model ? { model: input.command.model } : {}),
      ...(input.command.sandbox ? { sandbox: input.command.sandbox } : {}),
      ...(input.command.effort ? { effort: input.command.effort } : {}),
    });
  }

  async respond(input: {
    interventionId: string;
    requestRef: string;
    decision: InterventionResponse;
  }): Promise<void> {
    const pending = this.#interventions.get(input.interventionId);
    if (!pending) throw new RuntimeError("not_found", "Provider intervention is no longer active");
    await pending.handle.respondToIntervention(input.requestRef, {
      ...input.decision,
      ...(pending.questionIds && input.decision.response !== undefined
        ? {
            responses: Object.fromEntries(
              pending.questionIds.map((questionId) => [
                questionId,
                [input.decision.response as string],
              ]),
            ),
          }
        : {}),
    });
    this.#interventions.delete(input.interventionId);
  }

  async pause(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    const run = this.#runs.get(input.attempt.id);
    if (!run) return;
    await this.#pause(run, true);
  }

  async retry(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    const task = input.log.projection.getTask(input.attempt.taskId);
    if (!task) throw new RuntimeError("not_found", `Task ${input.attempt.taskId} was not found`);
    this.#launch(task, input.log, "retry", {}, true);
  }

  async input(input: {
    attempt: AttemptSnapshot;
    prompt: string;
    model?: AgentRunRequest["model"];
    sandbox?: AgentRunRequest["sandbox"];
    effort?: AgentRunRequest["effort"];
    log: EventLog;
  }): Promise<void> {
    const run = this.#runs.get(input.attempt.id);
    if (run?.handle) {
      await run.handle.steer(input.prompt);
      return;
    }
    const task = input.log.projection.getTask(input.attempt.taskId);
    if (!task) throw new RuntimeError("not_found", `Task ${input.attempt.taskId} was not found`);
    if (this.#runningTasks.has(task.id)) {
      throw new RuntimeError("conflict", `Task ${task.identifier} already has a running job`);
    }
    this.#runningTasks.add(task.id);
    this.#trackJob(
      task.id,
      this.#continue(input.attempt, task, input.prompt, input.log, {
        ...(input.model ? { model: input.model } : {}),
        ...(input.sandbox ? { sandbox: input.sandbox } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
      }),
    );
  }

  async sync(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<ExecutionSession | null> {
    const session = await this.readSession(input.attempt);
    if (!session) return null;
    for (const event of sessionExecutionActivities(session)) {
      await recordAgentActivity(input.log, input.attempt.id, event, true);
    }
    return session;
  }

  async handoff(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    const run = this.#runs.get(input.attempt.id);
    if (!run) throw new RuntimeError("conflict", "Attempt has no active Worker to hand off");
    if (run.workflow.config.agent.executor !== "codex-app-server") {
      throw new RuntimeError("unsupported", "Claude Code Attempts cannot be handed off to Codex");
    }
    run.handoffRequested = true;
    await run.settled.promise;
    if (input.log.projection.getAttempt(input.attempt.id)?.status !== "paused") {
      throw new RuntimeError("conflict", "Attempt did not pause cleanly for Codex handoff");
    }
    await this.#operator({
      operation: "attempt.handoff",
      outcome: "succeeded",
      durationMs: 0,
      taskId: run.attempt.taskId,
      attemptId: run.attempt.id,
      workspaceId: run.workspace.id,
    });
  }

  async returnControl(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    if (input.attempt.controller !== "codex" || input.attempt.status !== "paused") {
      throw new RuntimeError("conflict", "Only a Codex-controlled paused Attempt can return");
    }
    const task = input.log.projection.getTask(input.attempt.taskId);
    if (!task) throw new RuntimeError("not_found", `Task ${input.attempt.taskId} was not found`);
    if (this.#runningTasks.has(task.id)) {
      throw new RuntimeError("conflict", `Task ${task.identifier} already has a running job`);
    }
    const started = Promise.withResolvers<void>();
    this.#runningTasks.add(task.id);
    this.#trackJob(
      task.id,
      this.#continue(input.attempt, task, CONTINUATION_PROMPT, input.log, {}, true, started),
    );
    await started.promise;
  }

  async delete(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    const run = this.#runs.get(input.attempt.id);
    if (run) await this.#pause(run, true);
    this.#scheduler?.deleteAttempt({
      attemptId: input.attempt.id,
      idempotencyKey: `single-agent:delete:${input.attempt.id}`,
    });
    this.#runs.delete(input.attempt.id);
  }

  #launch(
    task: TaskSummary,
    log: EventLog,
    startReason: "dispatch" | "retry" | "continuation",
    settings: Pick<AgentRunRequest, "effort" | "model" | "sandbox"> = {},
    forceRetry = false,
  ): void {
    if (this.#runningTasks.has(task.id)) {
      throw new RuntimeError("conflict", `Task ${task.identifier} already has a running job`);
    }
    const locator = locateTask(task);
    this.#runningTasks.add(task.id);
    this.#trackJob(task.id, this.#run(task, locator, log, startReason, settings, forceRetry));
  }

  async #tick(tasks: readonly TaskSummary[], log: EventLog): Promise<void> {
    const workflow = await this.#reloadWorkflow();
    await this.#cancelLostAttempts(log, workflow);
    const scheduler = this.#ensureScheduler(workflow, log);
    scheduler.updatePolicy(corePolicy(workflow));
    const observedAt = this.#timestamp();
    const reconciliationTasks = new Map(tasks.map((task) => [task.id, task]));
    for (const run of this.#runs.values()) {
      if (!run.stopping) reconciliationTasks.set(run.task.id, run.task);
    }
    const reconciliation = scheduler.reconcile({
      tasks: [...reconciliationTasks.values()],
      observedAt,
      idempotencyKey: `single-agent:reconcile:${observedAt}:${log.lastSequence}`,
    });
    for (const attemptId of reconciliation.stoppedAttemptIds) {
      await this.#recordReconciledAttempt(log, attemptId, observedAt);
    }
    for (const workspaceId of reconciliation.cleanupWorkspaceIds) {
      await this.#cleanupWorkspace(log, workspaceId, workflow);
    }

    for (const retry of scheduler.dueRetries(this.#now().getTime())) {
      let refreshed: TaskSummary | null = null;
      try {
        const current = log.projection.getTask(retry.taskId);
        if (current) {
          refreshed = (await this.#tracker.getTask(current.source.nativeId)).task;
          await recordTask(
            log,
            refreshed,
            `single-agent:retry-task:${refreshed.id}:${refreshed.updatedAt ?? ""}`,
          );
        }
      } catch {
        this.#scheduleTick(log, retry.taskId, this.#now().getTime() + 1_000);
        continue;
      }
      if (!refreshed || !evaluateEligibility(refreshed, corePolicy(workflow)).eligible) {
        const transition = scheduler.transitionRetry({
          taskId: retry.taskId,
          refreshedTask: refreshed,
          nowMs: this.#now().getTime(),
          idempotencyKey: `single-agent:release-retry:${retry.taskId}:${observedAt}`,
        });
        if (transition.kind === "released") {
          for (const workspaceId of transition.cleanupWorkspaceIds) {
            await this.#cleanupWorkspace(log, workspaceId, workflow);
          }
        }
        continue;
      }
      if (!this.#runningTasks.has(refreshed.id)) {
        this.#launch(refreshed, log, retry.kind === "continuation" ? "continuation" : "retry");
      }
    }

    for (const retry of scheduler.snapshot().retries) {
      if (retry.dueAtMs > this.#now().getTime()) {
        this.#scheduleTick(log, retry.taskId, retry.dueAtMs);
      }
    }

    const snapshot = scheduler.snapshot();
    const activeTaskIds = new Set(
      snapshot.activeAttempts.flatMap((attempt) => (attempt ? [attempt.taskId] : [])),
    );
    let capacity =
      workflow.config.agent.maxConcurrentAgents -
      activeTaskIds.size -
      [...this.#runningTasks].filter((taskId) => !activeTaskIds.has(taskId)).length;
    if (capacity <= 0) return;
    const claimed = new Set(snapshot.claimedTaskIds);
    const activeByState = new Map<string, number>();
    for (const attempt of snapshot.activeAttempts) {
      const state = attempt
        ? log.projection.getTask(attempt.taskId)?.state.toLowerCase()
        : undefined;
      if (state) activeByState.set(state, (activeByState.get(state) ?? 0) + 1);
    }
    for (const task of sortTasksForDispatch(tasks)) {
      if (capacity <= 0) break;
      if (
        claimed.has(task.id) ||
        this.#runningTasks.has(task.id) ||
        task.labels.includes("symphoneer:blocked") ||
        !evaluateEligibility(task, corePolicy(workflow)).eligible
      ) {
        continue;
      }
      const state = task.state.toLowerCase();
      const stateLimit = workflow.config.agent.maxConcurrentAgentsByState[state];
      if (stateLimit != null && (activeByState.get(state) ?? 0) >= stateLimit) continue;
      this.#launch(task, log, "dispatch");
      claimed.add(task.id);
      capacity -= 1;
      activeByState.set(state, (activeByState.get(state) ?? 0) + 1);
    }
  }

  async #run(
    task: TaskSummary,
    locator: TaskLocator,
    log: EventLog,
    startReason: "dispatch" | "retry" | "continuation",
    settings: Pick<AgentRunRequest, "effort" | "model" | "sandbox"> = {},
    forceRetry = false,
  ): Promise<void> {
    let run: ActiveRun | undefined;
    try {
      const live = await this.#tracker.getTask(task.source.nativeId, {
        ...(task.updatedAt ? { expectedUpdatedAt: task.updatedAt } : {}),
      });
      await recordTask(
        log,
        live.task,
        `single-agent:task:${live.task.id}:${live.task.updatedAt ?? ""}`,
      );
      if (!live.task.dispatchable) {
        throw new RuntimeError("conflict", `Task ${live.task.identifier} is not dispatchable`);
      }
      if (live.task.id !== task.id) {
        throw new RuntimeError("conflict", "Tracker Task identity changed before execution");
      }

      if (!this.#projectRoot) {
        throw new RuntimeError("conflict", "The project checkout is not available");
      }
      const workflow = await this.#reloadWorkflow();
      const scheduler = this.#ensureScheduler(workflow, log);
      const attemptId = `attempt:${encodeURIComponent(task.id)}:${randomUUID()}`;
      const manager = this.#workspaceManager(workflow, locator);
      const retained = retainedWorkspaceForTask(log, task.id);
      const prepared = retained
        ? await manager.recover(retained, attemptId)
        : await manager.prepare({
            taskId: task.id,
            identifier: task.identifier,
            attemptId,
            repository: locator.repository,
            branch: `symphoneer/issue-${locator.issueNumber}`,
            host: "local",
          });
      const now = this.#timestamp();
      const sequence = log.projection.attemptsForTask(task.id).length + 1;
      const decision =
        startReason === "dispatch"
          ? scheduler.reserveAttempt({
              task: live.task,
              attemptId,
              sequence,
              startReason,
              workspace: prepared.workspace,
              startedAt: now,
              idempotencyKey: `single-agent:reserve:${attemptId}`,
            })
          : scheduler.transitionRetry({
              taskId: task.id,
              refreshedTask: live.task,
              nowMs: retryTransitionClock(scheduler, task.id, this.#now().getTime(), forceRetry),
              nextAttempt: {
                attemptId,
                sequence,
                workspace: prepared.workspace,
                startedAt: now,
              },
              idempotencyKey: `single-agent:${startReason}:${attemptId}`,
              ...(forceRetry ? { force: true } : {}),
            });
      if (decision.kind !== "reserved") {
        const retainedWorkspace = await manager.finish(prepared.workspace);
        await recordWorkspace(
          log,
          retainedWorkspace.workspace,
          `single-agent:workspace:${retainedWorkspace.workspace.id}:unreserved:${attemptId}`,
        );
        throw new RuntimeError(
          "conflict",
          decision.kind === "rejected"
            ? `Task ${task.identifier} was not reserved: ${decision.reasons.join(", ")}`
            : `Task ${task.identifier} retry was not reserved`,
        );
      }
      run = {
        attempt: decision.attempt,
        log,
        manager,
        workspace: prepared.workspace,
        workflow,
        task: live.task,
        settings,
        turnCount: 0,
        settled: Promise.withResolvers<void>(),
      };
      this.#runs.set(attemptId, run);
      await this.#recordAttempt(run);

      if (await this.#stopRunIfNeeded(run)) return;

      await runCommand("pnpm", ["install", "--frozen-lockfile"], run.workspace.path);
      if (await this.#stopRunIfNeeded(run)) return;
      await this.#setStatus(run, "building_prompt");
      const prompt = await renderPrompt(workflow, {
        issue: JSON.parse(JSON.stringify(live.task)) as Record<string, unknown>,
        attempt: decision.attempt.sequence === 1 ? null : decision.attempt.sequence - 1,
      });
      await this.#setStatus(run, "launching_agent");
      run.worker = await this.#runnerFactory(workflow).openWorker({
        attemptId,
        task: live.task,
        workspace: run.workspace,
        ...configuredModelSetting(workflow),
        ...settings,
      });
      if (await this.#stopRunIfNeeded(run)) return;
      await this.#operator({
        operation: "worker.open",
        outcome: "succeeded",
        durationMs: 0,
        taskId: run.attempt.taskId,
        attemptId: run.attempt.id,
        workspaceId: run.workspace.id,
        pid: run.worker.processIdentity.pid,
      });
      await this.#driveTurns(run, prompt);
    } catch (error) {
      if (run) {
        if (!run.stopping) await this.#fail(run, error);
      }
    }
  }

  async #continue(
    attempt: AttemptSnapshot,
    task: TaskSummary,
    prompt: string,
    log: EventLog,
    settings: Pick<AgentRunRequest, "effort" | "model" | "sandbox"> = {},
    takeControl = false,
    started?: ReturnType<typeof Promise.withResolvers<void>>,
  ): Promise<void> {
    let run: ActiveRun | undefined;
    try {
      if (
        attempt.status !== "paused" ||
        (attempt.controller !== "symphoneer" && !(takeControl && attempt.controller === "codex"))
      ) {
        throw new RuntimeError(
          "conflict",
          "Only a Symphoneer-controlled paused Attempt can resume",
        );
      }
      const threadId = attempt.providerSession?.threadId;
      const workspace = log.projection.attemptDetail(attempt.id)?.workspace;
      if (!threadId || !workspace) {
        throw new RuntimeError("conflict", "Attempt has no retained Codex session or Workspace");
      }
      if (!this.#projectRoot) {
        throw new RuntimeError("conflict", "The project checkout is not available");
      }
      const live = await this.#tracker.getTask(task.source.nativeId, {
        ...(task.updatedAt ? { expectedUpdatedAt: task.updatedAt } : {}),
      });
      await recordTask(
        log,
        live.task,
        `single-agent:task:${live.task.id}:${live.task.updatedAt ?? ""}`,
      );
      if (!live.task.dispatchable || live.task.id !== task.id) {
        throw new RuntimeError("conflict", "Tracker Task is no longer eligible for execution");
      }
      const locator = locateTask(live.task);
      const workflow = await this.#reloadWorkflow();
      const scheduler = this.#ensureScheduler(workflow, log);
      const manager = this.#workspaceManager(workflow, locator);
      const recovered = await manager.recover(workspace, attempt.id);
      const resumedAt = this.#atLeastNow(attempt.updatedAt);
      run = {
        attempt: scheduler.resumePausedAttempt({
          attemptId: attempt.id,
          task: live.task,
          workspace: recovered.workspace,
          resumedAt,
          idempotencyKey: `single-agent:resume:${attempt.id}:${resumedAt}`,
          ...(takeControl ? { takeControl: true } : {}),
        }),
        log,
        manager,
        workspace: recovered.workspace,
        workflow,
        task: live.task,
        settings,
        turnCount: 0,
        settled: Promise.withResolvers<void>(),
      };
      this.#runs.set(attempt.id, run);
      await this.#recordAttempt(run);
      if (await this.#stopRunIfNeeded(run)) return;
      const provider = providerForAttempt(attempt);
      run.worker = await this.#runnerFactory(workflow, provider).openWorker({
        attemptId: attempt.id,
        task: live.task,
        workspace: run.workspace,
        ...configuredModelSetting(workflow, provider),
        sessionId: threadId,
        ...settings,
      });
      if (await this.#stopRunIfNeeded(run)) return;
      await this.#operator({
        operation: "worker.open",
        outcome: "succeeded",
        durationMs: 0,
        taskId: run.attempt.taskId,
        attemptId: run.attempt.id,
        workspaceId: run.workspace.id,
        pid: run.worker.processIdentity.pid,
      });
      started?.resolve();
      await this.#driveTurns(run, prompt, threadId);
    } catch (error) {
      started?.reject(error);
      if (run) await this.#fail(run, error);
    }
  }

  async #driveTurns(
    run: ActiveRun,
    initialPrompt: string,
    initialThreadId?: string,
  ): Promise<void> {
    let prompt = initialPrompt;
    let threadId = initialThreadId;
    for (;;) {
      const worker = run.worker;
      if (!worker) throw new Error("Attempt Worker is unavailable");
      const handle = await worker.startTurn({ prompt, ...(threadId ? { threadId } : {}) });
      run.handle = handle;
      await this.#consume(run, handle);
      const completion = await handle.completion;
      await this.#operator({
        operation: "turn.complete",
        outcome: completion.outcome === "completed" ? "succeeded" : "failed",
        durationMs: 0,
        taskId: run.attempt.taskId,
        attemptId: run.attempt.id,
        workspaceId: run.workspace.id,
        ...(run.attempt.providerSession?.threadId
          ? { threadId: run.attempt.providerSession.threadId }
          : {}),
        ...(run.attempt.activeTurn?.turnId ? { turnId: run.attempt.activeTurn.turnId } : {}),
        pid: worker.processIdentity.pid,
        ...(completion.error ? { errorKind: "worker_turn" } : {}),
      });
      if (run.stopping) return;
      if (completion.outcome !== "completed") {
        throw new Error(
          `Executor Turn did not complete: ${completion.error ?? completion.outcome}`,
        );
      }
      run.turnCount += 1;
      threadId = run.attempt.providerSession?.threadId;
      if (threadId) {
        const session = await worker.readSession(threadId, this.#timestamp()).catch(() => null);
        if (session) await recordExecutionSession(run.log, session);
      }
      if (run.handoffRequested) {
        await this.#pause(run, true, false);
        return;
      }

      const live = await this.#tracker.getTask(run.task.source.nativeId);
      if (live.task.id !== run.task.id) {
        throw new RuntimeError("conflict", "Tracker Task identity changed after the Turn");
      }
      run.task = live.task;
      await recordTask(
        run.log,
        live.task,
        `single-agent:task:${live.task.id}:${live.task.updatedAt ?? ""}`,
      );
      const eligibility = evaluateEligibility(live.task, workflowEligibility(run.workflow));
      if (eligibility.eligible && run.turnCount < run.workflow.config.agent.maxTurns) {
        await this.#setStatus(run, "building_prompt");
        prompt = CONTINUATION_PROMPT;
        await this.#setStatus(run, "launching_agent");
        continue;
      }
      await this.#finishSucceeded(run);
      return;
    }
  }

  async #finishSucceeded(run: ActiveRun): Promise<void> {
    await run.worker?.close();
    await this.#setStatus(run, "finishing");
    await this.#retain(run);
    const finishedAt = this.#atLeastNow(run.attempt.updatedAt);
    const finished = this.#scheduler?.finishAttempt({
      attemptId: run.attempt.id,
      status: "succeeded",
      finishedAt,
      workspace: run.workspace,
      idempotencyKey: `single-agent:finish:${run.attempt.id}:${finishedAt}`,
    });
    run.attempt =
      finished?.attempt ??
      AttemptSnapshotSchema.parse({
        ...run.attempt,
        status: "succeeded",
        activeTurn: null,
        updatedAt: finishedAt,
        finishedAt,
        failure: null,
      });
    await this.#recordAttempt(run);
    await this.#operator({
      operation: "attempt.finish",
      outcome: "succeeded",
      durationMs: 0,
      taskId: run.attempt.taskId,
      attemptId: run.attempt.id,
      workspaceId: run.workspace.id,
    });
    if (finished?.retry) await this.#continueOrBlock(run, finished.retry);
    this.#runs.delete(run.attempt.id);
    run.settled.resolve();
  }

  async #consume(run: ActiveRun, handle: RunHandle): Promise<void> {
    for await (const event of handle.events) {
      if (event.type === "session_started") {
        await this.#setStreaming(run, event);
        continue;
      }
      if (event.type === "activity") {
        await recordAgentActivity(run.log, run.attempt.id, event);
        continue;
      }
      if (event.type !== "intervention_requested") continue;
      const intervention = InterventionSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        id: `intervention:${run.attempt.id}:${encodeURIComponent(event.requestRef)}`,
        attemptId: run.attempt.id,
        requestRef: event.requestRef,
        kind: event.kind,
        state: "pending",
        prompt: event.prompt,
        createdAt: event.occurredAt,
        resolution: null,
      });
      await recordIntervention(run.log, intervention);
      this.#interventions.set(intervention.id, {
        handle,
        questionIds: event.questionIds,
      });
    }
  }

  async #setStreaming(run: ActiveRun, event: Extract<AgentRunEvent, { type: "session_started" }>) {
    const updatedAt = this.#atLeastNow(run.attempt.updatedAt);
    run.attempt =
      this.#scheduler?.attachTurn({
        attemptId: run.attempt.id,
        threadId: event.threadId,
        turnId: event.turnId,
        provider: event.provider.name,
        updatedAt,
        idempotencyKey: `single-agent:turn:${run.attempt.id}:${event.turnId}`,
      }) ??
      AttemptSnapshotSchema.parse({
        ...run.attempt,
        status: "streaming_turn",
        activeTurn: { threadId: event.threadId, turnId: event.turnId },
        providerSession: {
          provider: event.provider.name,
          threadId: event.threadId,
          lastTurnId: event.turnId,
        },
        updatedAt,
      });
    if (run.attempt.providerSession?.provider === "claude-code") {
      run.attempt = AttemptSnapshotSchema.parse({
        ...run.attempt,
        providerSession: { ...run.attempt.providerSession, cwd: run.workspace.path },
      });
    }
    await this.#recordAttempt(run);
  }

  async #setStatus(run: ActiveRun, status: "building_prompt" | "launching_agent" | "finishing") {
    run.attempt = AttemptSnapshotSchema.parse({
      ...run.attempt,
      status,
      activeTurn: null,
      updatedAt: this.#atLeastNow(run.attempt.updatedAt),
    });
    await this.#recordAttempt(run);
  }

  async #recordAttempt(run: ActiveRun, commit = false): Promise<void> {
    await recordAttempt(run.log, run.attempt, {
      workspace: run.workspace,
      idempotencyKey: `single-agent:attempt:${run.attempt.id}:${run.attempt.status}:${run.attempt.updatedAt}`,
      commit,
    });
  }

  async #retain(run: ActiveRun, commit = false): Promise<void> {
    if (run.workspace.state === "retained") return;
    const finished = await run.manager.finish(run.workspace);
    run.workspace = finished.workspace;
    await recordWorkspace(
      run.log,
      run.workspace,
      `single-agent:workspace:${run.workspace.id}:retained`,
      commit,
    );
  }

  async #pause(run: ActiveRun, commit = false, interrupt = true): Promise<void> {
    if (run.attempt.status === "paused") return;
    run.stopping = true;
    if (interrupt) {
      await run.handle?.interrupt().catch(() => undefined);
      await run.handle?.completion.catch(() => undefined);
    }
    await run.worker?.close().catch(() => undefined);
    await this.#retain(run, commit);
    const pausedAt = this.#atLeastNow(run.attempt.updatedAt);
    const paused = this.#scheduler?.pauseAttempt({
      attemptId: run.attempt.id,
      pausedAt,
      workspace: run.workspace,
      ...(run.handoffRequested ? { controller: "codex" as const } : {}),
      idempotencyKey: `single-agent:pause:${run.attempt.id}:${pausedAt}`,
    });
    run.attempt =
      paused?.attempt ??
      AttemptSnapshotSchema.parse({
        ...run.attempt,
        status: "paused",
        activeTurn: null,
        updatedAt: pausedAt,
        finishedAt: null,
        failure: null,
      });
    if (paused) run.workspace = paused.workspace;
    await this.#recordAttempt(run, commit);
    this.#runs.delete(run.attempt.id);
    run.settled.resolve();
  }

  async #interrupt(run: ActiveRun, commit = false): Promise<void> {
    run.stopping = true;
    await run.handle?.interrupt().catch(() => undefined);
    await run.handle?.completion.catch(() => undefined);
    await run.worker?.close().catch(() => undefined);
    await this.#retain(run, commit);
    const interruptedAt = this.#atLeastNow(run.attempt.updatedAt);
    run.attempt = AttemptSnapshotSchema.parse({
      ...run.attempt,
      status: "interrupted",
      activeTurn: null,
      updatedAt: interruptedAt,
      finishedAt: interruptedAt,
      failure: "Symphoneer stopped before the Attempt finished",
    });
    await this.#recordAttempt(run, commit);
    this.#runs.delete(run.attempt.id);
    run.settled.resolve();
  }

  async #fail(run: ActiveRun, error: unknown): Promise<void> {
    await run.handle?.interrupt().catch(() => undefined);
    await run.handle?.completion.catch(() => undefined);
    await run.worker?.close().catch(() => undefined);
    try {
      const finished = await run.manager.finish(run.workspace);
      run.workspace = finished.workspace;
      await recordWorkspace(
        run.log,
        run.workspace,
        `single-agent:workspace:${run.workspace.id}:retained`,
      );
    } catch {
      // Keep the last known ready Workspace when its lifecycle cannot be observed safely.
    }
    const finishedAt = this.#atLeastNow(run.attempt.updatedAt);
    const finished =
      run.workspace.state === "retained"
        ? this.#scheduler?.finishAttempt({
            attemptId: run.attempt.id,
            status: "failed",
            finishedAt,
            workspace: run.workspace,
            error: errorMessage(error),
            idempotencyKey: `single-agent:fail:${run.attempt.id}:${finishedAt}`,
          })
        : undefined;
    run.attempt =
      finished?.attempt ??
      AttemptSnapshotSchema.parse({
        ...run.attempt,
        status: "failed",
        activeTurn: null,
        updatedAt: finishedAt,
        finishedAt,
        failure: errorMessage(error),
      });
    await this.#recordAttempt(run).catch(() => undefined);
    await this.#operator({
      operation: "attempt.finish",
      outcome: "failed",
      durationMs: 0,
      taskId: run.attempt.taskId,
      attemptId: run.attempt.id,
      workspaceId: run.workspace.id,
      errorKind: errorKind(error),
    });
    if (finished?.retry) await this.#continueOrBlock(run, finished.retry);
    this.#runs.delete(run.attempt.id);
    run.settled.resolve();
  }

  async #continueOrBlock(run: ActiveRun, retry: RetryEntry): Promise<void> {
    if (retry.automatic !== false) {
      this.#scheduleTick(run.log, run.attempt.taskId, retry.dueAtMs);
      return;
    }
    // The failed Attempt is the durable signal; the Tracker phase remains authoritative.
  }

  async #reloadWorkflow(): Promise<ProjectProfile> {
    if (!this.#projectRoot) throw new RuntimeError("conflict", "Project checkout is unavailable");
    try {
      const workflow = await loadWorkflow(this.#projectRoot, this.#workspaceRoot);
      this.#workflow = workflow;
      return workflow;
    } catch (error) {
      if (this.#workflow) {
        await this.#operator({
          operation: "workflow.reload",
          outcome: "failed",
          durationMs: 0,
          errorKind: errorKind(error),
        });
        return this.#workflow;
      }
      throw error;
    }
  }

  #ensureScheduler(workflow: ProjectProfile, log: EventLog): CoreScheduler {
    if (this.#scheduler) return this.#scheduler;
    const scheduler = new CoreScheduler(corePolicy(workflow));
    const tasks = log.projection.tasks();
    const attempts = tasks.flatMap((task) => log.projection.attemptsForTask(task.id));
    const workspaces = new Map<string, WorkspaceReference>();
    for (const attempt of attempts) {
      const workspace = log.projection.attemptDetail(attempt.id)?.workspace;
      if (workspace) workspaces.set(workspace.id, workspace);
    }
    scheduler.restore({ tasks, attempts, workspaces: [...workspaces.values()] });
    this.#scheduler = scheduler;
    return scheduler;
  }

  async #cancelLostAttempts(log: EventLog, workflow: ProjectProfile): Promise<void> {
    if (this.#scheduler) return;
    for (const task of log.projection.tasks()) {
      const attempt = log.projection
        .attemptsForTask(task.id)
        .sort((left, right) => right.sequence - left.sequence)
        .find((candidate) => candidate.finishedAt == null);
      if (!attempt || attempt.controller === "codex" || this.#runs.has(attempt.id)) continue;
      const detail = log.projection.attemptDetail(attempt.id);
      if (!detail?.workspace) continue;
      try {
        let workspace = detail.workspace;
        if (workspace.state === "ready" || workspace.state === "reserved") {
          workspace = (await this.#workspaceManager(workflow, locateTask(task)).finish(workspace))
            .workspace;
          await recordWorkspace(
            log,
            workspace,
            `single-agent:workspace:${workspace.id}:startup-reconciliation`,
          );
        }
        const finishedAt = this.#atLeastNow(attempt.updatedAt);
        await recordAttempt(
          log,
          AttemptSnapshotSchema.parse({
            ...attempt,
            status: "interrupted",
            activeTurn: null,
            updatedAt: finishedAt,
            finishedAt,
            failure: "Attempt Worker was not present after Runtime restart",
          }),
          {
            workspace,
            idempotencyKey: `single-agent:attempt:${attempt.id}:startup-reconciliation`,
          },
        );
      } catch (error) {
        const finishedAt = this.#atLeastNow(attempt.updatedAt);
        await recordAttempt(
          log,
          AttemptSnapshotSchema.parse({
            ...attempt,
            status: "interrupted",
            activeTurn: null,
            updatedAt: finishedAt,
            finishedAt,
            failure: `Workspace recovery failed: ${errorMessage(error)}`,
          }),
          {
            workspace: detail.workspace,
            idempotencyKey: `single-agent:attempt:${attempt.id}:startup-reconciliation-blocked`,
          },
        );
      }
    }
  }

  async #recordReconciledAttempt(
    log: EventLog,
    attemptId: string,
    observedAt: string,
  ): Promise<void> {
    const run = this.#runs.get(attemptId);
    if (run) {
      run.stopping = true;
      await run.handle?.interrupt().catch(() => undefined);
      await run.handle?.completion.catch(() => undefined);
      await run.worker?.close().catch(() => undefined);
      await this.#retain(run);
      const finishedAt = this.#atLeastNow(run.attempt.updatedAt);
      run.attempt = AttemptSnapshotSchema.parse({
        ...run.attempt,
        status: "canceled_by_reconciliation",
        activeTurn: null,
        updatedAt: finishedAt,
        finishedAt,
        failure: "Task is no longer eligible",
      });
      await this.#recordAttempt(run);
      this.#runs.delete(attemptId);
      run.settled.resolve();
      return;
    }
    const attempt = log.projection.getAttempt(attemptId);
    if (!attempt || attempt.finishedAt != null || attempt.controller === "codex") return;
    const workspace = log.projection.attemptDetail(attempt.id)?.workspace;
    const finishedAt =
      Date.parse(observedAt) > Date.parse(attempt.updatedAt)
        ? observedAt
        : this.#atLeastNow(attempt.updatedAt);
    await recordAttempt(
      log,
      AttemptSnapshotSchema.parse({
        ...attempt,
        status: "canceled_by_reconciliation",
        activeTurn: null,
        updatedAt: finishedAt,
        finishedAt,
        failure: "Task is no longer eligible",
      }),
      {
        ...(workspace ? { workspace } : {}),
        idempotencyKey: `single-agent:attempt:${attempt.id}:reconciliation:${finishedAt}`,
      },
    );
  }

  async #cleanupWorkspace(
    log: EventLog,
    workspaceId: string,
    workflow: ProjectProfile,
  ): Promise<void> {
    for (const task of log.projection.tasks()) {
      const workspace = log.projection
        .attemptsForTask(task.id)
        .map((attempt) => log.projection.attemptDetail(attempt.id)?.workspace)
        .find((candidate) => candidate?.id === workspaceId);
      if (workspace?.state !== "retained") continue;
      const released = await this.#workspaceManager(workflow, locateTask(task)).remove(workspace);
      await recordWorkspace(
        log,
        released.workspace,
        `single-agent:workspace:${workspace.id}:terminal-cleanup`,
      );
      await this.#operator({
        operation: "workspace.cleanup",
        outcome: "succeeded",
        durationMs: 0,
        taskId: task.id,
        workspaceId: workspace.id,
      });
      return;
    }
  }

  #scheduleTick(log: EventLog, taskId: string, dueAtMs: number): void {
    if (this.#stopping) return;
    clearTimeout(this.#retryTimers.get(taskId));
    const timer = setTimeout(
      () => {
        this.#retryTimers.delete(taskId);
        void this.tick({ tasks: log.projection.tasks(), log }).catch(() => undefined);
      },
      Math.max(0, dueAtMs - this.#now().getTime()),
    );
    timer.unref();
    this.#retryTimers.set(taskId, timer);
  }

  #trackJob(taskId: string, job: Promise<void>): void {
    const tracked = job.finally(() => {
      this.#runningTasks.delete(taskId);
    });
    this.#jobs.add(tracked);
    void tracked.then(
      () => this.#jobs.delete(tracked),
      () => this.#jobs.delete(tracked),
    );
  }

  #clearRetryTimers(): void {
    for (const timer of this.#retryTimers.values()) clearTimeout(timer);
    this.#retryTimers.clear();
  }

  async #stopRunIfNeeded(run: ActiveRun): Promise<boolean> {
    if (!this.#stopping) return false;
    if (!run.stopping) await this.#interrupt(run, true);
    return true;
  }

  #operator(record: Omit<OperatorRecord, "occurredAt">): Promise<void> {
    return this.#operatorLog
      .append({ occurredAt: this.#timestamp(), ...record })
      .catch(() => undefined);
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #atLeastNow(previous: string): string {
    const now = Date.parse(this.#timestamp());
    const prior = Date.parse(previous);
    return new Date(Math.max(now, prior + 1)).toISOString();
  }

  #workspaceManager(workflow: ProjectProfile, locator: TaskLocator): WorkspaceManager {
    if (!this.#projectRoot) throw new RuntimeError("conflict", "Project checkout is unavailable");
    return new WorkspaceManager({
      root: workflow.config.workspace.root,
      hooks: {
        ...(workflow.config.hooks.afterCreate
          ? { afterCreate: workflow.config.hooks.afterCreate }
          : {}),
        ...(workflow.config.hooks.beforeRun ? { beforeRun: workflow.config.hooks.beforeRun } : {}),
        ...(workflow.config.hooks.afterRun ? { afterRun: workflow.config.hooks.afterRun } : {}),
        ...(workflow.config.hooks.beforeRemove
          ? { beforeRemove: workflow.config.hooks.beforeRemove }
          : {}),
        timeoutMs: workflow.config.hooks.timeoutMs,
      },
      driver: new GitWorktreeDriver({
        repositoryPath: this.#projectRoot,
        repository: locator.repository,
        baseRevision: "HEAD",
      }),
    });
  }
}

async function loadWorkflow(
  projectRoot: string | undefined,
  workspaceRoot: string,
): Promise<ProjectProfile> {
  if (!projectRoot) throw new RuntimeError("conflict", "Project checkout is unavailable");
  return loadProjectProfile({ cwd: projectRoot, workspaceRoot });
}

function locateTask(task: TaskSummary): TaskLocator {
  if (task.source.kind !== "github") {
    throw new RuntimeError("unsupported", "Single-agent execution only supports GitHub Tasks");
  }
  let url: URL;
  try {
    url = new URL(task.source.url);
  } catch {
    throw new RuntimeError("invalid_request", "Task source URL is invalid");
  }
  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname)) {
    throw new RuntimeError("unsupported", "Single-agent execution only supports GitHub Issues");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const issueIndex = parts.indexOf("issues");
  const issueNumber = Number(parts[issueIndex + 1]);
  if (
    parts.length < 4 ||
    issueIndex !== 2 ||
    !/^[1-9]\d*$/.test(parts[issueIndex + 1] ?? "") ||
    !Number.isSafeInteger(issueNumber) ||
    task.identifier !== `#${issueNumber}`
  ) {
    throw new RuntimeError("invalid_request", "Task source URL is not a GitHub Issue");
  }
  return { repository: `${parts[0]}/${parts[1]}`, issueNumber };
}

function createAgentRunner(
  workflow: ProjectProfile,
  now: () => Date,
  provider = workflow.config.agent.executor,
): AgentRunner {
  if (provider === "claude-code") {
    if (!workflow.config.claude.permissionMode) {
      throw new Error(".symphoneer/WORKFLOW.md requires claude.permission_mode");
    }
    return new ClaudeCodeAdapter({
      command: workflow.config.claude.command,
      argv: workflow.config.claude.argv,
      ...(workflow.config.claude.model ? { model: workflow.config.claude.model } : {}),
      permissionMode: workflow.config.claude.permissionMode,
      turnTimeoutMs: workflow.config.claude.turnTimeoutMs,
      stallTimeoutMs: workflow.config.claude.stallTimeoutMs,
      now,
    });
  }
  const [command, ...args] = workflow.config.codex.command.trim().split(/\s+/);
  if (!command) throw new Error(".symphoneer/WORKFLOW.md has an empty Codex command");
  return new CodexAppServerAdapter({
    command,
    args,
    approvalPolicy: optionValue(
      workflow.config.codex.approvalPolicy,
      ["never", "on-request", "untrusted"],
      "on-request",
    ),
    sandbox: optionValue(
      workflow.config.codex.turnSandboxPolicy,
      ["danger-full-access", "read-only", "workspace-write"],
      "workspace-write",
    ),
    readTimeoutMs: Math.max(workflow.config.codex.readTimeoutMs, 30_000),
    turnTimeoutMs: workflow.config.codex.turnTimeoutMs,
    stallTimeoutMs: workflow.config.codex.stallTimeoutMs,
    now,
  });
}

function configuredModelSetting(
  workflow: ProjectProfile,
  provider = workflow.config.agent.executor,
): { model?: string } {
  const model =
    provider === "claude-code" ? workflow.config.claude.model : workflow.config.codex.model;
  return model ? { model } : {};
}

function providerForAttempt(attempt: AttemptSnapshot): "codex-app-server" | "claude-code" {
  const provider = attempt.providerSession?.provider;
  if (provider === undefined || provider === "codex-app-server") return "codex-app-server";
  if (provider === "claude-code") return provider;
  throw new RuntimeError("unsupported", "Fake Executor Sessions cannot resume in production");
}

function retainedWorkspaceForTask(log: EventLog, taskId: string): WorkspaceReference | undefined {
  return log.projection
    .attemptsForTask(taskId)
    .sort((left, right) => right.sequence - left.sequence)
    .map((attempt) => log.projection.attemptDetail(attempt.id)?.workspace)
    .find(
      (workspace): workspace is WorkspaceReference =>
        workspace?.state === "retained" && workspace.ownerAttemptId === null,
    );
}

function workflowEligibility(workflow: ProjectProfile) {
  return {
    activeStates: workflow.config.tracker.activeStates,
    terminalStates: workflow.config.tracker.terminalStates,
    requiredLabels: [
      ...workflow.config.tracker.requiredLabels,
      ...workflow.config.symphoneer.eligibility.requiredLabels,
    ],
    excludedLabels: workflow.config.symphoneer.eligibility.excludedLabels,
  };
}

function corePolicy(workflow: ProjectProfile): CorePolicy {
  return {
    ...workflowEligibility(workflow),
    maxConcurrentAgents: workflow.config.agent.maxConcurrentAgents,
    maxConcurrentAgentsByState: workflow.config.agent.maxConcurrentAgentsByState,
    maxAttempts: workflow.config.agent.maxAttempts,
    maxRetryBackoffMs: workflow.config.agent.maxRetryBackoffMs,
  };
}

function retryTransitionClock(
  scheduler: CoreScheduler,
  taskId: string,
  nowMs: number,
  force: boolean,
): number {
  if (!force) return nowMs;
  const retry = scheduler.snapshot().retries.find((candidate) => candidate.taskId === taskId);
  return Math.max(nowMs, retry?.dueAtMs ?? nowMs);
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  try {
    await execFile(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown; stdout?: unknown };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim().slice(-800) : "";
    const stdout = typeof failure.stdout === "string" ? failure.stdout.trim().slice(-800) : "";
    const detail = stderr || stdout;
    throw new Error(
      `${command} ${args[0] ?? "command"} failed${
        failure.code === undefined ? "" : ` with code ${String(failure.code)}`
      }${detail ? `: ${detail}` : ""}`,
    );
  }
}

function optionValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Single-agent execution failed";
}

function errorKind(error: unknown): string {
  if (error instanceof RuntimeError) return error.code;
  return error instanceof Error ? error.name : "unknown_error";
}

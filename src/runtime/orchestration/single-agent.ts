import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  type ExecutionSession,
  InterventionSchema,
  type RuntimeCommand,
  type TaskSummary,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type {
  AgentRunEvent,
  AgentRunRequest,
  InterventionResponse,
  RunHandle,
} from "../executor/agent-runner.ts";
import { sessionExecutionActivities } from "../executor/codex-app-server/activities.ts";
import { CodexAppServerAdapter } from "../executor/codex-app-server/runner.ts";
import type { EventLog } from "../service/event-log.ts";
import {
  recordAgentActivity,
  recordAttempt,
  recordExecutionSession,
  recordIntervention,
  recordTask,
  recordTaskStatus,
  recordWorkspace,
} from "../service/recording.ts";
import type { Tracker } from "../tracker/tracker.ts";
import {
  loadProjectProfile,
  type ProjectProfile,
  renderPrompt,
  WorkflowError,
} from "../workflow/index.ts";
import { GitWorktreeDriver } from "../workspace/git-worktree/index.ts";
import { WorkspaceManager } from "../workspace/manager.ts";
import { workspaceAttemptKey } from "../workspace/reference.ts";
import type { OrchestrationMode } from "./mode.ts";

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
  handle?: RunHandle;
  stopping?: boolean;
}

export class RealSingleAgentOrchestration implements OrchestrationMode {
  #tracker: Tracker;
  #projectRoot: string | undefined;
  #workspaceRoot: string;
  readonly #now: () => Date;
  readonly #runs = new Map<string, ActiveRun>();
  readonly #runningTasks = new Set<string>();
  readonly #interventions = new Map<
    string,
    { handle: RunHandle; questionIds: string[] | undefined }
  >();

  constructor(options: {
    dataDir: string;
    tracker: Tracker;
    workspaceRoot: string;
    projectRoot?: string;
    now?: () => Date;
  }) {
    this.#tracker = options.tracker;
    this.#projectRoot = options.projectRoot ? resolve(options.projectRoot) : undefined;
    this.#workspaceRoot = resolve(options.workspaceRoot);
    this.#now = options.now ?? (() => new Date());
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

  async listModels() {
    if (!this.#projectRoot) {
      throw new RuntimeError("conflict", "Project root is required to list Codex models");
    }
    const workflow = await loadWorkflow(this.#projectRoot, this.#projectRoot, this.#workspaceRoot);
    return createAgentRunner(workflow, this.#now).listModels();
  }

  async readSession(attempt: AttemptSnapshot): Promise<ExecutionSession | null> {
    const threadId = attempt.providerSession?.threadId;
    if (!threadId || !this.#projectRoot) return null;
    const workflow = await loadWorkflow(this.#projectRoot, this.#projectRoot, this.#workspaceRoot);
    return createAgentRunner(workflow, this.#now).readSession(
      threadId,
      attempt.id,
      this.#timestamp(),
    );
  }

  async start(input: {
    task: TaskSummary;
    command: Extract<RuntimeCommand, { kind: "start_run" }>;
    log: EventLog;
  }) {
    if (this.#runningTasks.has(input.task.id)) {
      throw new RuntimeError("conflict", `Task ${input.task.identifier} already has a running job`);
    }
    const locator = locateTask(input.task);
    this.#runningTasks.add(input.task.id);
    void this.#run(input.task, locator, input.log, "dispatch", {
      ...(input.command.model ? { model: input.command.model } : {}),
      ...(input.command.sandbox ? { sandbox: input.command.sandbox } : {}),
      ...(input.command.effort ? { effort: input.command.effort } : {}),
    }).finally(() => {
      this.#runningTasks.delete(input.task.id);
    });
  }

  async respond(input: { requestRef: string; decision: InterventionResponse }): Promise<void> {
    const pending = this.#interventions.get(input.requestRef);
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
    this.#interventions.delete(input.requestRef);
  }

  async pause(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    const run = this.#runs.get(input.attempt.id);
    if (!run) return;
    await this.#pause(run, true);
  }

  async retry(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    const task = input.log.projection.getTask(input.attempt.taskId);
    if (!task) throw new RuntimeError("not_found", `Task ${input.attempt.taskId} was not found`);
    if (this.#runningTasks.has(task.id)) {
      throw new RuntimeError("conflict", `Task ${task.identifier} already has a running job`);
    }
    const locator = locateTask(task);
    this.#runningTasks.add(task.id);
    void this.#run(task, locator, input.log, "retry").finally(() => {
      this.#runningTasks.delete(task.id);
    });
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
    void this.#continue(input.attempt, task, input.prompt, input.log, {
      ...(input.model ? { model: input.model } : {}),
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
    }).finally(() => {
      this.#runningTasks.delete(task.id);
    });
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
    if (run) await this.#pause(run, true);
  }

  async delete(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void> {
    const run = this.#runs.get(input.attempt.id);
    if (run) await this.#pause(run, true);

    const detail = input.log.projection.attemptDetail(input.attempt.id);
    const workspace = run?.workspace ?? detail?.workspace;
    if (!workspace || workspace.state === "released") return;
    const task = input.log.projection.getTask(input.attempt.taskId);
    if (!task || !this.#projectRoot) {
      throw new RuntimeError("conflict", "Attempt Workspace identity is unavailable");
    }
    const locator = locateTask(task);
    const workflow = await loadWorkflow(this.#projectRoot, this.#projectRoot, this.#workspaceRoot);
    const manager = run?.manager ?? this.#workspaceManager(workflow, locator);
    let retained = workspace;
    if (!run) {
      const recovered = await manager.recover(workspace, input.attempt.id);
      retained = (await manager.finish(recovered.workspace)).workspace;
    }
    const removed = await manager.remove(retained, { discardChanges: true });
    await recordWorkspace(
      input.log,
      removed.workspace,
      `single-agent:workspace:${removed.workspace.id}:released`,
      true,
    );
    this.#runs.delete(input.attempt.id);
  }

  async #run(
    task: TaskSummary,
    locator: TaskLocator,
    log: EventLog,
    startReason: "dispatch" | "retry",
    settings: Pick<AgentRunRequest, "effort" | "model" | "sandbox"> = {},
  ): Promise<void> {
    let run: ActiveRun | undefined;
    let handle: RunHandle | undefined;
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
      const sourcePath = this.#projectRoot;
      const workflow = await loadWorkflow(this.#projectRoot, sourcePath, this.#workspaceRoot);
      const attemptId = `attempt:${encodeURIComponent(task.id)}:${randomUUID()}`;
      const attemptKey = workspaceAttemptKey(attemptId);
      const manager = this.#workspaceManager(workflow, locator);
      const prepared = await manager.prepare({
        taskId: task.id,
        identifier: task.identifier,
        attemptId,
        repository: locator.repository,
        branch: `codex/issue-${locator.issueNumber}-${attemptKey.slice(0, 8)}`,
        host: "local",
      });
      const now = this.#timestamp();
      run = {
        attempt: AttemptSnapshotSchema.parse({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          id: attemptId,
          taskId: task.id,
          sequence: log.projection.attemptsForTask(task.id).length + 1,
          startReason,
          status: "preparing_workspace",
          workspaceId: prepared.workspace.id,
          activeTurn: null,
          providerSession: null,
          startedAt: now,
          updatedAt: now,
          finishedAt: null,
          failure: null,
        }),
        log,
        manager,
        workspace: prepared.workspace,
      };
      this.#runs.set(attemptId, run);
      await this.#recordAttempt(run);

      await runCommand("pnpm", ["install", "--frozen-lockfile"], run.workspace.path);
      await this.#setStatus(run, "building_prompt");
      const prompt = await renderPrompt(workflow, {
        issue: JSON.parse(JSON.stringify(live.task)) as Record<string, unknown>,
        attempt: 1,
      });
      await this.#setStatus(run, "launching_agent");
      const runner = createAgentRunner(workflow, this.#now);
      handle = await runner.startOrContinue({
        attemptId,
        task: live.task,
        workspace: run.workspace,
        prompt,
        continuation: false,
        ...settings,
      });
      run.handle = handle;
      await this.#finishTurn(run, runner, handle);
    } catch (error) {
      if (handle && run) run.handle = handle;
      if (run) {
        if (!run.stopping) await this.#fail(run, error);
      } else {
        const current = log.projection.getTask(task.id);
        if (current) {
          await recordTaskStatus(
            log,
            current.id,
            current.workflowStatus,
            { reason: errorMessage(error), since: this.#timestamp() },
            {
              source: "symphony-core",
              idempotencyKey: `single-agent:task:${current.id}:blocked:${errorMessage(error)}`,
            },
          ).catch(() => undefined);
        }
      }
    }
  }

  async #continue(
    attempt: AttemptSnapshot,
    task: TaskSummary,
    prompt: string,
    log: EventLog,
    settings: Pick<AgentRunRequest, "effort" | "model" | "sandbox"> = {},
  ): Promise<void> {
    let run: ActiveRun | undefined;
    let handle: RunHandle | undefined;
    try {
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
      const workflow = await loadWorkflow(
        this.#projectRoot,
        this.#projectRoot,
        this.#workspaceRoot,
      );
      const manager = this.#workspaceManager(workflow, locator);
      const recovered = await manager.recover(workspace, attempt.id);
      run = {
        attempt: AttemptSnapshotSchema.parse({
          ...attempt,
          status: "launching_agent",
          controller: "symphoneer",
          activeTurn: null,
          updatedAt: this.#atLeastNow(attempt.updatedAt),
          finishedAt: null,
          failure: null,
        }),
        log,
        manager,
        workspace: recovered.workspace,
      };
      this.#runs.set(attempt.id, run);
      await this.#recordAttempt(run);
      const runner = createAgentRunner(workflow, this.#now);
      handle = await runner.startOrContinue({
        attemptId: attempt.id,
        task: live.task,
        workspace: run.workspace,
        prompt,
        continuation: true,
        threadId,
        ...settings,
      });
      run.handle = handle;
      await this.#finishTurn(run, runner, handle);
    } catch (error) {
      if (handle && run) run.handle = handle;
      if (run) await this.#fail(run, error);
      else {
        await recordTaskStatus(
          log,
          task.id,
          task.workflowStatus,
          { reason: errorMessage(error), since: this.#timestamp() },
          { source: "symphony-core" },
        ).catch(() => undefined);
      }
    }
  }

  async #finishTurn(
    run: ActiveRun,
    runner: CodexAppServerAdapter,
    handle: RunHandle,
  ): Promise<void> {
    await this.#consume(run, handle);
    const completion = await handle.completion;
    if (run.stopping) return;
    if (completion.outcome !== "completed") {
      throw new Error(`Codex Turn did not complete: ${completion.error ?? completion.outcome}`);
    }
    const threadId = run.attempt.providerSession?.threadId;
    if (threadId) {
      const session = await runner
        .readSession(threadId, run.attempt.id, this.#timestamp())
        .catch(() => null);
      if (session) await recordExecutionSession(run.log, session);
    }
    await this.#setStatus(run, "finishing");
    await this.#retain(run);
    const finishedAt = this.#atLeastNow(run.attempt.updatedAt);
    run.attempt = AttemptSnapshotSchema.parse({
      ...run.attempt,
      status: "succeeded",
      activeTurn: null,
      updatedAt: finishedAt,
      finishedAt,
      failure: null,
    });
    await this.#recordAttempt(run);
    this.#runs.delete(run.attempt.id);
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
      this.#interventions.set(event.requestRef, {
        handle,
        questionIds: event.questionIds,
      });
    }
  }

  async #setStreaming(run: ActiveRun, event: Extract<AgentRunEvent, { type: "session_started" }>) {
    run.attempt = AttemptSnapshotSchema.parse({
      ...run.attempt,
      status: "streaming_turn",
      activeTurn: { threadId: event.threadId, turnId: event.turnId },
      providerSession: { threadId: event.threadId, lastTurnId: event.turnId },
      updatedAt: this.#atLeastNow(run.attempt.updatedAt),
    });
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
    const finished = await run.manager.finish(run.workspace);
    run.workspace = finished.workspace;
    await recordWorkspace(
      run.log,
      run.workspace,
      `single-agent:workspace:${run.workspace.id}:retained`,
      commit,
    );
  }

  async #pause(run: ActiveRun, commit = false): Promise<void> {
    if (run.attempt.status === "paused") return;
    run.stopping = true;
    await run.handle?.interrupt();
    await run.handle?.completion.catch(() => undefined);
    await this.#retain(run, commit);
    run.attempt = AttemptSnapshotSchema.parse({
      ...run.attempt,
      status: "paused",
      activeTurn: null,
      updatedAt: this.#atLeastNow(run.attempt.updatedAt),
      finishedAt: null,
      failure: null,
    });
    await this.#recordAttempt(run, commit);
    this.#runs.delete(run.attempt.id);
  }

  async #fail(run: ActiveRun, error: unknown): Promise<void> {
    await run.handle?.interrupt().catch(() => undefined);
    await run.handle?.completion.catch(() => undefined);
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
    run.attempt = AttemptSnapshotSchema.parse({
      ...run.attempt,
      status: "failed",
      activeTurn: null,
      updatedAt: finishedAt,
      finishedAt,
      failure: errorMessage(error),
    });
    await this.#recordAttempt(run).catch(() => undefined);
    this.#runs.delete(run.attempt.id);
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
  sourcePath: string,
  workspaceRoot: string,
): Promise<ProjectProfile> {
  if (projectRoot) {
    try {
      return await loadProjectProfile({ cwd: projectRoot, workspaceRoot });
    } catch (error) {
      if (!(error instanceof WorkflowError) || error.code !== "missing_workflow_file") throw error;
    }
  }
  return loadProjectProfile({ cwd: sourcePath, workspaceRoot });
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

function createAgentRunner(workflow: ProjectProfile, now: () => Date): CodexAppServerAdapter {
  const [command, ...args] = workflow.config.codex.command.trim().split(/\s+/);
  if (!command) throw new Error("WORKFLOW.md has an empty Codex command");
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

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  try {
    await execFile(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim().slice(-800) : "";
    throw new Error(
      `${command} ${args[0] ?? "command"} failed${
        failure.code === undefined ? "" : ` with code ${String(failure.code)}`
      }${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

function optionValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Single-agent execution failed";
}

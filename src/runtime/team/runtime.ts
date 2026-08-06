import {
  AttemptSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  FakeTeamScenarioSchema,
  type RuntimeCommand,
  type RuntimeEvent,
  TaskSummarySchema,
  TeamRunSnapshotSchema,
  type TeamVerificationOutcome,
  VerificationResultSchema,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type { TeamCommand, TeamCommandHandler } from "../service/commands.ts";
import type { EventLog } from "../service/event-log.ts";
import type {
  TeamOrchestrator,
  TeamResumeInput,
  TeamRunHandle,
  TeamRunOperation,
  TeamRunRequest,
} from "./orchestrator.ts";

export class WorkflowRuntimeCoordinator {
  readonly #idFactory: () => string;
  readonly #now: () => Date;
  readonly #handles = new Map<string, TeamRunHandle>();

  constructor(options: { idFactory: () => string; now: () => Date }) {
    this.#idFactory = options.idFactory;
    this.#now = options.now;
  }

  readonly handle: TeamCommandHandler = async (command, log, orchestrator) => {
    if (command.kind === "start_team_run") return this.#start(command, log, orchestrator);
    const teamRun = log.projection.getTeamRun(command.teamRunId);
    if (!teamRun)
      throw new RuntimeError("not_found", `Workflow ${command.teamRunId} was not found`);
    if (
      command.expectedTeamRevision !== undefined &&
      command.expectedTeamRevision !== teamRun.revision
    ) {
      throw new RuntimeError("conflict", "Workflow changed before this command was read");
    }
    if (command.kind === "reset_team_run") {
      await orchestrator.reset(teamRun.id);
      this.#handles.delete(teamRun.id);
      const attempt = log.projection.getAttempt(teamRun.attemptId);
      await log.commit({
        type: "team.run.reset",
        source: "human",
        aggregate: { kind: "team_run", id: teamRun.id },
        attemptId: teamRun.attemptId,
        ...(attempt ? { taskId: attempt.taskId } : {}),
        payload: { teamRunId: teamRun.id, attemptId: teamRun.attemptId },
      });
      return this.#commandEvent(log, command, teamRun);
    }
    let handle = this.#handles.get(teamRun.id);
    if (!handle) {
      const attempt = log.projection.getAttempt(teamRun.attemptId);
      const task = attempt ? log.projection.getTask(attempt.taskId) : undefined;
      const detail = log.projection.attemptDetail(teamRun.attemptId);
      if (!attempt || !task || !detail?.workspace) {
        throw new RuntimeError(
          "conflict",
          "Workflow checkpoint cannot be resumed without its Attempt Workspace",
        );
      }
      handle = await orchestrator.startOrResume({
        teamRunId: teamRun.id,
        attemptId: attempt.id,
        task,
        workspace: detail.workspace,
        provider: teamRun.provider,
      });
      this.#handles.set(teamRun.id, handle);
    }
    const input = resumeInput(command, teamRun.pendingHumanInput?.kind);
    const operation =
      command.kind === "stop_team_session" ? await handle.stop() : await handle.resume(input);
    await this.#recordOperation(log, operation, teamRun.attemptId);
    return this.#commandEvent(log, command, operation.teamRun);
  };

  async #start(
    command: Extract<TeamCommand, { kind: "start_team_run" }>,
    log: EventLog,
    orchestrator: TeamOrchestrator,
  ): Promise<RuntimeEvent> {
    const task = TaskSummarySchema.parse(command.task);
    const suffix = this.#idFactory();
    const teamRunId = command.teamRunId ?? `team:${suffix}`;
    const attemptId = command.attemptId ?? `attempt:${suffix}`;
    if (log.projection.getTeamRun(teamRunId)) {
      throw new RuntimeError("conflict", `TeamRun ${teamRunId} already exists`);
    }
    await log.commit({
      type: "task.upserted",
      source: "adapter",
      aggregate: { kind: "task", id: task.id },
      taskId: task.id,
      idempotencyKey: `fake-team-task:${task.id}:${task.updatedAt ?? ""}`,
      payload: { task },
    });
    const now = this.#now().toISOString();
    const workspace = WorkspaceReferenceSchema.parse(
      command.workspace ?? {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        id: `demo-workspace:${attemptId}`,
        taskId: task.id,
        path: `/demo/symphoneer/${attemptId}`,
        repository: "icho648/symphoneer",
        branch: `demo/${teamRunId}`,
        gitHead: null,
        worktreeFingerprint: null,
        host: "demo",
        state: "ready",
        ownerAttemptId: attemptId,
      },
    );
    const attempt = AttemptSnapshotSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: attemptId,
      taskId: task.id,
      sequence: 1,
      startReason: "dispatch",
      status: "initializing_session",
      workspaceId: workspace.id,
      activeTurn: null,
      providerSession: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      failure: null,
    });
    await log.commit({
      type: "workspace.recorded",
      source: "symphony-core",
      aggregate: { kind: "workspace", id: workspace.id },
      taskId: task.id,
      attemptId,
      payload: { workspace },
    });
    await log.commit({
      type: "attempt.recorded",
      source: "symphony-core",
      aggregate: { kind: "attempt", id: attempt.id },
      taskId: task.id,
      attemptId,
      payload: { attempt, workspace },
    });
    const request: TeamRunRequest = {
      teamRunId,
      attemptId,
      task,
      workspace,
      prompt: `Execute the workflow plan for ${task.title}`,
      scenario: FakeTeamScenarioSchema.parse(command.scenario ?? {}),
    };
    const handle = await orchestrator.startOrResume(request);
    this.#handles.set(teamRunId, handle);
    const operation = await handle.operation;
    await this.#recordOperation(log, operation, attemptId);
    return this.#commandEvent(log, command, operation.teamRun);
  }

  async #recordOperation(
    log: EventLog,
    operation: TeamRunOperation,
    attemptId: string,
  ): Promise<void> {
    const teamRun = TeamRunSnapshotSchema.parse(operation.teamRun);
    const attempt = log.projection.getAttempt(attemptId);
    if (!attempt) throw new RuntimeError("not_found", `Attempt ${attemptId} was not found`);
    await log.commit({
      type: teamRun.revision === 1 ? "team.run.created" : "team.run.updated",
      source: "adapter",
      aggregate: { kind: "team_run", id: teamRun.id },
      taskId: attempt.taskId,
      attemptId,
      idempotencyKey: `fake-team:${teamRun.id}:revision:${teamRun.revision}`,
      payload: {
        teamRun,
        agentRuns: operation.agentRuns,
        events: operation.events,
      },
    });
    if (teamRun.status === "awaiting_human_decision" && operation.verification) {
      await this.#recordVerification(log, teamRun, attempt.taskId, operation.verification);
    }
    if (teamRun.status === "completed" || teamRun.status === "stopped") {
      const finished = AttemptSnapshotSchema.parse({
        ...attempt,
        status: teamRun.status === "completed" ? "succeeded" : "failed",
        updatedAt: teamRun.updatedAt,
        finishedAt: teamRun.updatedAt,
        failure: teamRun.status === "completed" ? null : "fake_team_stopped",
      });
      await log.commit({
        type: "attempt.finished",
        source: "symphony-core",
        aggregate: { kind: "attempt", id: attempt.id },
        taskId: attempt.taskId,
        attemptId: attempt.id,
        payload: { attempt: finished },
      });
    }
  }

  async #recordVerification(
    log: EventLog,
    teamRun: TeamRunOperation["teamRun"],
    taskId: string,
    outcome: TeamVerificationOutcome,
  ): Promise<void> {
    const artifactRef = await log.artifacts.put(outcome.artifact);
    const verification = VerificationResultSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: `team-verification:${teamRun.id}`,
      attemptId: teamRun.attemptId,
      checkId: outcome.checkId,
      status: outcome.status,
      argv: outcome.argv,
      cwd: outcome.cwd,
      gitHead: outcome.gitHead,
      worktreeFingerprint: outcome.worktreeFingerprint,
      tool: outcome.tool,
      inputFingerprint: outcome.inputFingerprint,
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
      exitCode: outcome.exitCode,
      artifactRef,
    });
    await log.commit({
      type: "verification.recorded",
      source: "adapter",
      aggregate: { kind: "verification", id: verification.id },
      taskId,
      attemptId: teamRun.attemptId,
      idempotencyKey: `team-verification:${teamRun.id}`,
      payload: { verification },
    });
  }

  #commandEvent(
    log: EventLog,
    command: RuntimeCommand,
    teamRun: TeamRunOperation["teamRun"],
  ): Promise<RuntimeEvent> {
    return log.commit({
      type: "runtime.command.requested",
      source: "human",
      aggregate: { kind: "team_run", id: teamRun.id },
      attemptId: teamRun.attemptId,
      idempotencyKey: command.idempotencyKey,
      payload: { commandKind: command.kind, teamRunId: teamRun.id, attemptId: teamRun.attemptId },
    });
  }
}

function resumeInput(
  command: Exclude<TeamCommand, { kind: "start_team_run" | "reset_team_run" }>,
  pendingKind: "plan_approval" | "review_input" | "final_decision" | undefined,
): TeamResumeInput {
  if (command.kind === "approve_plan") return "approve";
  if (command.kind === "reject_plan") return "reject";
  if (command.kind === "revise_plan") return "revise";
  if (command.kind === "final_decision") return command.decision;
  if (command.kind === "answer_team_input") {
    if (command.response === "accept" && pendingKind === "final_decision") return "accept";
    if (command.response === "revise" && pendingKind === "plan_approval") return "revise";
    if (command.response === "reject" && pendingKind === "plan_approval") return "reject";
    if (command.response === "approve") return "approve";
    if (command.response === "request_changes") return "request_changes";
    return "stop";
  }
  if (command.kind === "stop_team_session") return "stop";
  if (command.kind === "resume_team_session") {
    throw new RuntimeError("conflict", "Resume requires the pending Team human decision");
  }
  throw new RuntimeError("invalid_request", "Unsupported Team command");
}

export const isTeamRuntimeCommand = (command: RuntimeCommand): command is TeamCommand =>
  command.kind === "start_team_run" ||
  command.kind === "approve_plan" ||
  command.kind === "reject_plan" ||
  command.kind === "revise_plan" ||
  command.kind === "stop_team_session" ||
  command.kind === "resume_team_session" ||
  command.kind === "answer_team_input" ||
  command.kind === "final_decision" ||
  command.kind === "reset_team_run";

export const isWorkflowRuntimeCommand = isTeamRuntimeCommand;

export class TeamRuntimeCoordinator extends WorkflowRuntimeCoordinator {}

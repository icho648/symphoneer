import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Command, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type FakeTeamScenario,
  FakeTeamScenarioSchema,
  type OrchestrationBinding,
  type TaskSummary,
  type TeamProcessEvent,
  TeamProcessEventSchema,
  type TeamProvider,
  type TeamRunSnapshot,
  TeamRunSnapshotSchema,
  type TeamVerificationOutcome,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import { bindOrchestrationDefinition } from "../orchestration/hash.ts";
import { FakeAgentRunner, type TeamAgentRunner } from "./fake-agent-runner.ts";
import { FakeVerificationAdapter, type TeamVerificationAdapter } from "./fake-verification.ts";
import { buildTeamGraph, type TeamGraphState } from "./workflow.ts";

export type TeamResumeInput =
  | "approve"
  | "reject"
  | "revise"
  | "request_changes"
  | "accept"
  | "stop";

export interface TeamRunRequest {
  teamRunId: string;
  attemptId: string;
  task: TaskSummary;
  workspace?: ReturnType<typeof WorkspaceReferenceSchema.parse>;
  prompt?: string;
  provider?: TeamProvider;
  scenario?: FakeTeamScenario;
}

export interface TeamRunOperation {
  teamRun: TeamRunSnapshot;
  agentRuns: AgentRunSnapshot[];
  events: TeamProcessEvent[];
  verification: TeamVerificationOutcome | null;
}

export interface TeamRunHandle {
  readonly teamRunId: string;
  readonly operation: Promise<TeamRunOperation>;
  readonly completion: Promise<TeamRunOperation>;
  readonly events: AsyncIterable<TeamProcessEvent>;
  resume(input: TeamResumeInput): Promise<TeamRunOperation>;
  stop(): Promise<TeamRunOperation>;
}

export interface TeamOrchestrator {
  startOrResume(request: TeamRunRequest): Promise<TeamRunHandle>;
  reset(teamRunId: string): Promise<void>;
}

/** Generic LangGraph workflow seam; the current plan-implement-review graph is one implementation. */
export type WorkflowOrchestrator = TeamOrchestrator;
export type WorkflowRunRequest = TeamRunRequest;
export type WorkflowRunOperation = TeamRunOperation;
export type WorkflowRunHandle = TeamRunHandle;

interface InternalRun {
  request: TeamRunRequest;
  graph: ReturnType<typeof buildTeamGraph>;
  checkpointer: BaseCheckpointSaver;
  operation: Promise<TeamRunOperation>;
  completion: Promise<TeamRunOperation>;
  resolveCompletion: (operation: TeamRunOperation) => void;
  eventCount: number;
  revision: number;
  createdAt: string;
  lastOperation: TeamRunOperation | null;
}

export class LangGraphWorkflowOrchestrator implements WorkflowOrchestrator {
  readonly #runs = new Map<string, InternalRun>();
  readonly #now: () => Date;
  readonly #agentRunner: TeamAgentRunner;
  readonly #verification: TeamVerificationAdapter;
  readonly #provider: TeamProvider;
  readonly #checkpointer: BaseCheckpointSaver;
  readonly #orchestration: OrchestrationBinding;

  constructor(
    options: {
      now?: () => Date;
      agentRunner?: TeamAgentRunner;
      verification?: TeamVerificationAdapter;
      provider?: TeamProvider;
      checkpointer?: BaseCheckpointSaver;
      checkpointPath?: string;
      orchestration?: OrchestrationBinding;
    } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#agentRunner = options.agentRunner ?? new FakeAgentRunner();
    this.#verification = options.verification ?? new FakeVerificationAdapter();
    this.#provider = options.provider ?? "fake";
    this.#orchestration =
      options.orchestration ??
      bindOrchestrationDefinition({
        id: "plan-implement-review",
        version: 1,
        nodes: [{ id: "plan", kind: "agent", role: "planner" }],
        edges: [{ from: "START", to: "plan" }],
      });
    if (options.checkpointer) {
      this.#checkpointer = options.checkpointer;
    } else if (options.checkpointPath) {
      mkdirSync(dirname(options.checkpointPath), { recursive: true });
      this.#checkpointer = SqliteSaver.fromConnString(options.checkpointPath);
    } else {
      this.#checkpointer = new MemorySaver();
    }
  }

  async startOrResume(request: TeamRunRequest): Promise<TeamRunHandle> {
    const existing = this.#runs.get(request.teamRunId);
    if (existing) return this.#handle(existing);
    const normalized: TeamRunRequest = {
      ...request,
      provider: request.provider ?? this.#provider,
      scenario: FakeTeamScenarioSchema.parse(request.scenario ?? {}),
    };
    const completion = Promise.withResolvers<TeamRunOperation>();
    const run: InternalRun = {
      request: normalized,
      checkpointer: this.#checkpointer,
      graph: buildTeamGraph({
        checkpointer: this.#checkpointer,
        agentRunner: this.#agentRunner,
        verification: this.#verification,
        now: () => this.#now().toISOString(),
      }),
      operation: Promise.resolve(undefined as never),
      completion: completion.promise,
      resolveCompletion: completion.resolve,
      eventCount: 0,
      revision: 0,
      createdAt: this.#now().toISOString(),
      lastOperation: null,
    };
    this.#runs.set(normalized.teamRunId, run);
    const checkpoint = await this.#checkpointer.getTuple({
      configurable: { thread_id: normalized.teamRunId },
    });
    if (checkpoint) {
      const state = checkpoint.checkpoint.channel_values as unknown as TeamGraphState;
      run.createdAt = state.createdAt ?? run.createdAt;
      run.eventCount = state.processEvents?.length ?? 0;
      run.revision = state.revision ?? 0;
      const operation = this.#operation(run, state);
      run.lastOperation = operation;
      run.operation = Promise.resolve(operation);
      if (operation.teamRun.status === "completed" || operation.teamRun.status === "stopped") {
        run.resolveCompletion(operation);
      }
    } else {
      run.operation = this.#invoke(run);
    }
    return this.#handle(run);
  }

  async reset(teamRunId: string): Promise<void> {
    const run = this.#runs.get(teamRunId);
    if (!run) throw new RuntimeError("not_found", `Workflow ${teamRunId} was not found`);
    await run.checkpointer.deleteThread(teamRunId);
    this.#runs.delete(teamRunId);
  }

  #handle(run: InternalRun): TeamRunHandle {
    return {
      teamRunId: run.request.teamRunId,
      get operation() {
        return run.operation;
      },
      completion: run.completion,
      events: {
        async *[Symbol.asyncIterator]() {
          const operation = await run.operation;
          yield* operation.events;
        },
      },
      resume: (input) => {
        if (
          run.lastOperation?.teamRun.status === "completed" ||
          run.lastOperation?.teamRun.status === "stopped"
        ) {
          return Promise.reject(new RuntimeError("conflict", "Terminal Workflows cannot resume"));
        }
        run.operation = this.#invoke(run, input);
        return run.operation;
      },
      stop: () => {
        const pending = run.lastOperation?.teamRun.pendingHumanInput;
        if (!pending) {
          return Promise.reject(new RuntimeError("conflict", "Workflow has no active human gate"));
        }
        return this.#handle(run).resume(pending.kind === "final_decision" ? "stop" : "stop");
      },
    };
  }

  async #invoke(run: InternalRun, input?: TeamResumeInput): Promise<TeamRunOperation> {
    const config = { configurable: { thread_id: run.request.teamRunId } };
    const initial = run.lastOperation === null;
    const graphInput = initial
      ? {
          teamRunId: run.request.teamRunId,
          attemptId: run.request.attemptId,
          task: run.request.task,
          workspace: run.request.workspace ?? demoWorkspace(run.request),
          prompt: run.request.prompt ?? `Execute the workflow plan for ${run.request.task.title}`,
          createdAt: run.createdAt,
          provider: normalizedProvider(run.request.provider),
          status: "planning" as const,
          currentNode: "plan",
          reviewRound: 0,
          revision: 0,
          planDecision: null,
          reviewDecision: null,
          verificationStatus: null,
          verification: null,
          finalDecision: null,
          pendingHumanInput: null,
          scenario: run.request.scenario as FakeTeamScenario,
          agentRuns: [],
          processEvents: [],
          nextRoute: null,
        }
      : new Command({ resume: input });
    const result = (await run.graph.invoke(
      graphInput as never,
      config,
    )) as unknown as TeamGraphState & {
      __interrupt__?: unknown;
    };
    const operation = this.#operation(run, result);
    run.lastOperation = operation;
    if (operation.teamRun.status === "completed" || operation.teamRun.status === "stopped") {
      run.resolveCompletion(operation);
    }
    return operation;
  }

  #operation(run: InternalRun, state: TeamGraphState): TeamRunOperation {
    const now = this.#now().toISOString();
    const teamRun = TeamRunSnapshotSchema.parse({
      schemaVersion: 2,
      id: run.request.teamRunId,
      attemptId: run.request.attemptId,
      workflow: this.#orchestration.definitionId,
      definitionId: this.#orchestration.definitionId,
      definitionVersion: this.#orchestration.definitionVersion,
      definitionHash: this.#orchestration.definitionHash,
      provider: state.provider,
      status: state.status,
      currentNode: state.currentNode,
      reviewRound: state.reviewRound,
      reviewDecision: state.reviewDecision,
      revision: state.revision,
      pendingHumanInput: state.pendingHumanInput,
      verificationStatus: state.verificationStatus,
      finalDecision: state.finalDecision,
      createdAt: run.createdAt,
      updatedAt: now,
    });
    const agentRuns = state.agentRuns.map((agent) => AgentRunSnapshotSchema.parse(agent));
    const events = state.processEvents
      .slice(run.eventCount)
      .map((event) => TeamProcessEventSchema.parse(event));
    run.eventCount = state.processEvents.length;
    run.revision = state.revision;
    return { teamRun, agentRuns, events, verification: state.verification };
  }
}

function demoWorkspace(request: TeamRunRequest) {
  return WorkspaceReferenceSchema.parse({
    schemaVersion: 2,
    id: `demo-workspace:${request.attemptId}`,
    taskId: request.task.id,
    path: `/demo/symphoneer/${request.attemptId}`,
    repository: "icho648/symphoneer",
    branch: `demo/${request.teamRunId}`,
    gitHead: null,
    worktreeFingerprint: null,
    host: "demo",
    state: "ready",
    ownerAttemptId: request.attemptId,
  });
}

/** The current plan-implement-review workflow, kept as a named flow alias. */
export class LangGraphTeamOrchestrator extends LangGraphWorkflowOrchestrator {}

/** Convenience wiring for the real LangGraph workflow with Fake executor adapters. */
export class FakeWorkflowOrchestrator extends LangGraphWorkflowOrchestrator {}

/** Backward-compatible name for tests and the Issue #40 flow. */
export class FakeTeamOrchestrator extends FakeWorkflowOrchestrator {}

function normalizedProvider(provider: TeamProvider | undefined): TeamProvider {
  return provider ?? "fake";
}

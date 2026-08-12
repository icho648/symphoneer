import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  type AttemptSnapshot,
  CONTRACT_SCHEMA_VERSION,
  type CodexModel,
  type ExecutionActivity,
  type ExecutionSession,
  type Intervention,
  type ReviewDecision,
  type RuntimeCommandResult,
  type RuntimeConnection,
  RuntimeConnectionSchema,
  type RuntimeEvent,
  type RuntimeHealth,
  RuntimeHealthSchema,
  type RuntimeSnapshot,
  type TaskSummary,
  type VerificationResult,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import { loadOrchestrationDefinitionSync } from "../orchestration/index.ts";
import type { OrchestrationMode } from "../orchestration/mode.ts";
import type { ImmutableArtifactStore, JsonlEventStore } from "../storage.ts";
import {
  LangGraphWorkflowOrchestrator,
  VerificationRunnerAdapter,
  type WorkflowOrchestrator,
  WorkflowRuntimeCoordinator,
} from "../team/index.ts";
import { TrackerSynchronizer } from "../tracker/synchronizer.ts";
import type { Tracker } from "../tracker/tracker.ts";
import { executeCommand } from "./commands.ts";
import { EventLog } from "./event-log.ts";
import {
  recordAttempt,
  recordExecutionActivity,
  recordExecutionSession,
  recordIntervention,
  recordReview,
  recordTask,
  recordVerification,
  recordWorkspace,
} from "./recording.ts";

export interface RuntimeServiceOptions {
  dataDir: string;
  endpoint?: string;
  runtimeId?: string;
  now?: () => Date;
  idFactory?: () => string;
  eventStore?: JsonlEventStore;
  artifactStore?: ImmutableArtifactStore;
  workflowOrchestrator?: WorkflowOrchestrator;
  defaultOrchestration?: OrchestrationMode;
  sessionHistory?: (attempt: AttemptSnapshot) => Promise<ExecutionSession | null>;
  tracker?: Tracker;
}

export class RuntimeService {
  readonly #log: EventLog;
  readonly #now: () => Date;
  readonly #runtimeId: string;
  readonly #startedAt: string;
  #endpoint: string;
  readonly #workflowOrchestrator: WorkflowOrchestrator;
  readonly #workflowCoordinator: WorkflowRuntimeCoordinator;
  #defaultOrchestration: OrchestrationMode | undefined;
  readonly #sessionHistory: RuntimeServiceOptions["sessionHistory"];
  #tracker: Tracker | undefined;
  #trackerSynchronizer: TrackerSynchronizer | undefined;

  constructor(options: RuntimeServiceOptions) {
    this.#now = options.now ?? (() => new Date());
    const idFactory = options.idFactory ?? randomUUID;
    this.#log = new EventLog({
      dataDir: options.dataDir,
      now: this.#now,
      idFactory,
      ...(options.eventStore ? { eventStore: options.eventStore } : {}),
      ...(options.artifactStore ? { artifactStore: options.artifactStore } : {}),
    });
    this.#runtimeId = options.runtimeId?.trim() || `runtime:${idFactory()}`;
    this.#startedAt = this.#now().toISOString();
    this.#endpoint = options.endpoint ?? "http://127.0.0.1:0";
    this.#workflowOrchestrator =
      options.workflowOrchestrator ??
      new LangGraphWorkflowOrchestrator({
        now: this.#now,
        verification: new VerificationRunnerAdapter({
          artifactRoot: resolve(options.dataDir, "artifacts"),
        }),
        checkpointPath: resolve(options.dataDir, "orchestration", "checkpoints.sqlite"),
        orchestration: loadOrchestrationDefinitionSync().binding,
      });
    this.#workflowCoordinator = new WorkflowRuntimeCoordinator({
      idFactory,
      now: this.#now,
      ...(options.defaultOrchestration
        ? { defaultOrchestration: options.defaultOrchestration }
        : {}),
    });
    this.#defaultOrchestration = options.defaultOrchestration;
    this.#sessionHistory = options.sessionHistory;
    this.#tracker = options.tracker;
    this.#trackerSynchronizer = this.#createTrackerSynchronizer(options.tracker);
  }

  async start(): Promise<void> {
    await this.#log.start();
    await this.#restoreSessions();
  }

  async #restoreSessions(): Promise<void> {
    if (!this.#sessionHistory) return;
    const attempts = this.#log.projection.snapshot(this.#connection("online")).attempts;
    for (const attempt of attempts) {
      if (!attempt.providerSession || this.#log.projection.attemptDetail(attempt.id)?.session) {
        continue;
      }
      try {
        const session = await this.#sessionHistory(attempt);
        if (session?.attemptId === attempt.id) await recordExecutionSession(this.#log, session);
      } catch {
        // Provider history can be imported later; local event replay must remain available offline.
      }
    }
  }

  async stop(): Promise<void> {
    await this.#trackerSynchronizer?.stop();
    this.#log.markOffline();
  }

  setEndpoint(endpoint: string): void {
    this.#endpoint = endpoint;
  }

  markOffline(): void {
    this.#log.markOffline();
  }

  snapshot(): RuntimeSnapshot {
    this.#log.requireStarted();
    return this.#log.projection.snapshot(this.#connection("online"));
  }

  async listModels(): Promise<CodexModel[]> {
    this.#log.requireStarted();
    if (!this.#defaultOrchestration?.listModels) {
      throw new RuntimeError("unsupported", "Codex model listing is not configured");
    }
    return this.#defaultOrchestration.listModels();
  }

  health(): RuntimeHealth {
    this.#log.requireStarted();
    return RuntimeHealthSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      status: "ok",
      runtime: this.#connection("online"),
      process: {
        status: "running",
        pid: process.pid,
        nodeVersion: process.version,
        startedAt: this.#startedAt,
        uptimeSeconds: process.uptime(),
      },
    });
  }

  events(afterSequence = 0): RuntimeEvent[] {
    return this.#log.listAfter(afterSequence);
  }

  attemptDetail(attemptId: string) {
    this.#log.requireStarted();
    return this.#log.projection.attemptDetail(attemptId.trim());
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.#log.subscribe(listener);
  }

  recordTask(taskInput: TaskSummary, idempotencyKey?: string): Promise<RuntimeEvent> {
    return recordTask(this.#log, taskInput, idempotencyKey);
  }

  recordAttempt(
    attemptInput: AttemptSnapshot,
    options: { workspace?: WorkspaceReference; idempotencyKey?: string } = {},
  ): Promise<RuntimeEvent> {
    return recordAttempt(this.#log, attemptInput, options);
  }

  recordExecutionActivity(activityInput: ExecutionActivity): Promise<RuntimeEvent> {
    return recordExecutionActivity(this.#log, activityInput);
  }

  recordExecutionSession(sessionInput: ExecutionSession): Promise<RuntimeEvent> {
    return recordExecutionSession(this.#log, sessionInput);
  }

  recordWorkspace(
    workspaceInput: WorkspaceReference,
    idempotencyKey?: string,
  ): Promise<RuntimeEvent> {
    return recordWorkspace(this.#log, workspaceInput, idempotencyKey);
  }

  recordVerification(
    verificationInput: VerificationResult,
    options: { artifact?: string | Uint8Array; idempotencyKey?: string } = {},
  ): Promise<RuntimeEvent> {
    return recordVerification(this.#log, verificationInput, options);
  }

  recordReview(reviewInput: ReviewDecision, idempotencyKey?: string): Promise<RuntimeEvent> {
    return recordReview(this.#log, reviewInput, idempotencyKey);
  }

  recordIntervention(
    interventionInput: Intervention,
    idempotencyKey?: string,
  ): Promise<RuntimeEvent> {
    return recordIntervention(this.#log, interventionInput, idempotencyKey);
  }

  async refreshTracker(signal?: AbortSignal): Promise<RuntimeSnapshot> {
    if (!this.#trackerSynchronizer) {
      throw new Error("Tracker full synchronization is not configured");
    }
    await this.#trackerSynchronizer.refresh(signal);
    return this.snapshot();
  }

  async configureTracker(tracker: Tracker | undefined): Promise<void> {
    await this.#trackerSynchronizer?.stop();
    this.#tracker = tracker;
    this.#trackerSynchronizer = this.#createTrackerSynchronizer(tracker);
  }

  setDefaultOrchestration(orchestration: OrchestrationMode | undefined): void {
    this.#defaultOrchestration = orchestration;
    this.#workflowCoordinator.setDefaultOrchestration(orchestration);
  }

  execute(commandInput: unknown): Promise<RuntimeCommandResult> {
    const trackerSynchronizer = this.#trackerSynchronizer;
    return executeCommand(
      this.#log,
      commandInput,
      () => this.snapshot(),
      this.#now,
      {
        orchestrator: this.#workflowOrchestrator,
        handle: this.#workflowCoordinator.handle,
      },
      this.#defaultOrchestration,
      this.#tracker,
      trackerSynchronizer ? () => trackerSynchronizer.refresh() : undefined,
    );
  }

  #createTrackerSynchronizer(tracker: Tracker | undefined): TrackerSynchronizer | undefined {
    if (!tracker?.listTasks) return undefined;
    return new TrackerSynchronizer({
      log: this.#log,
      tracker,
      ...(this.#defaultOrchestration?.tick
        ? {
            reconcile: (tasks) =>
              this.#defaultOrchestration?.tick?.({ tasks, log: this.#log }) ?? Promise.resolve(),
          }
        : {}),
    });
  }

  #connection(status: RuntimeConnection["status"]): RuntimeConnection {
    return RuntimeConnectionSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      status,
      runtimeId: this.#runtimeId,
      endpoint: this.#endpoint,
      startedAt: this.#startedAt,
      lastEventSequence: this.#log.lastSequence,
    });
  }
}

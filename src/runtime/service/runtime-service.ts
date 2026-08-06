import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  type AttemptSnapshot,
  CONTRACT_SCHEMA_VERSION,
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
import type { ImmutableArtifactStore, JsonlEventStore } from "../storage.ts";
import { loadOrchestrationDefinitionSync } from "../orchestration/index.ts";
import {
  LangGraphWorkflowOrchestrator,
  VerificationRunnerAdapter,
  type WorkflowOrchestrator,
  WorkflowRuntimeCoordinator,
} from "../team/index.ts";
import { executeCommand } from "./commands.ts";
import { EventLog } from "./event-log.ts";
import {
  recordAttempt,
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
}

export class RuntimeService {
  readonly #log: EventLog;
  readonly #now: () => Date;
  readonly #runtimeId: string;
  readonly #startedAt: string;
  #endpoint: string;
  readonly #workflowOrchestrator: WorkflowOrchestrator;
  readonly #workflowCoordinator: WorkflowRuntimeCoordinator;

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
    this.#workflowCoordinator = new WorkflowRuntimeCoordinator({ idFactory, now: this.#now });
  }

  async start(): Promise<void> {
    await this.#log.start();
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

  execute(commandInput: unknown): Promise<RuntimeCommandResult> {
    return executeCommand(this.#log, commandInput, () => this.snapshot(), this.#now, {
      orchestrator: this.#workflowOrchestrator,
      handle: this.#workflowCoordinator.handle,
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

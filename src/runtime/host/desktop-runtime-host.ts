import { randomUUID } from "node:crypto";

import {
  CONTRACT_SCHEMA_VERSION,
  type CodexModel,
  PROJECTION_SCHEMA_VERSION,
  type RuntimeAttemptDetail,
  type RuntimeCommand,
  type RuntimeCommandResult,
  RuntimeCommandResultSchema,
  RuntimeCommandSchema,
  type RuntimeConnection,
  RuntimeConnectionSchema,
  type RuntimeEvent,
  type RuntimeHealth,
  RuntimeHealthSchema,
  type RuntimeProject,
  type RuntimeSnapshot,
  RuntimeSnapshotSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type { RuntimeControlPlane } from "../service/control-plane.ts";
import { commandMessage } from "../service/helpers.ts";
import type { RuntimeService } from "../service/runtime-service.ts";
import type {
  ApplicationData,
  ProjectDataLayout,
  RegisterProjectInput,
} from "./application-data.ts";
import { ProjectPollingCoordinator } from "./polling-coordinator.ts";

export interface DesktopProjectRuntimeInput {
  project: RuntimeProject;
  layout: ProjectDataLayout;
}

export interface DesktopProjectRuntime {
  runtime: RuntimeService;
  pollingIntervalMs?: number;
}

export interface DesktopRuntimeHostOptions {
  applicationData: ApplicationData;
  createRuntime: (
    input: DesktopProjectRuntimeInput,
  ) => DesktopProjectRuntime | Promise<DesktopProjectRuntime>;
  runtimeId?: string;
  now?: () => Date;
}

interface ManagedProjectRuntime {
  project: RuntimeProject;
  runtime: RuntimeService;
  unsubscribe: () => void;
  unregisterPolling: () => void;
}

/** Desktop-only multi-project shell. Every child remains one project-scoped Symphony runtime. */
export class DesktopRuntimeHost implements RuntimeControlPlane {
  readonly #applicationData: ApplicationData;
  readonly #createRuntime: DesktopRuntimeHostOptions["createRuntime"];
  readonly #runtimeId: string;
  readonly #startedAt: string;
  readonly #projects = new Map<string, ManagedProjectRuntime>();
  readonly #polling = new ProjectPollingCoordinator();
  readonly #events: RuntimeEvent[] = [];
  readonly #listeners = new Set<(event: RuntimeEvent) => void>();
  #endpoint = "http://127.0.0.1:0";
  #started = false;

  constructor(options: DesktopRuntimeHostOptions) {
    this.#applicationData = options.applicationData;
    this.#createRuntime = options.createRuntime;
    this.#runtimeId = options.runtimeId?.trim() || `runtime:${randomUUID()}`;
    this.#startedAt = (options.now ?? (() => new Date()))().toISOString();
  }

  async start(): Promise<void> {
    if (this.#started) return;
    await this.#applicationData.initialize();
    this.#events.splice(0);
    for (const project of await this.#applicationData.listProjects()) {
      await this.#startProject(project);
    }
    await this.#polling.start();
    this.#started = true;
  }

  async stop(): Promise<void> {
    await this.#polling.stop();
    await Promise.all(
      [...this.#projects.values()].map(async ({ runtime, unsubscribe, unregisterPolling }) => {
        unregisterPolling();
        unsubscribe();
        await runtime.stop();
      }),
    );
    this.#projects.clear();
    this.#started = false;
  }

  setEndpoint(endpoint: string): void {
    this.#endpoint = endpoint;
    for (const { runtime } of this.#projects.values()) runtime.setEndpoint(endpoint);
  }

  listProjects(): Promise<RuntimeProject[]> {
    return this.#applicationData.listProjects();
  }

  async addProject(input: RegisterProjectInput): Promise<RuntimeProject> {
    const project = await this.#applicationData.registerProject(input);
    if (this.#started && !this.#projects.has(project.id)) {
      await this.#startProject(project);
      await this.#polling.refresh(project.id);
    }
    return project;
  }

  async removeProject(projectId: string): Promise<RuntimeProject[]> {
    const managed = this.#projects.get(projectId);
    if (managed) {
      managed.unregisterPolling();
      managed.unsubscribe();
      await managed.runtime.stop();
      this.#projects.delete(projectId);
    }
    return this.#applicationData.removeProject(projectId);
  }

  snapshot(): RuntimeSnapshot {
    this.#requireStarted();
    const entries = [...this.#projects.values()].map(({ project, runtime }) => ({
      project,
      snapshot: runtime.snapshot(),
    }));
    return RuntimeSnapshotSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      projectionVersion: PROJECTION_SCHEMA_VERSION,
      runtime: this.#connection("online"),
      tasks: entries.flatMap(({ project, snapshot }) =>
        snapshot.tasks.map((task) => ({ ...task, projectId: project.id })),
      ),
      attempts: entries.flatMap(({ snapshot }) => snapshot.attempts),
      verifications: entries.flatMap(({ snapshot }) => snapshot.verifications),
      reviews: entries.flatMap(({ snapshot }) => snapshot.reviews),
      interventions: entries.flatMap(({ snapshot }) => snapshot.interventions),
      teamRuns: entries.flatMap(({ snapshot }) => snapshot.teamRuns),
      agentRuns: entries.flatMap(({ snapshot }) => snapshot.agentRuns),
      teamEvents: entries.flatMap(({ snapshot }) => snapshot.teamEvents),
    });
  }

  health(): RuntimeHealth {
    this.#requireStarted();
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
    this.#requireStarted();
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new RuntimeError("invalid_request", "Event sequence must be a non-negative integer");
    }
    return this.#events.filter((event) => event.sequence > afterSequence);
  }

  async attemptDetail(attemptId: string): Promise<RuntimeAttemptDetail | null> {
    this.#requireStarted();
    const matches = (
      await Promise.all(
        [...this.#projects.values()].map(({ runtime }) => runtime.attemptDetail(attemptId)),
      )
    ).filter((detail): detail is RuntimeAttemptDetail => detail !== null);
    if (matches.length > 1) throw new RuntimeError("conflict", "Attempt identity is ambiguous");
    return matches[0] ?? null;
  }

  async reviewTarget(taskId: string, projectId?: string): Promise<{ url: string }> {
    this.#requireStarted();
    if (projectId) {
      const runtime = this.#projects.get(projectId)?.runtime;
      if (!runtime) throw new RuntimeError("not_found", `Project ${projectId} was not found`);
      return runtime.reviewTarget(taskId);
    }
    const matches = [...this.#projects.values()].filter(({ runtime }) =>
      runtime.snapshot().tasks.some((task) => task.id === taskId),
    );
    if (matches.length > 1) {
      throw new RuntimeError("conflict", "Task project is ambiguous; projectId is required");
    }
    if (matches[0]) return matches[0].runtime.reviewTarget(taskId);
    if (this.#projects.size === 1) {
      const only = this.#projects.values().next().value;
      if (only) return only.runtime.reviewTarget(taskId);
    }
    throw new RuntimeError("invalid_request", "projectId is required to open a review target");
  }

  async listModels(projectId?: string): Promise<CodexModel[]> {
    this.#requireStarted();
    const resolvedProjectId =
      projectId ??
      (this.#projects.size === 1 ? (this.#projects.keys().next().value as string) : undefined);
    if (!resolvedProjectId) {
      throw new RuntimeError("invalid_request", "projectId is required to list Codex models");
    }
    const runtime = this.#projects.get(resolvedProjectId)?.runtime;
    if (!runtime) throw new RuntimeError("not_found", `Project ${resolvedProjectId} was not found`);
    return runtime.listModels();
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#requireStarted();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async execute(commandInput: unknown): Promise<RuntimeCommandResult> {
    this.#requireStarted();
    const parsed = RuntimeCommandSchema.safeParse(commandInput);
    if (!parsed.success) {
      throw new RuntimeError("invalid_request", "Runtime command has an invalid shape");
    }
    const command = parsed.data;
    const projectId = this.#route(command);
    const duplicate = this.#events.find(
      ({ event }) => event.idempotencyKey === command.idempotencyKey,
    );
    if (duplicate) {
      if (duplicate.event.projectId !== projectId) {
        throw new RuntimeError("conflict", "Idempotency key belongs to another project");
      }
      return RuntimeCommandResultSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        accepted: true,
        eventSequence: this.#events.length,
        message: commandMessage(command),
        snapshot: this.snapshot(),
      });
    }
    if (
      command.expectedEventSequence !== undefined &&
      command.expectedEventSequence !== this.#events.length
    ) {
      throw new RuntimeError("conflict", "Runtime projection changed before this command was read");
    }
    const runtime = this.#projects.get(projectId)?.runtime;
    if (!runtime) throw new RuntimeError("not_found", `Project ${projectId} was not found`);
    const result = await runtime.execute({
      ...command,
      ...(command.expectedEventSequence === undefined
        ? {}
        : { expectedEventSequence: runtime.snapshot().runtime.lastEventSequence }),
    });
    return RuntimeCommandResultSchema.parse({
      ...result,
      eventSequence: this.#events.length,
      snapshot: this.snapshot(),
    });
  }

  async #startProject(project: RuntimeProject): Promise<void> {
    const created = await this.#createRuntime({
      project,
      layout: this.#applicationData.project(project.id),
    });
    const { runtime } = created;
    runtime.setEndpoint(this.#endpoint);
    await runtime.start();
    for (const event of runtime.events()) this.#appendProjectEvent(project.id, event);
    const unsubscribe = runtime.subscribe((event) => this.#appendProjectEvent(project.id, event));
    const unregisterPolling =
      created.pollingIntervalMs === undefined
        ? () => undefined
        : this.#polling.register({
            projectId: project.id,
            intervalMs: created.pollingIntervalMs,
            poll: async (signal) => {
              await runtime.refreshTracker(signal);
            },
          });
    this.#projects.set(project.id, { project, runtime, unsubscribe, unregisterPolling });
  }

  #appendProjectEvent(projectId: string, input: RuntimeEvent): void {
    const event: RuntimeEvent = {
      sequence: this.#events.length + 1,
      event: { ...input.event, projectId },
    };
    this.#events.push(event);
    for (const listener of this.#listeners) listener(event);
  }

  #route(command: RuntimeCommand): string {
    const explicit =
      command.projectId ?? (command.kind === "start_run" ? command.task.projectId : undefined);
    if (explicit) return explicit;
    const matches = [...this.#projects.entries()].filter(([, { runtime }]) =>
      commandBelongsToSnapshot(command, runtime.snapshot()),
    );
    if (matches.length === 1) return matches[0]?.[0] ?? "";
    if (matches.length > 1) {
      throw new RuntimeError("conflict", "Command project is ambiguous; projectId is required");
    }
    if (this.#projects.size === 1) return this.#projects.keys().next().value as string;
    throw new RuntimeError("invalid_request", "projectId is required for this command");
  }

  #connection(status: RuntimeConnection["status"]): RuntimeConnection {
    return RuntimeConnectionSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      status,
      runtimeId: this.#runtimeId,
      endpoint: this.#endpoint,
      startedAt: this.#startedAt,
      lastEventSequence: this.#events.length,
    });
  }

  #requireStarted(): void {
    if (!this.#started) throw new RuntimeError("conflict", "Runtime has not started");
  }
}

function commandBelongsToSnapshot(command: RuntimeCommand, snapshot: RuntimeSnapshot): boolean {
  if ("taskId" in command) return snapshot.tasks.some((task) => task.id === command.taskId);
  if (command.kind === "start_run") {
    return snapshot.tasks.some((task) => task.id === command.task.id);
  }
  if ("attemptId" in command) {
    return snapshot.attempts.some((attempt) => attempt.id === command.attemptId);
  }
  if ("interventionId" in command) {
    return snapshot.interventions.some(
      (intervention) => intervention.id === command.interventionId,
    );
  }
  if ("teamRunId" in command) {
    return snapshot.teamRuns.some((run) => run.id === command.teamRunId);
  }
  return false;
}

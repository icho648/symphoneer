import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Agent, AgentTool, Session } from "@earendil-works/pi-agent-core";
import type { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { getSupportedThinkingLevels, type Models, type TSchema } from "@earendil-works/pi-ai";
import type {
  SqliteSessionMetadata,
  SqliteSessionRepository,
} from "@earendil-works/pi-session-backend-sqlite-node";
import { createHttpRuntimeClient, type RuntimeClient } from "@symphoneer/runtime-client";
import { executeRuntimeTool, RUNTIME_TOOLS } from "@symphoneer/runtime-tools";
import { z } from "zod";
import {
  type AssistantEvent,
  type AssistantSession,
  type AssistantSessionMetadata,
  type AssistantSessionSummary,
  type AssistantStatus,
  type CreateAssistantSessionInput,
  CreateAssistantSessionInputSchema,
} from "../assistant-client/index.ts";
import {
  type AssistantConfig,
  buildSystemPrompt,
  readProductMetadata,
  resolveAssistantConfig,
  withoutUndefined,
} from "./config.ts";
import { AssistantServiceError, handleAssistantHttp } from "./http.ts";
import {
  CredentialStreamRedactor,
  normalizeAgentEvent,
  redactCredentialText,
  redactCredentialValue,
  repairInterruptedToolCalls,
  sanitizeAgentMessage,
  toAssistantMessage,
} from "./messages.ts";

export class PiAssistantService {
  readonly #assistantDir: string;
  readonly #config: AssistantConfig | undefined;
  readonly #initialStatus: AssistantStatus;
  readonly #providedModels: Models | undefined;
  #runtimeClient: (() => RuntimeClient) | undefined;
  #env: NodeExecutionEnv | undefined;
  #modelsPromise: Promise<Models> | undefined;
  #repoPromise: Promise<SqliteSessionRepository> | undefined;
  readonly #sessions = new Map<string, Session<SqliteSessionMetadata>>();
  readonly #agents = new Map<string, { agent: Agent; unsubscribePersistence: () => void }>();
  readonly #runs = new Map<string, { agent: Agent; emit: (event: AssistantEvent) => void }>();
  readonly #approvals = new Map<
    string,
    { sessionId: string; resolve: (approved: boolean) => void }
  >();

  constructor(options: {
    dataDir: string;
    env?: NodeJS.ProcessEnv;
    models?: Models;
    runtimeClient?: () => RuntimeClient;
  }) {
    this.#assistantDir = join(options.dataDir, "assistant");
    this.#providedModels = options.models;
    this.#runtimeClient = options.runtimeClient;
    const resolved = resolveAssistantConfig(options.env ?? process.env, options.models);
    this.#config = resolved.config;
    this.#initialStatus = resolved.status;
  }

  connectRuntime(options: { baseUrl: string; token?: string }): void {
    const client = createHttpRuntimeClient(options);
    this.#runtimeClient = () => client;
  }

  async status(): Promise<AssistantStatus> {
    if (!this.#config) return this.#initialStatus;
    try {
      const models = await this.#models();
      const available = models.getModels(this.#config.provider).map((model) => ({
        id: model.id,
        name: model.name,
        thinkingLevels: getSupportedThinkingLevels(model),
      }));
      const selected = available.find((model) => model.id === this.#config?.model);
      if (!selected) return { state: "invalid_config", message: "Assistant model was not found" };
      if (!selected.thinkingLevels.includes(this.#config.thinkingLevel)) {
        return {
          state: "invalid_config",
          message: "Assistant thinking level is not supported by the selected model",
        };
      }
      return {
        state: "ready",
        provider: this.#config.provider,
        model: this.#config.model,
        thinkingLevel: this.#config.thinkingLevel,
        models: available,
      };
    } catch {
      return { state: "provider_failure", message: "Assistant provider failed to initialize" };
    }
  }

  async listSessions(): Promise<AssistantSessionSummary[]> {
    const metadata = await (await this.#repo()).list({ cwd: this.#assistantDir });
    const summaries = await Promise.all(metadata.map((item) => this.#summary(item)));
    return summaries.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async createSession(input: CreateAssistantSessionInput): Promise<AssistantSessionSummary> {
    const status = await this.status();
    if (status.state !== "ready") {
      throw new AssistantServiceError(
        503,
        status.state,
        "message" in status ? status.message : "Assistant provider configuration is required",
      );
    }
    const config = this.#requireReady();
    const parsed = CreateAssistantSessionInputSchema.parse(input);
    const model = status.models.find((option) => option.id === (parsed.model ?? config.model));
    if (!model)
      throw new AssistantServiceError(400, "invalid_request", "Assistant model was not found");
    const thinkingLevel = parsed.thinkingLevel ?? config.thinkingLevel;
    if (!model.thinkingLevels.includes(thinkingLevel)) {
      throw new AssistantServiceError(
        400,
        "invalid_request",
        "Assistant thinking level is not supported by the selected model",
      );
    }
    const metadata: AssistantSessionMetadata = {
      ...withoutUndefined({
        projectId: parsed.projectId,
        taskId: parsed.taskId,
        attemptId: parsed.attemptId,
        locale: parsed.locale,
      }),
      createdBy: parsed.createdBy,
      schemaVersion: 1,
    };
    const session = await (await this.#repo()).create({
      cwd: this.#assistantDir,
      metadata: { ...metadata, provider: config.provider, model: model.id, thinkingLevel },
    });
    const stored = await session.getMetadata();
    this.#sessions.set(stored.id, session);
    if (parsed.name) await session.setName(parsed.name);
    return this.#summary(await this.#metadata(stored.id));
  }

  async openSession(id: string): Promise<AssistantSession> {
    const metadata = await this.#metadata(id);
    const session = await this.#open(metadata);
    const summary = await this.#summary(metadata);
    const entries = await session.findEntries({ type: "message", order: "oldestFirst" });
    const originalMessages = entries.flatMap((entry) =>
      entry.type === "message" ? [entry.message] : [],
    );
    const messages = await repairInterruptedToolCalls(session, originalMessages);
    const durableEntries =
      messages.length === originalMessages.length
        ? entries
        : await session.findEntries({ type: "message", order: "oldestFirst" });
    return {
      ...summary,
      messages: messages.flatMap((message, index) => {
        const projected = toAssistantMessage(
          durableEntries[index]?.type === "message" ? durableEntries[index].id : `message:${index}`,
          message,
        );
        return projected ? [projected] : [];
      }),
    };
  }

  async renameSession(id: string, name: string): Promise<AssistantSessionSummary> {
    const trimmed = name.trim();
    if (!trimmed) throw new AssistantServiceError(400, "invalid_request", "Name is required");
    const metadata = await this.#metadata(id);
    await (await this.#open(metadata)).setName(trimmed);
    return this.#summary(await this.#metadata(id));
  }

  async deleteSession(id: string): Promise<void> {
    const metadata = await this.#metadata(id);
    const agent = this.#agents.get(id);
    agent?.agent.abort();
    await agent?.agent.waitForIdle();
    agent?.unsubscribePersistence();
    this.#agents.delete(id);
    this.#runs.delete(id);
    this.#expireApprovals(id);
    this.#sessions.delete(id);
    await (await this.#repo()).delete(metadata);
  }

  async run(id: string, prompt: string): Promise<ReadableStream<AssistantEvent>> {
    const trimmed = prompt.trim();
    if (!trimmed) throw new AssistantServiceError(400, "invalid_request", "Prompt is required");
    if (this.#runs.has(id)) {
      throw new AssistantServiceError(409, "conflict", "Session already has an active run");
    }
    const agent = await this.#agent(id);
    let controller: ReadableStreamDefaultController<AssistantEvent> | undefined;
    let closed = false;
    let unsubscribe = () => {};
    const credential = this.#requireReady().apiKey;
    const textRedactor = new CredentialStreamRedactor(credential);
    const finish = (event: AssistantEvent) => {
      if (closed) return;
      closed = true;
      const tail = textRedactor.flush();
      if (tail) controller?.enqueue({ type: "text_delta", delta: tail });
      controller?.enqueue(event);
      controller?.close();
      unsubscribe();
      this.#runs.delete(id);
      this.#expireApprovals(id);
    };
    const stream = new ReadableStream<AssistantEvent>({
      start(value) {
        controller = value;
      },
      cancel: () => agent.abort(),
    });
    this.#runs.set(id, { agent, emit: (event) => controller?.enqueue(event) });
    unsubscribe = agent.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        const delta = textRedactor.push(event.assistantMessageEvent.delta);
        if (delta) controller?.enqueue({ type: "text_delta", delta });
        return;
      }
      const normalized = normalizeAgentEvent(event, credential);
      if (normalized) controller?.enqueue(normalized);
      if (event.type !== "agent_end") return;
      const last = [...event.messages].reverse().find((message) => message.role === "assistant");
      if (last?.role === "assistant" && last.stopReason === "aborted") finish({ type: "aborted" });
      else if (last?.role === "assistant" && last.stopReason === "error") {
        finish({
          type: "error",
          message: redactCredentialText(last.errorMessage ?? "Provider request failed", credential),
        });
      } else finish({ type: "completed" });
    });
    void agent.prompt(trimmed).catch((error: unknown) => {
      finish({
        type: "error",
        message: redactCredentialText(
          error instanceof Error && error.message ? error.message : "Assistant run failed",
          credential,
        ),
      });
    });
    return stream;
  }

  abort(id: string): boolean {
    const run = this.#runs.get(id);
    if (!run) return false;
    run.agent.abort();
    this.#expireApprovals(id);
    return true;
  }

  respondApproval(sessionId: string, approvalId: string, approved: boolean): void {
    const approval = this.#approvals.get(approvalId);
    if (!approval || approval.sessionId !== sessionId) {
      throw new AssistantServiceError(404, "not_found", "Approval request was not found");
    }
    approval.resolve(approved);
  }

  readonly handle = (
    request: Parameters<typeof handleAssistantHttp>[1],
    response: Parameters<typeof handleAssistantHttp>[2],
    url: Parameters<typeof handleAssistantHttp>[3],
  ) => handleAssistantHttp(this, request, response, url);

  async close(): Promise<void> {
    for (const { agent } of this.#agents.values()) agent.abort();
    await Promise.all([...this.#agents.values()].map(({ agent }) => agent.waitForIdle()));
    for (const { unsubscribePersistence } of this.#agents.values()) unsubscribePersistence();
    this.#agents.clear();
    this.#runs.clear();
    this.#expireApprovals();
    this.#sessions.clear();
    const repo = await this.#repoPromise?.catch(() => undefined);
    this.#repoPromise = undefined;
    await repo?.close();
    await this.#env?.cleanup();
    this.#env = undefined;
  }

  async #repo(): Promise<SqliteSessionRepository> {
    this.#repoPromise ??= (async () => {
      await mkdir(this.#assistantDir, { recursive: true });
      const [{ NodeExecutionEnv }, { createNodeSqliteFactory, SqliteSessionRepository }] =
        await Promise.all([
          import("@earendil-works/pi-agent-core/node"),
          import("@earendil-works/pi-session-backend-sqlite-node"),
        ]);
      this.#env = new NodeExecutionEnv({ cwd: this.#assistantDir });
      return new SqliteSessionRepository({
        env: this.#env,
        sqlite: createNodeSqliteFactory(),
        databasePath: join(this.#assistantDir, "sessions.sqlite"),
      });
    })();
    return this.#repoPromise;
  }

  async #models(): Promise<Models> {
    if (this.#providedModels) return this.#providedModels;
    this.#modelsPromise ??= import("@earendil-works/pi-ai/providers/all").then(
      ({ builtinModels }) => builtinModels(),
    );
    return this.#modelsPromise;
  }

  async #agent(id: string): Promise<Agent> {
    const current = this.#agents.get(id);
    if (current) return current.agent;
    const config = this.#requireReady();
    const metadata = await this.#metadata(id);
    const product = readProductMetadata(metadata, config.thinkingLevel);
    if (product.provider !== config.provider) {
      throw new AssistantServiceError(
        503,
        "invalid_config",
        "Session provider does not match current Assistant config",
      );
    }
    const models = await this.#models();
    const model = models.getModel(product.provider, product.model);
    if (!model) {
      throw new AssistantServiceError(503, "invalid_config", "Assistant model was not found");
    }
    if (!getSupportedThinkingLevels(model).includes(product.thinkingLevel)) {
      throw new AssistantServiceError(
        503,
        "invalid_config",
        "Session thinking level is not supported by the selected model",
      );
    }
    const session = await this.#open(metadata);
    const entries = await session.findEntries({ type: "message", order: "oldestFirst" });
    const messages = await repairInterruptedToolCalls(
      session,
      entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
    );
    const { Agent } = await import("@earendil-works/pi-agent-core");
    const agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(product.metadata),
        model,
        messages,
        thinkingLevel: product.thinkingLevel,
        tools: this.#runtimeTools(id),
      },
      streamFn: (selectedModel, context, options) =>
        models.streamSimple(selectedModel, context, options),
      getApiKey: (provider) => (provider === config.provider ? config.apiKey : undefined),
      sessionId: id,
      toolExecution: "sequential",
    });
    const unsubscribePersistence = agent.subscribe(async (event) => {
      if (event.type === "message_end") {
        const durableMessage = sanitizeAgentMessage(event.message, config.apiKey);
        await session.appendMessage(durableMessage);
      }
    });
    this.#agents.set(id, { agent, unsubscribePersistence });
    return agent;
  }

  #runtimeTools(sessionId: string): AgentTool[] {
    return RUNTIME_TOOLS.map((tool) => ({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.inputSchema) as unknown as TSchema,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        if (tool.approval === "required") {
          await this.#waitForApproval(sessionId, toolCallId, tool.name, params, signal);
        }
        const runtime = this.#runtimeClient?.();
        if (!runtime) throw new Error("Runtime client is unavailable");
        const result = await executeRuntimeTool(runtime, tool.name, params, {
          confirmed: tool.approval === "required",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }));
  }

  #waitForApproval(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    const approvalId = randomUUID();
    const run = this.#runs.get(sessionId);
    if (!run) return Promise.reject(new Error("Assistant run is not active"));
    run.emit({
      type: "approval_required",
      approvalId,
      toolCallId,
      toolName,
      input: redactCredentialValue(input, this.#requireReady().apiKey),
    });
    return new Promise<void>((resolve, reject) => {
      const finish = (approved: boolean, message = "Tool mutation was rejected") => {
        this.#approvals.delete(approvalId);
        signal?.removeEventListener("abort", onAbort);
        if (approved) resolve();
        else reject(new Error(message));
      };
      const onAbort = () => finish(false, "Assistant run was aborted");
      this.#approvals.set(approvalId, { sessionId, resolve: (approved) => finish(approved) });
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  #expireApprovals(sessionId?: string): void {
    for (const [id, approval] of this.#approvals) {
      if (sessionId && approval.sessionId !== sessionId) continue;
      this.#approvals.delete(id);
      approval.resolve(false);
    }
  }

  async #metadata(id: string): Promise<SqliteSessionMetadata> {
    const metadata = (await (await this.#repo()).list({ cwd: this.#assistantDir })).find(
      (item) => item.id === id,
    );
    if (!metadata) throw new AssistantServiceError(404, "not_found", "Session was not found");
    return metadata;
  }

  async #open(metadata: SqliteSessionMetadata): Promise<Session<SqliteSessionMetadata>> {
    const current = this.#sessions.get(metadata.id);
    if (current) return current;
    const session = await (await this.#repo()).open(metadata);
    this.#sessions.set(metadata.id, session);
    return session;
  }

  async #summary(metadata: SqliteSessionMetadata): Promise<AssistantSessionSummary> {
    // ponytail: listing scans the newest official entry per session; replace only when the
    // backend exposes updatedAt in its read-only catalog projection.
    const session = await this.#open(metadata);
    const latest = await session.findEntry({ order: "newestFirst", limit: 1 });
    const product = readProductMetadata(metadata, this.#config?.thinkingLevel);
    return {
      id: metadata.id,
      ...(metadata.name ? { name: metadata.name } : {}),
      createdAt: metadata.createdAt,
      updatedAt: latest?.timestamp ?? metadata.createdAt,
      provider: product.provider,
      model: product.model,
      thinkingLevel: product.thinkingLevel,
      metadata: product.metadata,
    };
  }

  #requireReady(): AssistantConfig {
    if (!this.#config) {
      const message =
        "message" in this.#initialStatus
          ? this.#initialStatus.message
          : "Assistant provider configuration is required";
      throw new AssistantServiceError(503, this.#initialStatus.state, message);
    }
    return this.#config;
  }
}

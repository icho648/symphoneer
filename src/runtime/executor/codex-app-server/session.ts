import type { AgentRunRequest } from "../agent-runner.ts";

import { asRecord, stringField } from "./protocol.ts";
import type { CodexTransport } from "./transport.ts";

export async function startCodexTurn(
  transport: CodexTransport,
  request: AgentRunRequest,
  options: {
    approvalPolicy: "never" | "on-request" | "untrusted";
    sandbox: "danger-full-access" | "read-only" | "workspace-write";
  },
): Promise<{ threadId: string; turnId: string }> {
  await initializeCodexTransport(transport);
  const threadResponse = await transport.request(
    request.continuation ? "thread/resume" : "thread/start",
    request.continuation
      ? {
          threadId: request.threadId,
          cwd: request.workspace.path,
          runtimeWorkspaceRoots: [request.workspace.path],
          approvalPolicy: options.approvalPolicy,
          ...(request.model ? { model: request.model } : {}),
          ...(request.sandbox ? { sandbox: request.sandbox } : {}),
          excludeTurns: true,
        }
      : {
          cwd: request.workspace.path,
          runtimeWorkspaceRoots: [request.workspace.path],
          approvalPolicy: options.approvalPolicy,
          ...(request.model ? { model: request.model } : {}),
          sandbox: request.sandbox ?? options.sandbox,
          // Codex Desktop supplies this default in its client wrapper. Raw app-server callers must
          // send it or the desktop can read the Thread but rejects its route as an unowned session.
          threadSource: "user",
        },
  );
  const threadId = stringField(asRecord(threadResponse)?.thread, "id") ?? "";
  if (!threadId || (request.threadId && request.threadId !== threadId)) {
    throw new Error("Codex returned an invalid thread identity");
  }
  const turnResponse = await transport.request("turn/start", {
    threadId,
    input: [{ type: "text", text: request.prompt, text_elements: [] }],
    cwd: request.workspace.path,
    runtimeWorkspaceRoots: [request.workspace.path],
    approvalPolicy: options.approvalPolicy,
    ...(request.model ? { model: request.model } : {}),
    ...(request.effort ? { effort: request.effort } : {}),
  });
  const turnId = stringField(asRecord(turnResponse)?.turn, "id") ?? "";
  if (!turnId) throw new Error("Codex returned an invalid turn identity");
  return { threadId, turnId };
}

export async function initializeCodexTransport(transport: CodexTransport): Promise<void> {
  await transport.request("initialize", {
    clientInfo: { name: "symphoneer", title: "Symphoneer", version: "0.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  transport.notify("initialized");
}

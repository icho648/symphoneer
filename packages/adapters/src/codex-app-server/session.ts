import type { AgentRunRequest } from "@symphoneer/symphony-core";

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
  await transport.request("initialize", {
    clientInfo: { name: "symphoneer", title: "Symphoneer", version: "0.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  transport.notify("initialized");
  const threadResponse = await transport.request(
    request.continuation ? "thread/resume" : "thread/start",
    request.continuation
      ? {
          threadId: request.threadId,
          cwd: request.workspace.path,
          runtimeWorkspaceRoots: [request.workspace.path],
          approvalPolicy: options.approvalPolicy,
          sandbox: options.sandbox,
          excludeTurns: true,
        }
      : {
          cwd: request.workspace.path,
          runtimeWorkspaceRoots: [request.workspace.path],
          approvalPolicy: options.approvalPolicy,
          sandbox: options.sandbox,
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
  });
  const turnId = stringField(asRecord(turnResponse)?.turn, "id") ?? "";
  if (!turnId) throw new Error("Codex returned an invalid turn identity");
  return { threadId, turnId };
}

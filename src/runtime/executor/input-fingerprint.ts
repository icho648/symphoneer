import { createHash } from "node:crypto";

import type { AgentRunRequest } from "./agent-runner.ts";

export function fingerprint(request: AgentRunRequest): string {
  const promptDigest = createHash("sha256").update(request.prompt).digest("hex");
  return createHash("sha256")
    .update(
      JSON.stringify({
        attemptId: request.attemptId,
        taskId: request.task.id,
        taskUpdatedAt: request.task.updatedAt ?? null,
        workspaceId: request.workspace.id,
        repository: request.workspace.repository,
        branch: request.workspace.branch,
        gitHead: request.workspace.gitHead,
        worktreeFingerprint: request.workspace.worktreeFingerprint,
        continuation: request.continuation,
        threadId: request.threadId ?? null,
        promptDigest,
      }),
    )
    .digest("hex");
}

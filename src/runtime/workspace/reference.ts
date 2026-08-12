import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import {
  CONTRACT_SCHEMA_VERSION,
  type WorkspaceReference,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";

import type { WorkspaceReferenceInput } from "./types.ts";

export function workspaceKey(identifier: string): string {
  const issue = identifier.match(/^#([1-9]\d*)$/);
  if (issue) return `issue-${issue[1]}`;
  const sanitized = identifier.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  if (sanitized === identifier) return sanitized;
  const hash = createHash("sha256").update(identifier).digest("hex").slice(0, 16);
  return `${sanitized}-${hash}`;
}

export function workspaceAttemptKey(attemptId: string): string {
  return workspaceKey(attemptId.split(":").at(-1) ?? attemptId);
}

export function createWorkspaceReference(input: WorkspaceReferenceInput): WorkspaceReference {
  const root = resolve(input.root);
  const path = resolve(root, workspaceKey(input.identifier), workspaceAttemptKey(input.attemptId));
  const child = relative(root, path);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error(`Workspace path escapes its root: ${path}`);
  }

  return canonicalizeWorkspaceReference({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: `workspace:${input.attemptId}`,
    taskId: input.taskId,
    path,
    repository: input.repository,
    branch: input.branch,
    gitHead: null,
    worktreeFingerprint: null,
    host: input.host,
    state: "ready",
    ownerAttemptId: input.attemptId,
  });
}

export function canonicalizeWorkspaceReference(input: WorkspaceReference): WorkspaceReference {
  const workspace = WorkspaceReferenceSchema.parse(input);
  return WorkspaceReferenceSchema.parse({ ...workspace, path: resolve(workspace.path) });
}

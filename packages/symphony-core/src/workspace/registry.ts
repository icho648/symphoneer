import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { WorkspaceReference } from "@symphoneer/contracts";

import { WorkspaceError } from "./error.ts";
import { canonicalizeWorkspaceReference } from "./reference.ts";

const identity = (workspace: WorkspaceReference) => ({
  schemaVersion: workspace.schemaVersion,
  id: workspace.id,
  taskId: workspace.taskId,
  path: workspace.path,
  repository: workspace.repository,
  branch: workspace.branch,
  host: workspace.host,
});

export class WorkspaceRegistry {
  readonly #root: string;
  readonly #byId = new Map<string, WorkspaceReference>();
  readonly #byPath = new Map<string, string>();

  constructor(root: string) {
    this.#root = resolve(root);
  }

  register(workspace: WorkspaceReference): void {
    const registered = this.#byId.get(workspace.id);
    const pathOwner = this.#byPath.get(workspace.path);
    if (
      (registered && !isDeepStrictEqual(identity(registered), identity(workspace))) ||
      (registered &&
        (registered.state === "ready" || registered.state === "reserved") &&
        registered.ownerAttemptId !== workspace.ownerAttemptId) ||
      (pathOwner != null && pathOwner !== workspace.id)
    ) {
      throw new WorkspaceError(
        "workspace_identity_mismatch",
        `Workspace ${workspace.id} conflicts with the managed Workspace identity`,
      );
    }
    this.update(workspace);
    this.#byPath.set(workspace.path, workspace.id);
  }

  require(input: WorkspaceReference): WorkspaceReference {
    const workspace = canonicalizeWorkspaceReference(input);
    const child = relative(this.#root, workspace.path);
    if (!child || child.startsWith("..") || isAbsolute(child)) {
      throw new WorkspaceError(
        "workspace_outside_root",
        `Workspace path escapes its root: ${workspace.path}`,
      );
    }
    const registered = this.#byId.get(workspace.id);
    if (
      !registered ||
      !isDeepStrictEqual(registered, workspace) ||
      this.#byPath.get(workspace.path) !== workspace.id
    ) {
      throw new WorkspaceError(
        "workspace_identity_mismatch",
        `Workspace ${workspace.id} is not managed for Task ${workspace.taskId}`,
      );
    }
    return workspace;
  }

  update(workspace: WorkspaceReference): void {
    this.#byId.set(workspace.id, structuredClone(workspace));
  }

  unregister(workspace: WorkspaceReference): void {
    this.#byId.delete(workspace.id);
    this.#byPath.delete(workspace.path);
  }
}

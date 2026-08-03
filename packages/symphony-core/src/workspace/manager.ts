import { lstat, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { type WorkspaceReference, WorkspaceReferenceSchema } from "@symphoneer/contracts";

import { WorkspaceError } from "./error.ts";
import { assertWorkspaceDirectory, WorkspaceHookRunner } from "./hooks.ts";
import { createWorkspaceReference } from "./reference.ts";
import { WorkspaceRegistry } from "./registry.ts";
import type {
  FinishedWorkspace,
  PreparedWorkspace,
  WorkspaceHooks,
  WorkspaceInput,
} from "./types.ts";

export class WorkspaceManager {
  readonly #root: string;
  readonly #registry: WorkspaceRegistry;
  readonly #hooks: WorkspaceHookRunner;

  constructor(options: { root: string; hooks?: WorkspaceHooks }) {
    this.#root = resolve(options.root);
    this.#registry = new WorkspaceRegistry(this.#root);
    this.#hooks = new WorkspaceHookRunner(options.hooks);
  }

  async prepare(input: WorkspaceInput): Promise<PreparedWorkspace> {
    const workspace = createWorkspaceReference({ ...input, root: this.#root });
    await mkdir(this.#root, { recursive: true });
    let createdNow = false;
    try {
      const stats = await lstat(workspace.path);
      if (!stats.isDirectory()) {
        throw new WorkspaceError(
          "workspace_not_directory",
          `Workspace path is not a directory: ${workspace.path}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(workspace.path);
      createdNow = true;
    }

    this.#registry.register(workspace);
    if (createdNow) {
      try {
        await this.#hooks.run("afterCreate", workspace.path);
      } catch (error) {
        try {
          await rm(workspace.path, { recursive: true, force: true });
          this.#registry.unregister(workspace);
        } catch {
          // Keep the identity registered when cleanup is uncertain.
        }
        throw error;
      }
    }
    await this.#hooks.run("beforeRun", workspace.path);
    return { workspace, createdNow };
  }

  async finish(workspaceInput: WorkspaceReference): Promise<FinishedWorkspace> {
    const workspace = this.#registry.require(workspaceInput);
    if (workspace.state !== "ready" && workspace.state !== "reserved") {
      throw new WorkspaceError(
        "workspace_identity_mismatch",
        `Workspace ${workspace.id} has already finished`,
      );
    }
    const hookFailures = await this.#hooks.runBestEffort("afterRun", workspace.path);
    const retained = WorkspaceReferenceSchema.parse({
      ...workspace,
      state: "retained",
      ownerAttemptId: null,
    });
    this.#registry.update(retained);
    return { workspace: retained, hookFailures };
  }

  async remove(workspaceInput: WorkspaceReference): Promise<FinishedWorkspace> {
    const workspace = this.#registry.require(workspaceInput);
    await assertWorkspaceDirectory(workspace.path);
    const hookFailures = await this.#hooks.runBestEffort("beforeRemove", workspace.path);
    await assertWorkspaceDirectory(workspace.path);
    await rm(workspace.path, { recursive: true, force: true });
    this.#registry.unregister(workspace);
    return {
      workspace: WorkspaceReferenceSchema.parse({
        ...workspace,
        state: "released",
        ownerAttemptId: null,
      }),
      hookFailures,
    };
  }
}

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { type WorkspaceReference, WorkspaceReferenceSchema } from "@symphoneer/contracts";
import { DirectoryWorkspaceDriver } from "./directory-driver.ts";
import { WorkspaceError } from "./error.ts";
import { WorkspaceHookRunner } from "./hooks.ts";
import { canonicalizeWorkspaceReference, createWorkspaceReference } from "./reference.ts";
import { WorkspaceRegistry } from "./registry.ts";
import type {
  FinishedWorkspace,
  PreparedWorkspace,
  WorkspaceDriver,
  WorkspaceHooks,
  WorkspaceInput,
  WorkspaceObservation,
} from "./types.ts";

export class WorkspaceManager {
  readonly #root: string;
  readonly #registry: WorkspaceRegistry;
  readonly #hooks: WorkspaceHookRunner;
  readonly #driver: WorkspaceDriver;
  readonly #preparing = new Map<string, Promise<PreparedWorkspace>>();
  readonly #operations = new Map<string, Promise<unknown>>();

  constructor(options: { root: string; hooks?: WorkspaceHooks; driver?: WorkspaceDriver }) {
    this.#root = resolve(options.root);
    this.#registry = new WorkspaceRegistry(this.#root);
    this.#hooks = new WorkspaceHookRunner(options.hooks);
    this.#driver = options.driver ?? new DirectoryWorkspaceDriver();
  }

  async prepare(input: WorkspaceInput): Promise<PreparedWorkspace> {
    const workspace = createWorkspaceReference({ ...input, root: this.#root });
    const key = JSON.stringify([
      workspace.id,
      workspace.taskId,
      workspace.path,
      workspace.repository,
      workspace.branch,
      workspace.host,
      workspace.ownerAttemptId,
    ]);
    const existing = this.#preparing.get(key);
    if (existing) return existing;

    const preparation = this.#exclusive(workspace, () => this.#prepare(workspace));
    this.#preparing.set(key, preparation);
    const clear = () => {
      if (this.#preparing.get(key) === preparation) this.#preparing.delete(key);
    };
    void preparation.then(clear, clear);
    return preparation;
  }

  async recover(
    workspaceInput: WorkspaceReference,
    ownerAttemptId: string,
  ): Promise<PreparedWorkspace> {
    const workspace = canonicalizeWorkspaceReference(workspaceInput);
    const owner = ownerAttemptId.trim();
    if (!owner)
      throw new WorkspaceError("workspace_identity_mismatch", "Attempt owner is required");
    return this.#exclusive(workspace, () => this.#recover(workspace, owner));
  }

  async finish(workspaceInput: WorkspaceReference): Promise<FinishedWorkspace> {
    const input = canonicalizeWorkspaceReference(workspaceInput);
    return this.#exclusive(input, async () => {
      await this.#registry.assertCanonicalPath(input);
      const workspace = this.#registry.require(input);
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
      try {
        const observed = observedWorkspace(retained, await this.#driver.assertReady(workspace));
        this.#registry.update(observed);
        return { workspace: observed, hookFailures };
      } catch (error) {
        this.#registry.update(retained);
        throw error;
      }
    });
  }

  async remove(workspaceInput: WorkspaceReference): Promise<FinishedWorkspace> {
    const input = canonicalizeWorkspaceReference(workspaceInput);
    return this.#exclusive(input, async () => {
      await this.#registry.assertCanonicalPath(input);
      const known = this.#registry.get(input.id);
      if (!known) {
        this.#registry.assertPath(input);
        if (this.#registry.getByPath(input.path)) {
          throw new WorkspaceError(
            "workspace_identity_mismatch",
            `Workspace ${input.id} conflicts with the managed path`,
          );
        }
        if (input.state !== "retained" && input.state !== "released") {
          throw new WorkspaceError(
            "workspace_identity_mismatch",
            `Workspace ${input.id} cannot be adopted for cleanup`,
          );
        }
        const removalState = await this.#driver.assertRemovable(input);
        if (input.state === "released" && removalState === "present") {
          throw new WorkspaceError(
            "workspace_identity_mismatch",
            `Released Workspace ${input.id} still exists`,
          );
        }
        if (removalState === "present") {
          const observation = await this.#driver.recover(input);
          if (
            observation.gitHead === null ||
            observation.worktreeFingerprint === null ||
            observation.gitHead !== input.gitHead ||
            observation.worktreeFingerprint !== input.worktreeFingerprint
          ) {
            throw new WorkspaceError(
              "workspace_identity_mismatch",
              `Workspace ${input.id} has no adoptable Git identity`,
            );
          }
        }
        this.#registry.register(input);
      }
      const workspace = this.#registry.require(input);
      if (workspace.state === "released") {
        if ((await this.#driver.assertRemovable(workspace)) === "absent") {
          return { workspace, hookFailures: [] };
        }
        throw new WorkspaceError(
          "workspace_identity_mismatch",
          `Released Workspace ${workspace.id} still exists`,
        );
      }
      if (workspace.state !== "retained" || workspace.ownerAttemptId !== null) {
        throw new WorkspaceError(
          "workspace_identity_mismatch",
          `Workspace ${workspace.id} is still actively owned`,
        );
      }
      await this.#driver.assertRemovable(workspace);
      const hookFailures = await this.#hooks.runBestEffort("beforeRemove", workspace.path);
      try {
        await this.#driver.assertRemovable(workspace);
        await this.#driver.remove(workspace);
      } catch (error) {
        if (error instanceof WorkspaceError && hookFailures.length > 0) {
          throw new WorkspaceError(error.code, error.message, {
            cause: error,
            hookFailures: hookFailures.map(({ hook }) => hook),
          });
        }
        throw error;
      }
      const released = WorkspaceReferenceSchema.parse({
        ...workspace,
        state: "released",
        ownerAttemptId: null,
      });
      this.#registry.update(released);
      return { workspace: released, hookFailures };
    });
  }

  async #prepare(initial: WorkspaceReference): Promise<PreparedWorkspace> {
    await mkdir(this.#root, { recursive: true });
    const previous = this.#registry.get(initial.id);
    const expected = WorkspaceReferenceSchema.parse({
      ...initial,
      gitHead: previous?.gitHead ?? null,
      worktreeFingerprint: previous?.worktreeFingerprint ?? null,
    });
    await this.#registry.assertCanonicalPath(expected);
    const preparation = await this.#driver.prepare(expected);
    const workspace = observedWorkspace(expected, preparation);
    try {
      this.#registry.register(workspace);
    } catch (error) {
      if (!preparation.createdNow) throw error;
      try {
        await this.#driver.remove(workspace);
      } catch (cleanupError) {
        throw new WorkspaceError(
          "workspace_git_failed",
          `Workspace ${workspace.id} could not be rolled back after registration failed`,
          { cause: cleanupError },
        );
      }
      throw error;
    }
    if (preparation.createdNow) {
      try {
        await this.#hooks.run("afterCreate", workspace.path);
      } catch (error) {
        try {
          await this.#driver.assertRemovable(workspace);
          await this.#driver.remove(workspace);
          this.#registry.unregister(workspace);
        } catch {
          this.#registry.update(await this.#retainObserved(workspace));
        }
        throw error;
      }
    }
    try {
      await this.#hooks.run("beforeRun", workspace.path);
      const ready = observedWorkspace(workspace, await this.#driver.assertReady(workspace));
      this.#registry.update(ready);
      return { workspace: ready, createdNow: preparation.createdNow };
    } catch (error) {
      this.#registry.update(await this.#retainObserved(workspace));
      throw error;
    }
  }

  async #recover(
    workspace: WorkspaceReference,
    ownerAttemptId: string,
  ): Promise<PreparedWorkspace> {
    if (workspace.state !== "retained" || workspace.ownerAttemptId !== null) {
      throw new WorkspaceError(
        "workspace_identity_mismatch",
        `Workspace ${workspace.id} is not available for recovery`,
      );
    }
    this.#registry.assertPath(workspace);
    await this.#registry.assertCanonicalPath(workspace);
    const recoveredObservation = await this.#driver.recover(workspace);
    const retainedWorkspace = observedWorkspace(workspace, recoveredObservation);
    this.#registry.register(retainedWorkspace);
    const owned = WorkspaceReferenceSchema.parse({
      ...retainedWorkspace,
      state: "ready",
      ownerAttemptId,
    });
    try {
      this.#registry.update(owned);
      await this.#hooks.run("beforeRun", owned.path);
      const ready = observedWorkspace(owned, await this.#driver.assertReady(owned));
      this.#registry.update(ready);
      return { workspace: ready, createdNow: false };
    } catch (error) {
      this.#registry.update(await this.#retainObserved(owned));
      throw error;
    }
  }

  async #retainObserved(workspace: WorkspaceReference): Promise<WorkspaceReference> {
    const retainedWorkspace = retained(workspace);
    try {
      return observedWorkspace(retainedWorkspace, await this.#driver.assertReady(workspace));
    } catch {
      return retainedWorkspace;
    }
  }

  #exclusive<T>(workspace: WorkspaceReference, operation: () => Promise<T>): Promise<T> {
    const keys = [`id:${workspace.id}`, `path:${workspace.path}`];
    const previous = Promise.all(
      keys.map((key) => this.#operations.get(key)?.catch(() => undefined) ?? Promise.resolve()),
    );
    const current = previous.then(operation);
    for (const key of keys) this.#operations.set(key, current);
    const clear = () => {
      for (const key of keys) {
        if (this.#operations.get(key) === current) this.#operations.delete(key);
      }
    };
    void current.then(clear, clear);
    return current;
  }
}

const observedWorkspace = (
  workspace: WorkspaceReference,
  observation: WorkspaceObservation,
): WorkspaceReference =>
  WorkspaceReferenceSchema.parse({
    ...workspace,
    gitHead: observation.gitHead,
    worktreeFingerprint: observation.worktreeFingerprint,
  });

const retained = (workspace: WorkspaceReference): WorkspaceReference =>
  WorkspaceReferenceSchema.parse({ ...workspace, state: "retained", ownerAttemptId: null });

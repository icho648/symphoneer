import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type { WorkspaceReference } from "@symphoneer/contracts";
import { type WorkspaceDriver, WorkspaceError } from "@symphoneer/symphony-core";
import {
  assertWorktreeMatchesIndex,
  readWorktreeFingerprint,
} from "../worktree-fingerprint/index.ts";

interface WorktreeRecord {
  path: string;
  branch: string | null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function runGit(
  cwd: string,
  args: string[],
  acceptedCodes: readonly number[] = [0],
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { encoding: "utf8", maxBuffer: 2 ** 20 },
      (error, stdout) => {
        const code = typeof error?.code === "number" ? error.code : error ? -1 : 0;
        if (!acceptedCodes.includes(code)) {
          reject(
            new WorkspaceError(
              "workspace_git_failed",
              `Git ${args[0] ?? "command"} failed with code ${code}`,
            ),
          );
          return;
        }
        resolvePromise({ code, stdout });
      },
    );
  });
}

function parseWorktrees(output: string): WorktreeRecord[] {
  return output
    .split("\0\0")
    .filter(Boolean)
    .map((entry) => {
      const fields = entry.split("\0");
      const worktree = fields.find((field) => field.startsWith("worktree "));
      if (!worktree) {
        throw new WorkspaceError("workspace_git_failed", "Git returned invalid worktree metadata");
      }
      const branch = fields.find((field) => field.startsWith("branch "));
      return {
        path: resolve(worktree.slice("worktree ".length)),
        branch: branch?.slice(7) ?? null,
      };
    });
}

export class GitWorktreeDriver implements WorkspaceDriver {
  readonly #repositoryPath: string;
  readonly #repository: string;
  readonly #baseRevision: string;

  constructor(options: { repositoryPath: string; repository: string; baseRevision: string }) {
    this.#repositoryPath = resolve(options.repositoryPath);
    this.#repository = options.repository;
    this.#baseRevision = options.baseRevision;
  }

  async prepare(workspace: WorkspaceReference) {
    this.#assertRepository(workspace);
    await this.#validateBranch(workspace.branch);
    const record = await this.#record(workspace.path);
    const exists = await pathExists(workspace.path);
    if (record && exists) {
      const observation = await this.recover(workspace);
      return { createdNow: false, ...observation };
    }
    if (record || exists) throw identityMismatch(workspace);

    const branch = `refs/heads/${workspace.branch}`;
    const branchExists = await runGit(
      this.#repositoryPath,
      ["show-ref", "--verify", "--quiet", branch],
      [0, 1],
    );
    const args =
      branchExists.code === 0
        ? ["worktree", "add", workspace.path, workspace.branch]
        : [
            "worktree",
            "add",
            "-b",
            workspace.branch,
            workspace.path,
            await this.#resolvedBaseRevision(),
          ];
    await runGit(this.#repositoryPath, args);
    try {
      const observation = await this.assertReady(workspace);
      this.#assertExpected(workspace, observation);
      return { createdNow: true, ...observation };
    } catch (error) {
      try {
        await runGit(this.#repositoryPath, ["worktree", "remove", workspace.path]);
      } catch (cleanupError) {
        throw new WorkspaceError(
          "workspace_git_failed",
          `Workspace ${workspace.id} could not be rolled back after validation failed`,
          { cause: cleanupError },
        );
      }
      throw error;
    }
  }

  async recover(workspace: WorkspaceReference) {
    if (workspace.gitHead === null || workspace.worktreeFingerprint === null) {
      throw identityMismatch(workspace);
    }
    const observation = await this.assertReady(workspace);
    this.#assertExpected(workspace, observation);
    return observation;
  }

  async assertReady(workspace: WorkspaceReference) {
    this.#assertRepository(workspace);
    const record = await this.#record(workspace.path);
    if (!record || !(await pathExists(workspace.path))) throw identityMismatch(workspace);
    if (record.branch !== `refs/heads/${workspace.branch}`) throw identityMismatch(workspace);
    const stats = await lstat(workspace.path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw identityMismatch(workspace);

    const [expectedCommonDir, actualCommonDir, topLevel, branch, head] = await Promise.all([
      runGit(this.#repositoryPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      runGit(workspace.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      runGit(workspace.path, ["rev-parse", "--show-toplevel"]),
      runGit(workspace.path, ["symbolic-ref", "--quiet", "HEAD"]),
      runGit(workspace.path, ["rev-parse", "--verify", "HEAD"]),
    ]);
    if (
      resolve(expectedCommonDir.stdout.trim()) !== resolve(actualCommonDir.stdout.trim()) ||
      (await realpath(topLevel.stdout.trim())) !== (await realpath(workspace.path)) ||
      branch.stdout.trim() !== `refs/heads/${workspace.branch}`
    ) {
      throw identityMismatch(workspace);
    }
    try {
      return {
        gitHead: head.stdout.trim(),
        worktreeFingerprint: await readWorktreeFingerprint(workspace.path),
      };
    } catch {
      throw new WorkspaceError(
        "workspace_git_failed",
        `Workspace ${workspace.id} state could not be fingerprinted`,
      );
    }
  }

  async assertRemovable(workspace: WorkspaceReference): Promise<"absent" | "present"> {
    this.#assertRepository(workspace);
    const record = await this.#record(workspace.path);
    const exists = await pathExists(workspace.path);
    if (!record && !exists) return "absent";
    if (!record || !exists) throw identityMismatch(workspace);
    const observation = await this.assertReady(workspace);
    try {
      await assertWorktreeMatchesIndex(workspace.path);
    } catch {
      throw new WorkspaceError(
        "workspace_dirty",
        `Workspace ${workspace.id} has tracked bytes that differ from the Git index`,
      );
    }
    const status = await runGit(workspace.path, [
      "status",
      "--porcelain=v2",
      "--untracked-files=all",
      "--ignored",
      "-z",
    ]);
    if (status.stdout.length > 0) {
      throw new WorkspaceError(
        "workspace_dirty",
        `Workspace ${workspace.id} has tracked or untracked changes`,
      );
    }
    this.#assertExpected(workspace, observation);
    return "present";
  }

  async remove(workspace: WorkspaceReference): Promise<"removed" | "already_absent"> {
    this.#assertRepository(workspace);
    const record = await this.#record(workspace.path);
    const exists = await pathExists(workspace.path);
    if (!record && !exists) return "already_absent";
    if (!record || !exists) throw identityMismatch(workspace);
    await this.assertRemovable(workspace);
    await runGit(this.#repositoryPath, ["worktree", "remove", workspace.path]);
    if ((await this.#record(workspace.path)) || (await pathExists(workspace.path))) {
      throw new WorkspaceError("workspace_git_failed", "Git did not release the managed worktree");
    }
    return "removed";
  }

  #assertRepository(workspace: WorkspaceReference): void {
    if (workspace.repository !== this.#repository) throw identityMismatch(workspace);
  }

  #assertExpected(
    workspace: WorkspaceReference,
    observation: { gitHead: string; worktreeFingerprint: string },
  ): void {
    if (
      (workspace.gitHead !== null && workspace.gitHead !== observation.gitHead) ||
      (workspace.worktreeFingerprint !== null &&
        workspace.worktreeFingerprint !== observation.worktreeFingerprint)
    ) {
      throw identityMismatch(workspace);
    }
  }

  async #record(path: string): Promise<WorktreeRecord | undefined> {
    const result = await runGit(this.#repositoryPath, ["worktree", "list", "--porcelain", "-z"]);
    const expected = await canonicalPath(path);
    for (const record of parseWorktrees(result.stdout)) {
      if ((await canonicalPath(record.path)) === expected) return record;
    }
    return undefined;
  }

  async #validateBranch(branch: string): Promise<void> {
    const result = await runGit(
      this.#repositoryPath,
      ["check-ref-format", "--branch", branch],
      [0, 128],
    );
    if (result.code !== 0) {
      throw new WorkspaceError("workspace_identity_mismatch", "Workspace branch is invalid");
    }
  }

  async #resolvedBaseRevision(): Promise<string> {
    const revision = await runGit(this.#repositoryPath, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${this.#baseRevision}^{commit}`,
    ]);
    const head = revision.stdout.trim();
    if (!/^[a-f0-9]{40,64}$/.test(head)) {
      throw new WorkspaceError("workspace_git_failed", "Git base revision is invalid");
    }
    return head;
  }
}

const identityMismatch = (workspace: WorkspaceReference) =>
  new WorkspaceError(
    "workspace_identity_mismatch",
    `Workspace ${workspace.id} does not match the managed Git worktree`,
  );

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const suffix: string[] = [];
    let ancestor = resolve(path);
    for (;;) {
      try {
        return resolve(await realpath(ancestor), ...suffix);
      } catch (ancestorError) {
        if ((ancestorError as NodeJS.ErrnoException).code !== "ENOENT") throw ancestorError;
        const parent = dirname(ancestor);
        if (parent === ancestor) return resolve(path);
        suffix.unshift(basename(ancestor));
        ancestor = parent;
      }
    }
  }
}

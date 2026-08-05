import { lstat, mkdir, readdir, rmdir } from "node:fs/promises";

import type { WorkspaceReference } from "@symphoneer/contracts";

import { WorkspaceError } from "./error.ts";
import { assertWorkspaceDirectory } from "./hooks.ts";
import type { WorkspaceDriver } from "./types.ts";

const observation = { gitHead: null, worktreeFingerprint: null } as const;

export class DirectoryWorkspaceDriver implements WorkspaceDriver {
  async prepare(workspace: WorkspaceReference) {
    try {
      await assertWorkspaceDirectory(workspace.path);
      return { createdNow: false, ...observation };
    } catch (error) {
      try {
        await lstat(workspace.path);
        throw error;
      } catch (pathError) {
        if ((pathError as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await mkdir(workspace.path);
      return { createdNow: true, ...observation };
    }
  }

  async recover(workspace: WorkspaceReference): Promise<never> {
    throw new WorkspaceError(
      "workspace_identity_mismatch",
      `Directory Workspace ${workspace.id} has no recoverable Git identity`,
    );
  }

  async assertReady(workspace: WorkspaceReference) {
    await assertWorkspaceDirectory(workspace.path);
    return observation;
  }

  async assertRemovable(workspace: WorkspaceReference): Promise<"absent" | "present"> {
    try {
      const stats = await lstat(workspace.path);
      if (stats.isDirectory()) {
        if ((await readdir(workspace.path)).length === 0) return "present";
        throw new WorkspaceError(
          "workspace_dirty",
          `Workspace ${workspace.id} has directory content`,
        );
      }
      throw new WorkspaceError(
        "workspace_not_directory",
        `Workspace path is not a directory: ${workspace.path}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
      throw error;
    }
  }

  async remove(workspace: WorkspaceReference): Promise<"already_absent" | "removed"> {
    if ((await this.assertRemovable(workspace)) === "absent") return "already_absent";
    await rmdir(workspace.path);
    return "removed";
  }
}

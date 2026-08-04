import { lstat, readlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  gitBlobHash,
  gitBytes,
  gitOutput,
  parseIndexEntries,
  validateRelativePath,
} from "./git.ts";

export async function assertWorktreeMatchesIndex(cwd: string): Promise<void> {
  const topLevel = (await gitOutput(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!topLevel) throw new Error("Git worktree root could not be read");
  const root = resolve(topLevel);
  const entries = parseIndexEntries(await gitBytes(root, ["ls-files", "--stage", "-z"]));
  for (const entry of entries) {
    if (entry.mode === "160000") continue;
    validateRelativePath(entry.path);
    const path = Buffer.concat([Buffer.from(root + sep), entry.path]);
    const stats = await lstat(path).catch(() => null);
    const matches =
      entry.mode === "120000"
        ? stats?.isSymbolicLink() === true &&
          Buffer.compare(
            await readlink(path, { encoding: "buffer" }),
            await gitBytes(root, ["cat-file", "blob", entry.objectId]),
          ) === 0
        : stats?.isFile() === true &&
          (entry.mode === "100755") === Boolean((stats.mode ?? 0) & 0o111) &&
          (await gitBlobHash(root, path)) === entry.objectId;
    if (!matches) throw new Error("Tracked worktree bytes do not match the Git index");
  }
}

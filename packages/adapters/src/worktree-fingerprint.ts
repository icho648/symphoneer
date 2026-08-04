import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { hashOtherPath, hashTrackedState } from "./worktree-files.ts";
import { gitBytes, gitOutput, parseGitlinks, splitNull as splitNullPaths } from "./worktree-git.ts";

export { assertWorktreeMatchesIndex } from "./worktree-files.ts";
export { splitNull } from "./worktree-git.ts";

export async function readWorktreeFingerprint(cwd: string): Promise<string> {
  const topLevel = (await gitOutput(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!topLevel) throw new Error("Git worktree root could not be read");
  const root = resolve(topLevel);
  if (parseGitlinks(await gitBytes(root, ["ls-files", "--stage", "-z"])).length > 0) {
    throw new Error("Git submodules are not supported by the V1 Workspace boundary");
  }
  await assertNoHiddenIndexPaths(root);
  const hash = createHash("sha256");
  hash.update("tracked\0");
  await hashTrackedState(root, hash);
  hash.update("\0untracked\0");
  const untracked = (
    await Promise.all([
      gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
      gitBytes(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]),
    ])
  )
    .flatMap(splitNullPaths)
    .sort(Buffer.compare);
  for (const file of untracked) {
    await hashOtherPath(root, file, hash);
  }
  return hash.digest("hex");
}

async function assertNoHiddenIndexPaths(cwd: string): Promise<void> {
  const entries = splitNullPaths(await gitBytes(cwd, ["ls-files", "-v", "-z"]));
  // `git ls-files -v` reports assume-unchanged as `h` and skip-worktree as `S`.
  if (entries.some((entry) => entry[0] === 0x68 || entry[0] === 0x53)) {
    throw new Error("Tracked paths with hidden Git index flags cannot be fingerprinted safely");
  }
}

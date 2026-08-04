import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { hashField, hashOtherPath, hashTrackedState } from "./worktree-files.ts";
import { gitBytes, gitOutput, splitNull as splitNullPaths } from "./worktree-git.ts";
import { assertNoHiddenIndexPaths, assertNoUnsafeSubmodulePaths } from "./worktree-submodules.ts";

export { assertWorktreeMatchesIndex } from "./worktree-files.ts";
export { splitNull } from "./worktree-git.ts";

export async function readWorktreeFingerprint(cwd: string): Promise<string> {
  const topLevel = (await gitOutput(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!topLevel) throw new Error("Git worktree root could not be read");
  const root = resolve(topLevel);
  await assertNoHiddenIndexPaths(root);
  const submoduleStates = await assertNoUnsafeSubmodulePaths(root);
  const hash = createHash("sha256");
  hash.update("tracked\0");
  await hashTrackedState(root, hash);
  hash.update("\0submodules\0");
  for (const submodule of submoduleStates) {
    hashField(hash, "submodule");
    hashField(hash, submodule.path);
    hashField(hash, submodule.state);
    hashField(hash, submodule.gitHead ?? "");
  }
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

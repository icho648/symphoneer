import { lstat, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  gitBytes,
  gitOutput,
  parseGitlinks,
  splitNull,
  validateRelativePath,
} from "./worktree-git.ts";

export type SubmoduleState = {
  path: Buffer;
  state: "missing" | "empty" | "initialized";
  gitHead: string | null;
};

export async function assertNoUnsafeSubmodulePaths(cwd: string): Promise<SubmoduleState[]> {
  await assertNoDirtySubmodules(cwd);
  const root = resolve((await gitOutput(cwd, ["rev-parse", "--show-toplevel"])).trim());
  const states: SubmoduleState[] = [];
  await inspectGitlinks(root, root, Buffer.alloc(0), states);
  return states.sort((left, right) => Buffer.compare(left.path, right.path));
}

async function assertNoDirtySubmodules(cwd: string): Promise<void> {
  const status = await gitOutput(cwd, [
    "submodule",
    "foreach",
    "--quiet",
    "--recursive",
    "git status --porcelain=v2 --untracked-files=all --ignored",
  ]);
  if (status.trim()) throw new Error("Dirty submodules cannot be fingerprinted safely");
}

async function inspectGitlinks(
  root: string,
  repositoryPath: string,
  prefix: Buffer,
  states: SubmoduleState[],
): Promise<void> {
  const gitlinks = parseGitlinks(await gitBytes(repositoryPath, ["ls-files", "--stage", "-z"]));
  for (const gitlink of gitlinks) {
    const relativePath = prefix.length
      ? Buffer.concat([prefix, Buffer.from("/"), gitlink])
      : gitlink;
    validateRelativePath(relativePath);
    const path = Buffer.concat([Buffer.from(root + sep), relativePath]);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        states.push({ path: relativePath, state: "missing", gitHead: null });
        continue;
      }
      throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Gitlink path is not an initialized submodule checkout");
    }
    if ((await readdir(path)).length === 0) {
      states.push({ path: relativePath, state: "empty", gitHead: null });
      continue;
    }
    try {
      const metadata = await lstat(Buffer.concat([path, Buffer.from(`${sep}.git`)]));
      if (!metadata.isFile() && !metadata.isDirectory()) {
        throw new Error("Gitlink path is not an initialized submodule checkout");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Uninitialized submodule path contains local data");
      }
      throw error;
    }
    const gitHead = (await gitOutput(path.toString(), ["rev-parse", "--verify", "HEAD"])).trim();
    if (!gitHead) throw new Error("Initialized submodule HEAD could not be read");
    states.push({ path: relativePath, state: "initialized", gitHead });
    await assertNoHiddenIndexPaths(path.toString());
    await inspectGitlinks(root, path.toString(), relativePath, states);
  }
}

export async function assertNoHiddenIndexPaths(cwd: string): Promise<void> {
  const entries = splitNull(await gitBytes(cwd, ["ls-files", "-v", "-z"]));
  // `git ls-files -v` reports assume-unchanged as `h` and skip-worktree as `S`.
  if (entries.some((entry) => entry[0] === 0x68 || entry[0] === 0x53)) {
    throw new Error("Tracked paths with hidden Git index flags cannot be fingerprinted safely");
  }
}

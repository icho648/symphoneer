import { randomBytes } from "node:crypto";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { VerificationError } from "./errors.ts";

export async function resolveArtifactRoot(
  artifactRoot: string,
  workspace: string,
): Promise<string> {
  const potential = await canonicalPotentialPath(artifactRoot);
  assertOutsideWorkspace(workspace, potential);
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const actual = await realpath(artifactRoot);
  assertOutsideWorkspace(workspace, actual);
  return actual;
}

export async function assertArtifactAbsent(path: string): Promise<void> {
  if (await pathExists(path)) {
    throw new VerificationError("artifact_exists", "Verification artifact already exists");
  }
}

// A published artifact is never rewritten in place: the contents are staged privately and
// linked into their final name, so an existing artifact stays byte-identical and a failed run
// leaves no placeholder blocking the same check from producing evidence later.
export async function publishArtifact(path: string, contents: string): Promise<void> {
  const staged = `${path}.${randomBytes(8).toString("hex")}.staged`;
  const file = await open(staged, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
  } finally {
    await file.close();
  }
  try {
    await link(staged, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new VerificationError("artifact_exists", "Verification artifact already exists");
    }
    throw error;
  } finally {
    await unlink(staged).catch(() => undefined);
  }
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

async function canonicalPotentialPath(path: string): Promise<string> {
  const suffix: string[] = [];
  let ancestor = resolve(path);
  for (;;) {
    try {
      return resolve(await realpath(ancestor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) return resolve(path);
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

function assertOutsideWorkspace(workspace: string, artifactRoot: string): void {
  const artifactFromWorkspace = relative(workspace, artifactRoot);
  const workspaceFromArtifact = relative(artifactRoot, workspace);
  const isWithin = (child: string) =>
    !child || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
  if (isWithin(artifactFromWorkspace) || isWithin(workspaceFromArtifact)) {
    throw new VerificationError(
      "invalid_workspace",
      "Verification artifacts must be outside the Workspace",
    );
  }
}

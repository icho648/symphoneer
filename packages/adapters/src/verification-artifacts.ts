import { type FileHandle, lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { VerificationError } from "./verification-errors.ts";

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

export async function createArtifactFile(path: string): Promise<FileHandle> {
  try {
    return await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new VerificationError("artifact_exists", "Verification artifact already exists");
    }
    throw error;
  }
}

export async function assertArtifactFileLinked(path: string, file: FileHandle): Promise<void> {
  const [opened, entry] = await Promise.all([file.stat(), lstat(path).catch(() => null)]);
  if (!entry?.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
    throw new VerificationError(
      "artifact_replaced",
      "Verification artifact path was replaced while the check was running",
    );
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
  const child = relative(workspace, artifactRoot);
  if (!child || (!child.startsWith("..") && !isAbsolute(child))) {
    throw new VerificationError(
      "invalid_workspace",
      "Verification artifacts must be outside the Workspace",
    );
  }
}

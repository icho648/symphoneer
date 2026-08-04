import {
  type FileHandle,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { VerificationError } from "./errors.ts";

const artifactRootLocks = new Map<string, Promise<void>>();

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

export async function withHiddenArtifactRoot<T>(
  artifactRoot: string,
  workspace: string,
  operation: (privateRoot: string, publicRoot: string) => Promise<T>,
): Promise<T> {
  // ponytail: path hiding covers the in-process boundary; use an OS sandbox or
  // separate storage identity when checks must resist same-UID parent scanning.
  const configuredRoot = resolve(artifactRoot);
  return withArtifactRootLock(configuredRoot, async () => {
    const publicRoot = await resolveArtifactRoot(configuredRoot, workspace);
    const privateRoot = await temporaryPath(dirname(publicRoot), ".symphoneer-artifact-");
    await rename(publicRoot, privateRoot);

    let result: T | undefined;
    let operationError: unknown;
    try {
      result = await operation(privateRoot, publicRoot);
    } catch (error) {
      operationError = error;
    }

    let restoreError: unknown;
    try {
      await restoreArtifactRoot(publicRoot, privateRoot);
    } catch (error) {
      restoreError = error;
    }
    if (restoreError) throw restoreError;
    if (operationError) throw operationError;
    return result as T;
  });
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

export async function removeArtifactFileIfLinked(path: string, file: FileHandle): Promise<void> {
  try {
    const [opened, entry] = await Promise.all([file.stat(), lstat(path).catch(() => null)]);
    if (entry?.isFile() && opened.dev === entry.dev && opened.ino === entry.ino) {
      await unlink(path);
    }
  } catch {
    // Preserve the original verification failure and any replacement evidence.
  }
}

async function withArtifactRootLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = artifactRootLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  artifactRootLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (artifactRootLocks.get(key) === current) artifactRootLocks.delete(key);
  }
}

async function restoreArtifactRoot(publicRoot: string, privateRoot: string): Promise<void> {
  let replaced = false;
  if (await pathExists(publicRoot)) {
    const quarantine = await temporaryPath(dirname(publicRoot), ".symphoneer-artifact-tampered-");
    await rename(publicRoot, quarantine);
    replaced = true;
  }
  await rename(privateRoot, publicRoot);
  if (replaced) {
    throw new VerificationError(
      "artifact_replaced",
      "Verification artifact root was replaced while the check was running",
    );
  }
}

async function temporaryPath(parent: string, prefix: string): Promise<string> {
  const path = await mkdtemp(resolve(parent, prefix));
  await rmdir(path);
  return path;
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

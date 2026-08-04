import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { sep } from "node:path";

import { gitBytes, parseIndexEntries, splitNull, validateRelativePath } from "./git.ts";

export async function hashOtherPath(root: string, file: Buffer, hash: Hash): Promise<void> {
  const relative = file[file.length - 1] === 47 ? file.subarray(0, file.length - 1) : file;
  validateRelativePath(relative);
  const path = Buffer.concat([Buffer.from(root + sep), relative]);
  const stats = await lstat(path);
  hashField(hash, "untracked-file");
  hashField(hash, relative);
  hashField(hash, String(stats.mode));
  if (stats.isSymbolicLink()) {
    hashField(hash, "symlink");
    hashField(hash, await readlink(path, { encoding: "buffer" }));
  } else if (stats.isFile()) {
    hashField(hash, "file");
    hashField(hash, await hashFile(path));
  } else if (stats.isDirectory()) {
    hashField(hash, "directory");
    const children = (await readdir(path, { encoding: "buffer" })).sort(Buffer.compare);
    for (const child of children) {
      await hashOtherPath(root, Buffer.concat([relative, Buffer.from("/"), child]), hash);
    }
  } else {
    throw new Error("Untracked special files cannot be fingerprinted safely");
  }
}

export function hashField(hash: Hash, value: string | Uint8Array): void {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

async function hashFile(path: Buffer): Promise<Uint8Array> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest();
}

export async function hashTrackedState(root: string, hash: Hash): Promise<void> {
  const index = await gitBytes(root, ["ls-files", "--stage", "-z"]);
  hashField(hash, "index");
  hashField(hash, index);
  const gitlinks = new Set(
    parseIndexEntries(index)
      .filter(({ mode }) => mode === "160000")
      .map(({ path }) => path.toString("hex")),
  );
  const tracked = splitNull(await gitBytes(root, ["ls-files", "-z"])).sort(Buffer.compare);
  for (const file of tracked) {
    if (gitlinks.has(file.toString("hex"))) continue;
    await hashTrackedPath(root, file, hash);
  }
}

async function hashTrackedPath(root: string, file: Buffer, hash: Hash): Promise<void> {
  validateRelativePath(file);
  const path = Buffer.concat([Buffer.from(root + sep), file]);
  hashField(hash, "tracked-file");
  hashField(hash, file);
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      hashField(hash, "missing");
      return;
    }
    throw error;
  }
  hashField(hash, String(stats.mode));
  if (stats.isSymbolicLink()) {
    hashField(hash, "symlink");
    hashField(hash, await readlink(path, { encoding: "buffer" }));
  } else if (stats.isFile()) {
    hashField(hash, "file");
    hashField(hash, await hashFile(path));
  } else {
    throw new Error("Tracked special files cannot be fingerprinted safely");
  }
}

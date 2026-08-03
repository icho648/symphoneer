import { execFile, spawn } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

export async function readWorktreeFingerprint(cwd: string): Promise<string> {
  const topLevel = (await gitOutput(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!topLevel) throw new Error("Git worktree root could not be read");
  const root = resolve(topLevel);
  const hash = createHash("sha256");
  hash.update("tracked\0");
  await hashGitDiff(root, hash);
  hash.update("\0untracked\0");
  const untracked = splitNull(
    await gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ).sort(Buffer.compare);
  for (const file of untracked) {
    validateRelativePath(file);
    const path = Buffer.concat([Buffer.from(root + sep), file]);
    const stats = await lstat(path);
    hashField(hash, "untracked-file");
    hashField(hash, file);
    hashField(hash, String(stats.mode));
    if (stats.isSymbolicLink()) {
      hashField(hash, "symlink");
      hashField(hash, await readlink(path, { encoding: "buffer" }));
    } else if (stats.isFile()) {
      hashField(hash, "file");
      hashField(hash, await hashFile(path));
    } else {
      throw new Error("Untracked special files cannot be fingerprinted safely");
    }
  }
  return hash.digest("hex");
}

function hashField(hash: Hash, value: string | Uint8Array): void {
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

export function splitNull(output: Uint8Array): Buffer[] {
  const bytes = Buffer.from(output);
  const paths: Buffer[] = [];
  let start = 0;
  for (let end = 0; end < bytes.length; end += 1) {
    if (bytes[end] !== 0) continue;
    if (end > start) paths.push(Buffer.from(bytes.subarray(start, end)));
    start = end + 1;
  }
  if (start !== bytes.length) throw new Error("Git returned invalid untracked paths");
  return paths;
}

function validateRelativePath(path: Buffer): void {
  if (path.length === 0 || path[0] === 47) {
    throw new Error("Git returned an invalid untracked path");
  }
  let segmentStart = 0;
  for (let end = 0; end <= path.length; end += 1) {
    if (end < path.length && path[end] !== 47) continue;
    const segment = path.subarray(segmentStart, end);
    if (segment.length === 0 || segment.equals(Buffer.from(".."))) {
      throw new Error("Git returned an invalid untracked path");
    }
    segmentStart = end + 1;
  }
}

function hashGitDiff(cwd: string, hash: Hash): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", ["-C", cwd, "diff", "--binary", "HEAD", "--"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
    child.once("error", () => reject(new Error("Git worktree diff could not be read")));
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error("Git worktree diff could not be read"));
    });
  });
}

function gitOutput(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { encoding: "utf8", maxBuffer: 4 * 2 ** 20 },
      (error, stdout) => {
        if (error) reject(new Error("Git worktree metadata could not be read"));
        else resolvePromise(stdout);
      },
    );
  });
}

function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { encoding: "buffer", maxBuffer: 4 * 2 ** 20 },
      (error, stdout) => {
        if (error) reject(new Error("Git worktree metadata could not be read"));
        else resolvePromise(Buffer.from(stdout));
      },
    );
  });
}

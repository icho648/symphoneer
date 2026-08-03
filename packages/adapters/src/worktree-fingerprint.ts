import { execFile, spawn } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export async function readWorktreeFingerprint(cwd: string): Promise<string> {
  const topLevel = (await gitOutput(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!topLevel) throw new Error("Git worktree root could not be read");
  const root = resolve(topLevel);
  const hash = createHash("sha256");
  hash.update("tracked\0");
  await hashGitDiff(root, hash);
  hash.update("\0untracked\0");
  const untracked = (await gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of untracked) {
    const path = resolve(root, file);
    const child = relative(root, path);
    if (!child || child.startsWith("..") || isAbsolute(child)) {
      throw new Error("Git returned an invalid untracked path");
    }
    const stats = await lstat(path);
    hashField(hash, "untracked-file");
    hashField(hash, child);
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

async function hashFile(path: string): Promise<Uint8Array> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest();
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

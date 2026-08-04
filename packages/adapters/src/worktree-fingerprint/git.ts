import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export type IndexEntry = {
  mode: "100644" | "100755" | "120000" | "160000";
  objectId: string;
  path: Buffer;
};

export function gitOutput(cwd: string, args: string[]): Promise<string> {
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

export function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
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

export async function gitBlobHash(cwd: string, path: Buffer): Promise<string> {
  const child = spawn("git", ["-C", cwd, "hash-object", "--no-filters", "--stdin"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (!child.stdin || !child.stdout) throw new Error("Git worktree metadata could not be read");
  const output = new Promise<string>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks).toString("ascii").trim());
      else reject(new Error("Git worktree metadata could not be read"));
    });
  });
  const [, hash] = await Promise.all([pipeline(createReadStream(path), child.stdin), output]);
  return hash;
}

export function parseIndexEntries(output: Uint8Array): IndexEntry[] {
  return splitNull(output).map((entry) => {
    const tab = entry.indexOf(9);
    if (tab < 0) throw new Error("Git returned invalid index metadata");
    const [mode, objectId, stage] = entry.subarray(0, tab).toString("ascii").split(" ");
    if (
      !/^(100644|100755|120000|160000)$/.test(mode ?? "") ||
      !/^[0-9a-f]+$/.test(objectId ?? "") ||
      !/^[0-3]$/.test(stage ?? "")
    ) {
      throw new Error("Git returned invalid index metadata");
    }
    return {
      mode: mode as IndexEntry["mode"],
      objectId: objectId as string,
      path: entry.subarray(tab + 1),
    };
  });
}

export function parseGitlinks(output: Uint8Array): Buffer[] {
  return parseIndexEntries(output)
    .filter(({ mode }) => mode === "160000")
    .map(({ path }) => path);
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

export function validateRelativePath(path: Buffer): void {
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

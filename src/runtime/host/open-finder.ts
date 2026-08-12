import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function selectDirectoryInFinder(): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    throw new Error("Native folder selection is only available on macOS");
  }
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Choose Symphoneer project directory")'],
      { encoding: "utf8" },
    );
    const selected = String(stdout).trim();
    return selected ? validateDirectoryPath(selected) : undefined;
  } catch (error) {
    if (isPickerCancellation(error)) return undefined;
    throw error;
  }
}

export async function validateDirectoryPath(path: string): Promise<string> {
  const target = resolve(path);
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error("The selected path is not a directory");
  return target;
}

function isPickerCancellation(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown; stderr?: unknown };
  return [value.message, value.stderr].some(
    (part) => typeof part === "string" && /cancel|-128/i.test(part),
  );
}

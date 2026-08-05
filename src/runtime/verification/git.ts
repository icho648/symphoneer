import { spawn } from "node:child_process";

import { VerificationError } from "./errors.ts";

export function readGitHead(cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const processHandle = spawn("git", ["-C", cwd, "rev-parse", "--verify", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    processHandle.stdout.setEncoding("utf8");
    processHandle.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    processHandle.once("error", () =>
      reject(new VerificationError("git_failed", "Verification Git revision could not be read")),
    );
    processHandle.once("close", (code) => {
      const head = output.trim();
      if (code === 0 && head) resolvePromise(head);
      else
        reject(new VerificationError("git_failed", "Verification Git revision could not be read"));
    });
  });
}

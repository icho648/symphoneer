import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  pnpm,
  [
    "exec",
    "c8",
    "--reporter=html",
    "--reporter=lcov",
    "--reports-dir=coverage/node",
    "node",
    "--test",
    "tests/**/*.test.ts",
  ],
  { stdio: "inherit" },
);
const exitCode = await new Promise<number>((resolvePromise, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolvePromise(code ?? 1));
});
const output = resolve("coverage/node");
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, "scope.json"),
  `${JSON.stringify(
    {
      kind: "node-test-coverage",
      included: "Node code loaded by tests/**/*.test.ts",
      excluded: ["Playwright browser execution", "CSS", "unloaded source files"],
      partial: exitCode !== 0,
    },
    null,
    2,
  )}\n`,
);
process.exitCode = exitCode;

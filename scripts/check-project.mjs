import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const failures = [];
const markdownFiles = globSync("**/*.md", {
  exclude: ["node_modules/**"],
});

for (const file of markdownFiles) {
  const markdown = readFileSync(file, "utf8");
  for (const [, rawTarget] of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = rawTarget.trim();
    if (/^(?:https?:|mailto:|data:|#)/.test(target)) continue;
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
    if (target && !existsSync(resolve(dirname(file), target))) {
      failures.push(`${file}: missing local link ${rawTarget}`);
    }
  }
}

for (const { directory, guidance } of [
  { directory: "docs/design-docs", guidance: "docs/AGENTS.md" },
  { directory: "docs/product-specs", guidance: "docs/AGENTS.md" },
  { directory: "docs/references", guidance: "docs/AGENTS.md" },
  { directory: "docs/research", guidance: "docs/research/AGENTS.md" },
  { directory: "docs/plans/active", guidance: "docs/plans/AGENTS.md" },
]) {
  const body = readFileSync(guidance, "utf8");
  for (const leaf of globSync(`${directory}/*.md`)) {
    if (leaf === guidance) continue;
    const target = relative(dirname(guidance), leaf).replaceAll("\\", "/");
    if (!body.includes(`(${target})`)) failures.push(`${leaf}: missing from ${guidance}`);
  }
}

for (const index of globSync("docs/**/index.md")) {
  failures.push(`${index}: document navigation must use the nearest AGENTS.md`);
}

const requiredPlanSections = [
  "Purpose / Big Picture",
  "Progress",
  "Surprises & Discoveries",
  "Decision Log",
  "Outcomes & Retrospective",
  "Context and Orientation",
  "Plan of Work",
  "Concrete Steps",
  "Validation and Acceptance",
  "Idempotence and Recovery",
  "Artifacts and Notes",
  "Interfaces and Dependencies",
];
for (const plan of globSync("docs/plans/active/*.md")) {
  const sections = [...readFileSync(plan, "utf8").matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  if (JSON.stringify(sections) !== JSON.stringify(requiredPlanSections)) {
    failures.push(`${plan}: expected the 12 required ExecPlan sections in order`);
  }
}

for (const testFile of globSync("**/*.{test,spec}.ts", { exclude: ["node_modules/**"] })) {
  if (!testFile.startsWith("tests/")) failures.push(`${testFile}: tests must live under tests/`);
}

for (const file of globSync("src/runtime/**/*.ts")) {
  const source = readFileSync(file, "utf8");
  if (/from ["'](?:next|react|vite)(?:\/|["'])/.test(source)) {
    failures.push(`${file}: Runtime must not depend on Web modules`);
  }
  if (/from ["']@symphoneer\/runtime-client["']/.test(source)) {
    failures.push(`${file}: Runtime must not depend on its own HTTP client`);
  }
}

for (const file of globSync("src/web/**/*.{ts,tsx}", { exclude: ["src/web/dist/**"] })) {
  const source = readFileSync(file, "utf8");
  if (/from ["']@symphoneer\/runtime["']/.test(source)) {
    failures.push(`${file}: Web must reach the Runtime through @symphoneer/runtime-client`);
  }
  if (/from ["']next(?:\/|["'])/.test(source)) {
    failures.push(`${file}: Web must not import Next.js after the Vite migration`);
  }
}

for (const file of globSync("src/mcp/**/*.ts")) {
  const source = readFileSync(file, "utf8");
  if (/from ["']@symphoneer\/runtime["']/.test(source)) {
    failures.push(`${file}: MCP must reach the Runtime through @symphoneer/runtime-client`);
  }
}

for (const file of globSync("src/cli/**/*.ts")) {
  const source = readFileSync(file, "utf8");
  if (/from ["']@symphoneer\/runtime["']/.test(source)) {
    failures.push(`${file}: CLI must reach the Runtime through @symphoneer/runtime-client`);
  }
}

const architecture = readFileSync("ARCHITECTURE.md", "utf8");
const codemapMatch = architecture.match(/## 当前结构\n\n```text\n([\s\S]*?)```/);
if (!codemapMatch) {
  failures.push("ARCHITECTURE.md: missing 当前结构 Codemap fenced block");
} else {
  const stack = [];
  const codemapPaths = new Set();
  for (const line of codemapMatch[1].split("\n")) {
    if (!line.trim()) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const pathToken = line.trim().split(/\s+/, 1)[0];
    if (!pathToken) continue;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].path : "";
    const fullPath = parent
      ? `${parent}/${pathToken.replace(/\/$/, "")}`
      : pathToken.replace(/\/$/, "");
    stack.push({ indent, path: fullPath });
    codemapPaths.add(fullPath);
    if (!existsSync(fullPath)) {
      failures.push(`ARCHITECTURE.md Codemap: missing path ${fullPath}`);
    }
  }
  for (const directory of [...globSync("src/*"), ...globSync("tests/*")]) {
    if (!statSync(directory).isDirectory() || directory === "src/web/dist") continue;
    if (!codemapPaths.has(directory)) {
      failures.push(`ARCHITECTURE.md Codemap: missing directory entry ${directory}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "project checks: links, Agent navigation, Plan, test placement, dependencies, Codemap paths",
  );
}

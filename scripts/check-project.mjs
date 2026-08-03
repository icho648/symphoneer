import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const failures = [];
const markdownFiles = globSync("**/*.md", {
  exclude: ["node_modules/**", ".workspaces/**", ".symphoneer/**"],
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

for (const directory of [
  "docs/design-docs",
  "docs/product-specs",
  "docs/references",
  "docs/research",
  "docs/exec-plans/active",
  "docs/exec-plans/completed",
]) {
  const index = `${directory}/index.md`;
  const body = readFileSync(index, "utf8");
  for (const leaf of globSync(`${directory}/*.md`)) {
    if (leaf !== index && !body.includes(`(${leaf.slice(directory.length + 1)})`)) {
      failures.push(`${leaf}: missing from ${index}`);
    }
  }
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
for (const plan of globSync("docs/exec-plans/active/*.md", { exclude: ["**/index.md"] })) {
  const sections = [...readFileSync(plan, "utf8").matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  if (JSON.stringify(sections) !== JSON.stringify(requiredPlanSections)) {
    failures.push(`${plan}: expected the 12 required ExecPlan sections in order`);
  }
}

for (const testFile of globSync("**/*.{test,spec}.ts", { exclude: ["node_modules/**"] })) {
  if (!testFile.startsWith("tests/")) failures.push(`${testFile}: tests must live under tests/`);
}

const coreDependencies = Object.keys(
  JSON.parse(readFileSync("packages/symphony-core/package.json", "utf8")).dependencies,
);
for (const forbidden of ["next", "@octokit/rest", "@openai/codex-sdk"]) {
  if (coreDependencies.includes(forbidden)) {
    failures.push(`packages/symphony-core: forbidden dependency ${forbidden}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("project checks: links, indexes, ExecPlan, test placement, dependencies");
}

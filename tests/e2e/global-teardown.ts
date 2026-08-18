import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import v8ToIstanbul from "v8-to-istanbul";

type V8Entry = {
  url: string;
  source?: string;
  functions: Parameters<ReturnType<typeof v8ToIstanbul>["applyCoverage"]>[0];
};

type RawCoverage = {
  entries: V8Entry[];
  status: string | undefined;
  expectedStatus: string;
};

export default async function globalTeardown(): Promise<void> {
  const root = resolve("coverage/browser");
  const raw = resolve(root, "raw");
  const files = await readdir(raw).catch(() => []);
  const coverageMap = libCoverage.createCoverageMap({});
  let scripts = 0;
  let partial = false;

  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const result = JSON.parse(await readFile(resolve(raw, file), "utf8")) as RawCoverage;
    partial ||= result.status !== result.expectedStatus;
    for (const entry of result.entries) {
      if (!entry.source || !entry.url.includes("/assets/") || !entry.url.endsWith(".js")) continue;
      const source = entry.source.replaceAll(/\/\/# sourceMappingURL=[^\r\n]*/g, "");
      const converter = v8ToIstanbul(new URL(entry.url).pathname, 0, { source });
      await converter.load();
      converter.applyCoverage(entry.functions);
      coverageMap.merge(converter.toIstanbul());
      scripts += 1;
    }
  }

  await mkdir(root, { recursive: true });
  const context = libReport.createContext({ dir: root, coverageMap });
  reports.create("html").execute(context);
  reports.create("lcovonly").execute(context);
  await writeFile(
    resolve(root, "scope.json"),
    `${JSON.stringify(
      {
        kind: "browser-bundle-coverage",
        scripts,
        included: "JavaScript bundles loaded by Chromium E2E",
        excluded: ["CSS", "third-party source attribution", "Node Runtime code"],
        partial,
      },
      null,
      2,
    )}\n`,
  );
  await rm(raw, { recursive: true, force: true });
}

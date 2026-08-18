import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    try {
      await use(page);
    } finally {
      const entries = await page.coverage.stopJSCoverage();
      const outputDir = resolve("coverage/browser/raw");
      await mkdir(outputDir, { recursive: true });
      const name = `${testInfo.workerIndex}-${testInfo.retry}-${testInfo.testId}`.replace(
        /[^a-zA-Z0-9_.-]+/g,
        "-",
      );
      await writeFile(
        resolve(outputDir, `${name}.json`),
        JSON.stringify({
          entries,
          status: testInfo.status,
          expectedStatus: testInfo.expectedStatus,
        }),
      );
    }
  },
});

export { expect };

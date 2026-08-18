import { expect, test } from "./fixtures.ts";

test("Workbench connects to an isolated Runtime and shows the empty project", async ({ page }) => {
  await page.goto("/en-US");

  await expect(page.getByRole("status")).toContainText("online");
  await expect(page.getByRole("region", { name: "fixture/empty" })).toContainText(
    "No issues match the current view",
  );
});

test("Task detail restores Attempt activity and evidence after refresh", async ({ page }) => {
  await page.goto("/en-US");
  await page.getByRole("button", { name: /#52 Deterministic browser acceptance/ }).click();

  await expect(
    page.getByRole("heading", { name: "Deterministic browser acceptance" }),
  ).toBeVisible();
  await expect(page.getByLabel("Attempts")).toContainText("Succeeded");
  await expect(page.getByRole("heading", { name: "Execution activity" })).toBeVisible();
  await expect(page.getByText("Deterministic fixture completed.")).toBeVisible();
  const evidence = page.getByRole("region", { name: "Delivery evidence" });
  await expect(evidence).toContainText("Verification");
  await expect(evidence).toContainText("Intentional CI evidence failure");
  await expect(evidence).toContainText("Human decisions");
  await expect(evidence).toContainText("Continue");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Deterministic browser acceptance" }),
  ).toBeVisible();
  await expect(page.getByText("Deterministic fixture completed.")).toBeVisible();
});

test("Workbench explains when Runtime requests fail", async ({ page }) => {
  await page.route(/\/(?:healthz|v1\/.*)$/, (route) => route.abort("connectionrefused"));
  await page.goto("/en-US");

  await expect(page.getByRole("alert")).toContainText("Runtime unavailable");
});

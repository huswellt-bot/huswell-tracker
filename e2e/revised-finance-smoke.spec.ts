import { expect, test } from "@playwright/test";

test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });

test("revised Finance remains protected for unauthenticated users", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  await page.goto("/finance", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("Internal Finance");
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("revised Project Finance Monitoring route remains protected", async ({ page }) => {
  await page.goto("/finance/reports", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  await expect(page.locator("body")).not.toContainText("Application error");
});

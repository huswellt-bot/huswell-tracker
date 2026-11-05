import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:3000" });

test("the application shell loads without a browser error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });

  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("body")).not.toContainText("Application error");
  expect(pageErrors).toEqual([]);
});

test("Lead Costing remains protected for unauthenticated users", async ({ page }) => {
  await page.goto("/lead-coordinator", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  await expect(page.locator("body")).not.toContainText("Application error");
});

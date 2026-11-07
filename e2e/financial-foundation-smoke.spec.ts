import { expect, test } from "@playwright/test";

test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });

test("Financial Foundation remains protected for unauthenticated users", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/finance", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  await expect(page.locator("body")).not.toContainText("Application error");
  expect(pageErrors).toEqual([]);
});

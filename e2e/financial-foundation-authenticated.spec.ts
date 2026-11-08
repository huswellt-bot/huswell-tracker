import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });
test.setTimeout(120_000);
test.describe.configure({ mode: "serial" });

const password = process.env.E2E_STAGING_PASSWORD;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const supabaseAnonKey = process.env.E2E_SUPABASE_ANON_KEY;
const primaryOrganizationId = process.env.E2E_PRIMARY_ORGANIZATION_ID;
const accounts = {
  admin: process.env.E2E_ADMIN_EMAIL ?? "e2e-finance-admin@huswell-staging.test",
  internalFinance: process.env.E2E_INTERNAL_FINANCE_EMAIL ?? "e2e-internal-finance@huswell-staging.test",
  externalFinance: process.env.E2E_EXTERNAL_FINANCE_EMAIL ?? "e2e-external-finance@huswell-staging.test",
  projectManager: process.env.E2E_PROJECT_MANAGER_EMAIL ?? "e2e-project-manager@huswell-staging.test",
  production: process.env.E2E_PRODUCTION_EMAIL ?? "e2e-production@huswell-staging.test",
  isolatedViewer: process.env.E2E_ISOLATED_VIEWER_EMAIL ?? "e2e-isolated-viewer@huswell-staging.test",
};

function browserHealth(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];
  const allowedResponsePatterns: RegExp[] = [];
  let allowedConsoleErrors = 0;

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (allowedConsoleErrors > 0 && text === "Failed to load resource: the server responded with a status of 400 ()") {
        allowedConsoleErrors -= 1;
      } else {
        consoleErrors.push(text);
      }
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "failed";
    const isCanceledNextNavigation = errorText === "net::ERR_ABORTED" && request.url().includes("_rsc=");
    if (!isCanceledNextNavigation) failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && /supabase\.co|\/api\//.test(response.url())) {
      const expectedIndex = allowedResponsePatterns.findIndex((pattern) => pattern.test(response.url()));
      if (expectedIndex >= 0) {
        allowedResponsePatterns.splice(expectedIndex, 1);
      } else {
        failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    }
  });

  return {
    allowExpectedHttpFailure(responsePattern: RegExp) {
      allowedResponsePatterns.push(responsePattern);
      allowedConsoleErrors += 1;
    },
    assert() {
      expect(pageErrors, "browser page errors").toEqual([]);
      expect(failedRequests, "failed browser requests").toEqual([]);
      expect(failedResponses, "failed API responses").toEqual([]);
      expect(consoleErrors, "browser console errors").toEqual([]);
      expect(allowedResponsePatterns, "expected API validation responses").toEqual([]);
    },
  };
}

async function login(page: Page, email: string) {
  if (!password) throw new Error("E2E_STAGING_PASSWORD is required");
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("name@company.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Sign out", exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

async function openFoundation(page: Page) {
  const foundationButton = page.getByRole("button", { name: "Financial Foundation", exact: true }).first();
  const financeMenu = page.getByRole("button", { name: "Finance menu", exact: true });
  if (!(await foundationButton.isVisible({ timeout: 1_000 }).catch(() => false)) && await financeMenu.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await financeMenu.click();
  }
  await expect(foundationButton).toBeVisible({ timeout: 15_000 });
  await foundationButton.click();
  await expect(page.getByRole("heading", { name: "Financial Foundation", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Project money, Company Working Funds, labor, operating costs, and break-even in one controlled flow.")).toBeVisible({ timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Sign out?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
}

async function notification(page: Page, message: string) {
  const dialog = page.getByRole("dialog").filter({ hasText: message });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Okay", exact: true }).click();
}

function panel(page: Page, heading: string) {
  return page.locator("section").filter({ hasText: heading }).first();
}

async function selectOptionContaining(select: Locator, text: string) {
  const option = await select.locator("option").evaluateAll((options, needle) => {
    const found = options.find((candidate) => (candidate.textContent ?? "").includes(String(needle)));
    return found ? { label: found.textContent ?? "", value: (found as HTMLOptionElement).value } : null;
  }, text);
  if (!option?.value) throw new Error(`No option found containing ${text}`);
  await select.selectOption(option.value);
}

async function chooseSearchableOption(scope: Locator, label: string, optionText?: string) {
  await scope.getByRole("button", { name: label, exact: true }).click();
  const options = scope.getByRole("option");
  const option = optionText ? options.filter({ hasText: optionText }).first() : options.first();
  await expect(option).toBeVisible();
  await option.click();
}

test("admin completes the financial foundation controls and labor payment flow", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.admin);
  await openFoundation(page);

  await expect(page.getByText("Working Funds", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Break-even", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Break-even and sales quota", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit settings", exact: true }).click();
  await page.getByLabel("Desired monthly profit").fill("60000");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await notification(page, "Financial foundation settings saved.");

  await page.getByRole("button", { name: "Working Funds", exact: true }).click();
  const workingPanel = panel(page, "Company Working Funds");
  await workingPanel.getByRole("button", { name: "Record entry", exact: true }).click();
  const workingDialog = page.getByRole("dialog", { name: "Record Working Funds entry" });
  await workingDialog.getByLabel("Amount").fill("10000");
  await workingDialog.getByLabel("Reference no.").fill("E2E-WF-001");
  await workingDialog.getByLabel("Purpose / note").fill("Safe staging working funds inflow");
  await workingDialog.getByRole("button", { name: "Record entry", exact: true }).click();
  await notification(page, "Working Funds entry recorded.");
  await expect(page.getByText("E2E-WF-001", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Budget & allocations", exact: true }).click();
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  const grantDialog = page.getByRole("dialog", { name: "Add GM budget" });
  await grantDialog.getByLabel("Approved amount").fill("5000");
  await grantDialog.getByLabel("Note").fill("E2E staging budget allocation");
  await grantDialog.getByRole("button", { name: "Save budget", exact: true }).click();
  await notification(page, "GM budget added to this month.");
  await page.getByRole("button", { name: "Allocate budget", exact: true }).click();
  const allocationDialog = page.getByRole("dialog", { name: "Allocate budget to account" });
  await allocationDialog.locator("select").first().selectOption({ label: "E2E Demo Staging Bank" });
  await allocationDialog.getByLabel("Amount", { exact: true }).fill("5000");
  await allocationDialog.getByRole("button", { name: "Allocate", exact: true }).click();
  await notification(page, "Budget allocated to the Finance account.");

  await openFoundation(page);
  await page.getByRole("button", { name: "Project Funds", exact: true }).click();
  const fundPanel = panel(page, "Automatic Project Fund creation");
  await expect(fundPanel).toContainText("No manual setup is required.");
  await expect(fundPanel.getByRole("button", { name: "Create Project Fund", exact: true })).toHaveCount(0);
  await expect(page.getByText("E2E Project Alpha", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("E2E Project Beta", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Labor Payments", exact: true }).click();
  const laborRatePanel = panel(page, "Individual Box Maker Labor Rates");
  await laborRatePanel.getByRole("button", { name: "Assign rate", exact: true }).click();
  const laborRateDialog = page.getByRole("dialog", { name: "Assign individual box-maker labor rate" });
  await selectOptionContaining(laborRateDialog.getByLabel("Project Fund"), "E2E Project Alpha");
  await laborRateDialog.getByLabel("Box maker").fill("E2E Maker");
  await laborRateDialog.getByLabel("Assigned work").fill("Assembly");
  await laborRateDialog.getByLabel("Unit", { exact: true }).fill("box");
  await laborRateDialog.getByLabel("Agreed unit rate").fill("100");
  await laborRateDialog.getByLabel("Planned quantity").fill("100");
  await laborRateDialog.getByLabel("Total agreed labor rate").fill("10000");
  await laborRateDialog.getByRole("button", { name: "Assign rate", exact: true }).click();
  await notification(page, "Individual project labor rate assigned.");
  await expect(laborRatePanel).toContainText("E2E Maker");

  await page.getByRole("button", { name: "Work accomplishment", exact: true }).click();
  const accomplishmentPanel = panel(page, "Verified work accomplishment");
  await accomplishmentPanel.getByRole("button", { name: "Submit accomplishment", exact: true }).click();
  const accomplishmentDialog = page.getByRole("dialog", { name: "Submit verified work accomplishment" });
  await selectOptionContaining(accomplishmentDialog.getByLabel("Labor rate"), "E2E Maker");
  await accomplishmentDialog.getByLabel("Accomplishment date").fill("2026-11-06");
  await accomplishmentDialog.getByLabel("Completed quantity").fill("10");
  await accomplishmentDialog.getByLabel("Accepted quantity").fill("10");
  await accomplishmentDialog.getByLabel("Rejected quantity").fill("0");
  await accomplishmentDialog.getByRole("button", { name: "Submit accomplishment", exact: true }).click();
  await notification(page, "Work accomplishment submitted for verification.");
  await accomplishmentPanel.getByRole("button", { name: "Verify", exact: true }).click();
  await notification(page, "Accomplishment verified.");

  health.assert();
});

test("internal and external finance have the intended foundation boundaries", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.internalFinance);
  await openFoundation(page);
  await page.getByRole("button", { name: "Working Funds", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record entry", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Operating Costs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add recurring cost", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Planned / paid costs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record planned cost", exact: true })).toHaveCount(0);
  health.assert();

  await signOut(page);
  await login(page, accounts.externalFinance);
  await openFoundation(page);
  await page.getByRole("button", { name: "Working Funds", exact: true }).click();
  await expect(page.getByText("Read-only view. Internal Finance records company-level Working Funds adjustments.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record entry", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Operating Costs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add recurring cost", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add recurring cost", exact: true }).click();
  const recurringDialog = page.getByRole("dialog", { name: "Add recurring operating-cost template" });
  await recurringDialog.getByLabel("Cost name").fill("E2E Subscription");
  await recurringDialog.getByLabel("Category").fill("Subscription");
  await recurringDialog.getByLabel("Expected monthly amount").fill("1000");
  await recurringDialog.getByRole("button", { name: "Save template", exact: true }).click();
  await notification(page, "Operating cost template saved.");
  await expect(panel(page, "Recurring operational cost templates")).toContainText("E2E Subscription");

  await page.getByRole("button", { name: "Planned / paid costs", exact: true }).click();
  await page.getByRole("button", { name: "Record planned cost", exact: true }).click();
  const plannedCostDialog = page.getByRole("dialog", { name: "Record planned operating cost" });
  await plannedCostDialog.getByLabel("Cost name").fill("E2E Subscription November");
  await plannedCostDialog.getByLabel("Category").fill("Subscription");
  await plannedCostDialog.getByLabel("Amount").fill("1000");
  await plannedCostDialog.getByLabel("Note").fill("E2E planned operating cost");
  await plannedCostDialog.getByRole("button", { name: "Record planned cost", exact: true }).click();
  await notification(page, "Operating cost recorded.");
  await expect(panel(page, "Planned operating costs")).toContainText("E2E Subscription November");

  await page.getByRole("button", { name: "Transaction", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transaction history", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cash Out", exact: true }).first().click();
  const cashOutDialog = page.getByRole("dialog").last();
  await cashOutDialog.getByRole("button", { name: "Operating cost", exact: true }).click();
  await chooseSearchableOption(cashOutDialog, "Planned operating cost", "E2E Subscription November");
  await cashOutDialog.getByRole("button", { name: "Expense category", exact: true }).click();
  await cashOutDialog.getByRole("option", { name: "Add new", exact: true }).click();
  const categoryDialog = page.getByRole("dialog", { name: "Add expense category" });
  await categoryDialog.getByLabel("Category name").fill("E2E Operating Category");
  await categoryDialog.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(categoryDialog.getByRole("status")).toContainText("Category added. You can add another.");
  await categoryDialog.getByRole("button", { name: "Done", exact: true }).click();
  await chooseSearchableOption(cashOutDialog, "Payment account", "E2E Demo Staging Bank");
  await cashOutDialog.locator('input[type="file"]').setInputFiles({
    name: "e2e-cash-out-receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await cashOutDialog.getByRole("button", { name: "Submit operating cost", exact: true }).click();
  await notification(page, "Cash Out submitted for Internal Finance approval.");
  health.assert();

  await signOut(page);
  await login(page, accounts.internalFinance);
  await page.getByRole("button", { name: "Pending approvals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pending approvals", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Cash Out \(/ }).click();
  const pendingCashOut = page.locator(".finance-approval-table tbody tr")
    .filter({ hasText: "E2E Demo Staging Bank" })
    .filter({ hasText: "₱1,000.00" })
    .first();
  await expect(pendingCashOut).toBeVisible();
  await pendingCashOut.getByRole("button", { name: "Review Cash Out", exact: true }).click();
  const reviewDialog = page.getByRole("dialog", { name: "Regular expenses review" });
  await reviewDialog.getByRole("button", { name: "Verify Cash Out", exact: true }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Verify Cash Out regular Cash Out" });
  await confirmDialog.getByRole("button", { name: "Verify Cash Out", exact: true }).click();
  await notification(page, "Cash Out verified. External Finance can now release it from the selected account.");
  health.assert();

  await signOut(page);
  await login(page, accounts.externalFinance);
  await page.getByRole("button", { name: "Transaction", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transaction history", exact: true })).toBeVisible();
  const verifiedCashOut = page.locator("table tbody tr")
    .filter({ hasText: "E2E Demo Staging Bank" })
    .filter({ hasText: "₱1,000.00" })
    .last();
  await expect(verifiedCashOut).toBeVisible();
  await verifiedCashOut.getByRole("button", { name: "Release payment", exact: true }).click();
  const releaseDialog = page.getByRole("dialog", { name: "Mark paid Cash Out" });
  await expect(releaseDialog).toBeVisible();
  await releaseDialog.getByRole("button", { name: "Mark paid", exact: true }).click();
  await notification(page, "Cash Out released and the selected account was deducted.");
  health.assert();
});

test("project and production roles see only their operational foundation surface", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.projectManager);
  await openFoundation(page);
  const foundationSections = page.getByRole("navigation", { name: "Financial Foundation sections" });
  await expect(foundationSections.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(0);
  await expect(foundationSections.getByRole("button", { name: "Working Funds", exact: true })).toHaveCount(0);
  await expect(foundationSections.getByRole("button", { name: "Project Funds", exact: true })).toBeVisible();
  await expect(foundationSections.getByRole("button", { name: "Labor Payments", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request support", exact: true })).toBeVisible();
  await foundationSections.getByRole("button", { name: "Labor Payments", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assign rate", exact: true })).toBeVisible();
  health.assert();

  await signOut(page);
  await login(page, accounts.production);
  await openFoundation(page);
  const productionSections = page.getByRole("navigation", { name: "Financial Foundation sections" });
  await expect(productionSections.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(0);
  await expect(productionSections.getByRole("button", { name: "Working Funds", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Labor Payments", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assign rate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare run", exact: true })).toHaveCount(0);
  health.assert();
});

test("unauthorized users cannot enter finance and RLS isolates the second organization", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.isolatedViewer);
  await page.goto("/finance", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/finance(?:\?|$)/);

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText("Financial Foundation", { exact: true })).toHaveCount(0);
  await expect(page.getByText("E2E Project Alpha", { exact: true })).toHaveCount(0);

  if (!supabaseUrl || !supabaseAnonKey || !primaryOrganizationId) {
    throw new Error("E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, and E2E_PRIMARY_ORGANIZATION_ID are required for the RLS check");
  }
  if (!password) throw new Error("E2E_STAGING_PASSWORD is required for the RLS check");
  const tokenResponse = await page.request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: supabaseAnonKey,
      "content-type": "application/json",
    },
    data: {
      email: accounts.isolatedViewer,
      password,
    },
  });
  expect(tokenResponse.ok()).toBeTruthy();
  const accessToken = (await tokenResponse.json()).access_token;
  if (typeof accessToken !== "string" || !accessToken) throw new Error("Staging Auth did not return an access token");
  const response = await page.request.get(`${supabaseUrl}/rest/v1/finance_project_fund_summary?select=id,project_name&organization_id=eq.${primaryOrganizationId}`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual([]);
  health.assert();
});

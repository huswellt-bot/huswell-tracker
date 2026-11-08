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
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Sign out", exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

async function openFoundation(page: Page) {
  const foundationButton = page.getByRole("button", { name: "Financial Foundation", exact: true }).first();
  const financeMenu = page.getByRole("button", { name: "Finance menu", exact: true });
  if (await financeMenu.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await financeMenu.click();
  } else {
    await expect(foundationButton).toBeVisible({ timeout: 15_000 });
  }
  await expect(foundationButton).toBeVisible();
  await foundationButton.click();
  await expect(page.getByRole("heading", { name: "Financial Foundation", exact: true })).toBeVisible();
  await expect(page.getByText("Project money, Company Working Funds, labor, operating costs, and break-even in one controlled flow.")).toBeVisible();
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

test("admin completes the financial foundation controls and labor payment flow", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.admin);
  await openFoundation(page);

  await expect(page.getByText("Working Funds", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("₱200,000.00", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Break-even", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Break-even and sales quota", exact: true })).toBeVisible();
  await page.getByLabel("Desired monthly profit").fill("60000");
  await page.getByRole("button", { name: "Save foundation settings", exact: true }).click();
  await notification(page, "Financial foundation settings saved.");

  await page.getByRole("button", { name: "Working Funds", exact: true }).click();
  const workingPanel = panel(page, "Company Working Funds");
  await workingPanel.getByLabel("Amount").fill("10000");
  await workingPanel.getByLabel("Reference no.").fill("E2E-WF-001");
  await workingPanel.getByLabel("Purpose / note").fill("Safe staging working funds inflow");
  await workingPanel.getByRole("button", { name: "Record Working Funds entry", exact: true }).click();
  await notification(page, "Working Funds entry recorded.");
  await expect(page.getByText("E2E-WF-001", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Operating Costs", exact: true }).click();
  const recurringPanel = panel(page, "Recurring operational cost templates");
  await recurringPanel.getByLabel("Cost name").fill("E2E Subscription");
  await recurringPanel.getByLabel("Category").fill("Subscription");
  await recurringPanel.getByLabel("Expected monthly amount").fill("1000");
  await recurringPanel.getByRole("button", { name: "Save recurring cost", exact: true }).click();
  await notification(page, "Operating cost template saved.");
  await expect(recurringPanel).toContainText("E2E Subscription");

  const monthlyPanel = panel(page, "Monthly operational cost entries");
  await monthlyPanel.getByLabel("Cost name").fill("E2E Subscription November");
  await monthlyPanel.getByLabel("Category").fill("Subscription");
  await monthlyPanel.getByLabel("Amount").fill("1000");
  await monthlyPanel.getByLabel("Status").selectOption("paid");
  await monthlyPanel.getByRole("button", { name: "Record operating cost", exact: true }).click();
  await notification(page, "Operating cost recorded.");
  await expect(monthlyPanel).toContainText("E2E Subscription November");

  await page.getByRole("button", { name: "Project Funds", exact: true }).click();
  const fundPanel = panel(page, "Automatic Project Fund creation");
  await expect(fundPanel).toContainText("No manual setup is required.");
  await expect(fundPanel.getByRole("button", { name: "Create Project Fund", exact: true })).toHaveCount(0);
  await expect(page.getByText("E2E Project Alpha", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("E2E Project Beta", { exact: true }).first()).toBeVisible();

  const advancePanel = panel(page, "Company Working Fund advance");
  await selectOptionContaining(advancePanel.getByLabel("Project"), "E2E Project Alpha");
  await advancePanel.getByLabel("Requested amount").fill("20000");
  await advancePanel.getByLabel("Reason").fill("Temporary staging support before client collection");
  await advancePanel.getByRole("button", { name: "Request temporary support", exact: true }).click();
  await notification(page, "Company Working Fund advance requested.");
  const approvalsPanel = panel(page, "Advance approvals and repayments");
  await approvalsPanel.getByRole("button", { name: "Approve", exact: true }).click();
  await notification(page, "Company advance approved.");
  await approvalsPanel.getByRole("button", { name: "Release", exact: true }).click();
  await notification(page, "Company advance released to the Project Fund.");

  await page.getByRole("button", { name: "Labor Payments", exact: true }).click();
  const laborRatePanel = panel(page, "Individual Box Maker Labor Rates");
  await selectOptionContaining(laborRatePanel.getByLabel("Project Fund"), "E2E Project Alpha");
  await laborRatePanel.getByLabel("Box maker").fill("E2E Maker");
  await laborRatePanel.getByLabel("Assigned work").fill("Assembly");
  await laborRatePanel.getByLabel("Unit", { exact: true }).fill("box");
  await laborRatePanel.getByLabel("Agreed unit rate").fill("100");
  await laborRatePanel.getByLabel("Planned quantity").fill("100");
  await laborRatePanel.getByLabel("Total agreed labor rate").fill("10000");
  await laborRatePanel.getByRole("button", { name: "Assign labor rate", exact: true }).click();
  await notification(page, "Individual project labor rate assigned.");
  await expect(laborRatePanel).toContainText("E2E Maker");

  const accomplishmentPanel = panel(page, "Verified work accomplishment");
  await selectOptionContaining(accomplishmentPanel.getByLabel("Labor rate"), "E2E Maker");
  await accomplishmentPanel.getByLabel("Accomplishment date").fill("2026-11-06");
  await accomplishmentPanel.getByLabel("Completed quantity").fill("10");
  await accomplishmentPanel.getByLabel("Accepted quantity").fill("10");
  await accomplishmentPanel.getByLabel("Rejected quantity").fill("0");
  await accomplishmentPanel.getByRole("button", { name: "Submit accomplishment", exact: true }).click();
  await notification(page, "Work accomplishment submitted for verification.");
  await accomplishmentPanel.getByRole("button", { name: "Verify", exact: true }).click();
  await notification(page, "Accomplishment verified.");

  const runPanel = panel(page, "Tuesday & Friday payment runs");
  await runPanel.getByLabel("Payment date").fill("2026-11-07");
  health.allowExpectedHttpFailure(/\/rest\/v1\/rpc\/create_labor_payment_run/);
  await runPanel.getByRole("button", { name: "Prepare payment run", exact: true }).click();
  await notification(page, "Labor payments can only be scheduled for Tuesday or Friday");
  await runPanel.getByLabel("Payment date").fill("2026-11-06");
  await runPanel.getByLabel("Run note").fill("E2E Friday labor run");
  await runPanel.getByRole("button", { name: "Prepare payment run", exact: true }).click();
  await notification(page, "Labor payment run prepared.");
  await runPanel.getByRole("button", { name: "Approve", exact: true }).click();
  await notification(page, "Labor payment run approved.");
  await runPanel.getByRole("button", { name: "Post payment", exact: true }).click();
  await notification(page, "Labor payment run posted to Project Funds.");
  await expect(runPanel).toContainText("paid");

  health.assert();
});

test("internal finance can manage while external finance is read-only", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.internalFinance);
  await openFoundation(page);
  await page.getByRole("button", { name: "Working Funds", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record Working Funds entry", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Operating Costs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save recurring cost", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record operating cost", exact: true })).toBeVisible();
  health.assert();

  await signOut(page);
  await login(page, accounts.externalFinance);
  await openFoundation(page);
  await page.getByRole("button", { name: "Working Funds", exact: true }).click();
  await expect(page.getByText("Read-only view. Finance managers record Company Working Funds entries.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record Working Funds entry", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Operating Costs", exact: true }).click();
  await expect(page.getByText("Read-only view. Finance managers maintain operational cost assumptions.", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Request temporary support", exact: true })).toBeVisible();
  await foundationSections.getByRole("button", { name: "Labor Payments", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assign labor rate", exact: true })).toBeVisible();
  health.assert();

  await signOut(page);
  await login(page, accounts.production);
  await openFoundation(page);
  const productionSections = page.getByRole("navigation", { name: "Financial Foundation sections" });
  await expect(productionSections.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(0);
  await expect(productionSections.getByRole("button", { name: "Working Funds", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Labor Payments", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assign labor rate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare payment run", exact: true })).toHaveCount(0);
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

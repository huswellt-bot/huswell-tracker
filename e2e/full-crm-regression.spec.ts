import { expect, test, type Page } from "@playwright/test";

test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001" });
test.setTimeout(180_000);

type Role =
  | "super_admin"
  | "owner"
  | "admin"
  | "internal_finance"
  | "external_finance"
  | "project_manager"
  | "production"
  | "sales_pricing_officer"
  | "lead_coordinator"
  | "payroll"
  | "accountant"
  | "viewer";

type RoleAccount = { role: Role; email: string; landing: RegExp };

const password = process.env.E2E_STAGING_PASSWORD;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const supabaseAnonKey = process.env.E2E_SUPABASE_ANON_KEY;
const primaryOrganizationId = process.env.E2E_PRIMARY_ORGANIZATION_ID ?? "ff400ee3-ab6a-4072-9952-7d9a61b203ef";
const quotationId = process.env.E2E_QUOTATION_ID ?? "e2c1fd50-8ae2-4cba-9199-b15dd7084eef";

const accounts: RoleAccount[] = [
  { role: "super_admin", email: "e2e-super-admin-audit@huswell-staging.test", landing: /\/super-admin(?:\?|$)/ },
  { role: "owner", email: "e2e-owner-audit@huswell-staging.test", landing: /\/admin(?:\?|$)/ },
  { role: "admin", email: process.env.E2E_ADMIN_EMAIL ?? "e2e-finance-admin@huswell-staging.test", landing: /\/admin(?:\?|$)/ },
  { role: "internal_finance", email: process.env.E2E_INTERNAL_FINANCE_EMAIL ?? "e2e-internal-finance@huswell-staging.test", landing: /\/finance(?:\?|$)/ },
  { role: "external_finance", email: process.env.E2E_EXTERNAL_FINANCE_EMAIL ?? "e2e-external-finance@huswell-staging.test", landing: /\/finance(?:\?|$)/ },
  { role: "project_manager", email: process.env.E2E_PROJECT_MANAGER_EMAIL ?? "e2e-project-manager@huswell-staging.test", landing: /\/project-manager(?:\?|$)/ },
  { role: "production", email: process.env.E2E_PRODUCTION_EMAIL ?? "e2e-production@huswell-staging.test", landing: /\/$/ },
  { role: "sales_pricing_officer", email: process.env.E2E_SALES_PRICING_EMAIL ?? "e2e-sales-pricing@huswell-staging.test", landing: /\/project-manager(?:\?|$)/ },
  { role: "lead_coordinator", email: "e2e-lead-coordinator-audit@huswell-staging.test", landing: /\/lead-coordinator(?:\?|$)/ },
  { role: "payroll", email: "e2e-payroll-audit@huswell-staging.test", landing: /\/$/ },
  { role: "accountant", email: "e2e-accountant-audit@huswell-staging.test", landing: /\/$/ },
  { role: "viewer", email: process.env.E2E_ISOLATED_VIEWER_EMAIL ?? "e2e-isolated-viewer@huswell-staging.test", landing: /\/$/ },
];

const directRoutes = [
  "/",
  "/admin",
  "/accountant",
  "/finance",
  "/finance/reports",
  "/lead-coordinator",
  "/pricing-officer",
  "/profile",
  "/project-manager",
  `/quotation-viewer?quotationId=${quotationId}`,
  "/super-admin",
] as const;

const routeRoles: Record<string, Role[]> = {
  "/admin": ["super_admin", "owner", "admin"],
  "/accountant": ["accountant"],
  "/finance": ["super_admin", "owner", "admin", "internal_finance", "external_finance"],
  "/finance/reports": ["admin", "internal_finance", "external_finance"],
  "/lead-coordinator": ["lead_coordinator"],
  "/pricing-officer": ["sales_pricing_officer"],
  "/profile": ["super_admin", "owner", "admin", "internal_finance", "external_finance", "project_manager", "sales_pricing_officer", "lead_coordinator"],
  "/project-manager": ["project_manager", "sales_pricing_officer"],
  "/super-admin": ["super_admin"],
};

function browserHealth(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text() !== "Failed to load resource: the server responded with a status of 400 ()") {
      consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "failed";
    const isCanceledNextNavigation = errorText === "net::ERR_ABORTED" && request.url().includes("_rsc=");
    if (!isCanceledNextNavigation) failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("response", (response) => {
    const expectedInvalidAuth = response.status() === 400 && /supabase\.co\/auth\/v1\/token/.test(response.url());
    if (response.status() >= 400 && !expectedInvalidAuth && /supabase\.co|\/api\//.test(response.url())) {
      failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return {
    snapshot() {
      return { pageErrors, consoleErrors, failedRequests, failedResponses };
    },
    assert(label: string) {
      console.log(JSON.stringify({ health: label, pageErrors, consoleErrors, failedRequests, failedResponses }));
      expect(pageErrors, `${label}: browser page errors`).toEqual([]);
      expect(consoleErrors, `${label}: browser console errors`).toEqual([]);
      expect(failedRequests, `${label}: failed browser requests`).toEqual([]);
      expect(failedResponses, `${label}: failed API/network responses`).toEqual([]);
    },
  };
}

async function login(page: Page, email: string) {
  if (!password) throw new Error("E2E_STAGING_PASSWORD is required");
  await gotoWithRetry(page, "/auth", "domcontentloaded");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("name@company.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /^Sign Out$/i }).first()).toBeVisible({ timeout: 20_000 });
}

async function gotoWithRetry(page: Page, url: string, waitUntil: "domcontentloaded" | "networkidle" = "domcontentloaded") {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.goto(url, { waitUntil });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes("ERR_NETWORK_IO_SUSPENDED") || attempt === 2) throw error;
      await page.waitForTimeout(750);
    }
  }
  throw lastError;
}

async function assertNoApplicationError(page: Page, label: string) {
  await expect(page.locator("body"), `${label}: application error page`).not.toContainText("Application error");
  await expect(page.locator("body"), `${label}: unhandled error page`).not.toContainText("Unhandled Runtime Error");
}

async function waitForWorkspaceIdle(page: Page) {
  const loadingStates = page.getByRole("status").filter({ hasText: /Loading records|Updating data|Refreshing data/ });
  await expect(loadingStates).toHaveCount(0, { timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(750);
}

async function openManagementFinanceMenu(page: Page) {
  const financeMenu = page.getByRole("button", { name: "Finance menu", exact: true });
  if (await financeMenu.isVisible().catch(() => false)) {
    const expanded = await financeMenu.getAttribute("aria-expanded");
    if (expanded !== "true") await financeMenu.click();
  }
}

async function visibleSidebarLabels(page: Page) {
  await openManagementFinanceMenu(page);
  const labels = await page.locator("nav.sidebar-scroll button.sidebar-item").evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const element = button as HTMLElement;
        return element.offsetParent !== null && button.getAttribute("aria-label") !== "Finance menu";
      })
      .map((button) => button.getAttribute("aria-label") || (button.textContent ?? "").trim())
      .filter(Boolean),
  );
  return [...new Set(labels)];
}

async function auditVisibleNavigation(page: Page, role: Role) {
  const labels = await visibleSidebarLabels(page);
  expect(labels.length, `${role}: sidebar should expose navigation items`).toBeGreaterThan(0);
  for (const label of labels) {
    const item = page.getByRole("button", { name: label, exact: true }).first();
    if (!(await item.isVisible().catch(() => false))) continue;
    await item.click();
    await waitForWorkspaceIdle(page);
    await assertNoApplicationError(page, `${role}/${label}`);
  }
  return labels;
}

async function inspectForms(page: Page, role: Role) {
  const controls = await page.locator("input, textarea, select, [role=dialog] button").evaluateAll((elements) =>
    elements.filter((element) => (element as HTMLElement).offsetParent !== null).map((element) => ({
      tag: element.tagName.toLowerCase(),
      label: element.getAttribute("aria-label") || element.getAttribute("name") || element.getAttribute("placeholder") || "",
      required: element.hasAttribute("required"),
    })),
  );
  expect(controls, `${role}: form inspection should complete`).toBeTruthy();
  return controls;
}

async function stagingToken(page: Page, email: string) {
  if (!supabaseUrl || !supabaseAnonKey || !password) throw new Error("Staging Auth variables are required");
  const response = await page.request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: supabaseAnonKey, "content-type": "application/json" },
    data: { email, password },
  });
  expect(response.ok(), "staging auth token request").toBeTruthy();
  const body = await response.json() as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) throw new Error("Staging Auth did not return an access token");
  return body.access_token;
}

for (const account of accounts) {
  test(`role audit: ${account.role}`, async ({ page }) => {
    const health = browserHealth(page);
    await login(page, account.email);
    await expect(page).toHaveURL(account.landing);
    await assertNoApplicationError(page, `${account.role}/landing`);

    const labels = account.role === "super_admin"
      ? await page.getByRole("button").evaluateAll((buttons) => buttons
          .filter((button) => (button as HTMLElement).offsetParent !== null)
          .map((button) => (button.textContent ?? "").trim())
          .filter(Boolean))
      : await auditVisibleNavigation(page, account.role);
    if (account.role === "super_admin") {
      await expect(page.getByRole("heading", { name: "Super Admin Account", exact: true })).toBeVisible();
    }
    const formControls = await inspectForms(page, account.role);
    console.log(JSON.stringify({ role: account.role, sidebar_items: labels, visible_form_controls: formControls.length }));

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/", "domcontentloaded");
    await assertNoApplicationError(page, `${account.role}/mobile`);
    await expect(page.locator("body")).toContainText(/Sign Out/i);
    await page.setViewportSize({ width: 1280, height: 900 });

    if (account.role === "viewer") {
      await expect(page.locator("body")).not.toContainText("E2E Project Alpha");
    }
    health.assert(account.role);
  });
}

test("protected route matrix rejects unauthorized roles and preserves allowed routes", async ({ page }) => {
  test.setTimeout(900_000);
  for (const account of accounts) {
    await login(page, account.email);
    for (const route of directRoutes) {
      const response = await gotoWithRetry(page, route, "domcontentloaded");
      await page.waitForTimeout(250);
      await assertNoApplicationError(page, `${account.role}${route}`);
      const routePath = route.split("?")[0];
      if (routePath === "/" || routePath === "/quotation-viewer") continue;
      const shouldStay = routeRoles[routePath]?.includes(account.role) ?? false;
      if (shouldStay) {
        const canonicalPath = account.role === "super_admin" && routePath !== "/finance" && routePath !== "/super-admin"
          ? "/super-admin"
          : routePath;
        expect(page.url(), `${account.role} should access ${route}`).toContain(canonicalPath);
      } else {
        expect(page.url(), `${account.role} should not access ${route}`).not.toContain(routePath);
      }
      if (routePath !== "/quotation-viewer") expect(response?.status() ?? 200).toBeLessThan(500);
    }
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => undefined);
  }
});

test("authenticated session can sign out cleanly", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.find((account) => account.role === "admin")!.email);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForTimeout(250);
  const dialog = page.getByRole("dialog", { name: "Sign out?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth(?:\?|$)/, { timeout: 15_000 });
  health.assert("authenticated session sign-out");
});

test("unauthenticated routes, validation errors, and protected APIs are safe", async ({ page }) => {
  const health = browserHealth(page);
  await gotoWithRetry(page, "/auth", "domcontentloaded");
  await page.waitForLoadState("networkidle");
  await expect(page.getByPlaceholder("name@company.com")).toBeVisible();

  const invalidLogin = page.getByRole("button", { name: "Sign in", exact: true });
  await page.getByPlaceholder("name@company.com").fill("e2e-invalid-account@huswell-staging.test");
  await page.locator('input[type="password"]').fill("invalid-password");
  await invalidLogin.click();
  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  await expect(page.locator("body")).toContainText(/invalid|incorrect|failed|error/i);

  const template = await page.request.get("/api/leads/import?template=1");
  expect(template.status()).toBe(200);
  expect(template.headers()["content-type"]).toContain("spreadsheetml");

  const missingTemplate = await page.request.get("/api/leads/import");
  expect(missingTemplate.status()).toBe(404);
  const missingImport = await page.request.post("/api/leads/import", { data: {} });
  expect(missingImport.status()).toBe(400);

  const missingExtraction = await page.request.post("/api/costing-requests/extract", { data: {} });
  expect(missingExtraction.status()).toBe(400);
  const invalidPdf = await page.request.post("/api/quotation-pdf", { data: { html: "", documentId: "bad", documentType: "bad" } });
  expect(invalidPdf.status()).toBe(400);
  const missingPayment = await page.request.post("/api/quotation-payments/submit", {
    headers: { Origin: test.info().project.use.baseURL as string },
    data: {},
  });
  expect([400, 403]).toContain(missingPayment.status());

  const protectedApis = ["/api/backups/export?resource=leads", "/api/staff/project-managers", "/api/super-admin/users"];
  for (const endpoint of protectedApis) {
    const response = await page.request.get(endpoint);
    expect(response.status(), `${endpoint} should require authentication`).toBeGreaterThanOrEqual(401);
    expect(response.status(), `${endpoint} should not be a server crash`).toBeLessThan(500);
  }
  health.assert("unauthenticated and validation APIs");
});

test("second organization cannot read primary organization data through RLS", async ({ page }) => {
  const health = browserHealth(page);
  const isolated = accounts.find((account) => account.role === "viewer");
  if (!isolated) throw new Error("Isolated viewer account is required");
  const token = await stagingToken(page, isolated.email);

  if (!supabaseUrl || !supabaseAnonKey) throw new Error("Staging Supabase variables are required");
  const headers = { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` };
  for (const table of ["finance_project_fund_summary", "leads", "quotations"]) {
    const response = await page.request.get(`${supabaseUrl}/rest/v1/${table}?select=id&organization_id=eq.${primaryOrganizationId}`, { headers });
    expect(response.ok(), `${table} RLS query`).toBeTruthy();
    expect(await response.json(), `${table} must not leak primary organization rows`).toEqual([]);
  }

  await login(page, isolated.email);
  await gotoWithRetry(page, "/", "networkidle");
  await expect(page.locator("body")).not.toContainText("E2E Project Alpha");
  await expect(page.getByRole("button", { name: "Financial Foundation", exact: true })).toHaveCount(0);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear()).catch(() => undefined);
  health.assert("second-organization RLS");
});

test("financial foundation is responsive on desktop and mobile for an authorized role", async ({ page }) => {
  const health = browserHealth(page);
  await login(page, accounts.find((account) => account.role === "admin")!.email);
  await openManagementFinanceMenu(page);
  await page.getByRole("button", { name: "Financial Foundation", exact: true }).click();
  await waitForWorkspaceIdle(page);
  await expect(page.getByRole("heading", { name: "Financial Foundation", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoApplicationError(page, "financial foundation/mobile");
  await expect(page.getByRole("heading", { name: "Financial Foundation", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("heading", { name: "Financial Foundation", exact: true })).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear()).catch(() => undefined);
  health.assert("financial foundation responsive");
});

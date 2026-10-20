# Finance project-expense cap and project-history toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the approved quotation's Total Direct Cost as the cumulative ceiling for External Finance project expenses, show the selected project's remaining capacity before submission, and replace the Internal Finance combined project-history table with a Cash In/Cash Out toggle and direction-specific totals.

**Architecture:** Keep the existing finance transaction RPC signatures and role boundaries. Add one server-side projection for per-quotation direct-cost capacity and one private database guard that serializes quote-linked External Finance expense submissions; reuse the existing quotation/direct-cost calculation and verified project-history flow. Add only small pure money/status helpers for testable client validation, then update the existing finance workspace and project dialog rather than introducing new UI infrastructure.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/PostgreSQL migrations, existing `SearchableSelect`, `NumberInput`, Lucide/UI conventions, and Node's built-in `node:test` runner with TypeScript stripping.

**Spec:** `docs/superpowers/specs/2026-10-20-finance-project-expense-cap-and-history-toggle-design.md`

## Global Constraints

- Only approved direct Price Quotations (`document_type = 'price_quotation'`, `status = 'approved'`, `costing_source_id IS NULL`) are selectable for the new External Finance Project Expense flow.
- The ceiling is the quotation's calculated Total Direct Cost using the same fixed-amount and quantity-times-unit-cost rules as migration 230.
- Active project-expense commitments include non-voided quote-linked expense transactions whose approval status is not `rejected`, `revision_requested`, or `cancelled`; pending, approved, and paid amounts reserve capacity.
- Supplier payments linked to the quotation count toward the capacity; commission payouts do not.
- A returned transaction must release its old commitment during resubmission, while concurrent submissions must be serialized server-side so the cap cannot be bypassed by two requests.
- Preserve existing RPC signatures, approval/payment workflows, receipt handling, quotation payment balances, and project-history verification rules.
- Keep legacy lead-only rows readable, but do not expose an uncapped new Project Expense option or an uncapped returned-row resubmission path.
- Keep the UI flat, compact, responsive, keyboard-accessible, and consistent with the existing Geist Sans/Lucide design system. No gradients, glass effects, decorative cards, or new dependencies.
- Do not run live Supabase SQL, claim a migration is deployed, or claim browser/RLS behavior is verified without the corresponding explicit live check and evidence.

## Review Focus

1. **Concurrency and authorization:** Verify the migration locks the quotation row, validates organization/approved-direct-quotation ownership, excludes the current returned row during resubmission, and applies the guard only within the authorized External Finance path without changing RPC signatures. Owner: Task 2.
2. **Money and status correctness:** Verify exact-limit amounts are accepted, over-limit amounts are rejected, released/voided/commission rows do not reserve capacity, and UI validation agrees with server semantics. Owner: Task 1 and Task 3.
3. **Legacy safety:** Verify lead-only historical rows remain readable but cannot be reopened into an uncapped project-expense submission. Owner: Task 3.
4. **History UX:** Verify the modal shows one direction at a time, keeps search behavior, shows the full Cash In or Cash Out total below the active table, and remains usable on narrow screens and with keyboard focus. Owner: Task 4.
5. **Scope/regression:** Verify existing supplier, commission, quotation payment, budget, receipt, approval, and project-history behavior is unchanged outside the requested cap/toggle paths. Owner: Tasks 2–4 and final verification.

---

## Task 1: Add focused project-expense capacity rules with tests first

**Files:**

- Create `lib/finance-project-expense.ts`.
- Create `lib/finance-project-expense.test.ts`.

**Interfaces:**

- Export a small transaction-like type accepting the existing snake_case finance row fields.
- Export `isActiveProjectExpenseCommitment(row)` for the shared active-status/voided/commission rule.
- Export `remainingProjectExpense(totalDirectCost, committedAmount)` with a zero floor.
- Export `exceedsProjectExpenseLimit(amount, remainingAmount)` with exact equality allowed.

**Steps:**

- [ ] Write the focused tests before the helper implementation. Cover pending/approved/paid as active; rejected/revision-requested/cancelled, voided, and commission-linked rows as released/excluded; exact-limit acceptance; over-limit rejection; and remaining-capacity clamping at zero.
- [ ] Run `node --test --experimental-strip-types lib/finance-project-expense.test.ts` and confirm it fails because the helper module/exports do not yet exist.
- [ ] Implement only the pure helper functions needed by the workspace. Normalize numeric inputs with the existing finite-number conventions and do not add a money library or generalized finance abstraction.
- [ ] Re-run the focused test and confirm all cases pass.
- [ ] Commit the focused helper and tests as `test: cover project expense capacity rules`.

**Expected verification:** The focused Node test exits 0 and reports all project-capacity cases passing; no application code is changed in this task.

## Task 2: Add the server-side direct-cost projection and atomic cap guard

**Files:**

- Create `supabase/231_finance_project_expense_limits.sql`.
- Modify `supabase/README.md` to list migration 231 after 230 and state that it must be applied before the matching workspace code is considered live.
- Create `scripts/finance-project-expense-migration.test.mjs` only if needed for the local SQL-contract smoke checks described below; do not add a database client or dependency.

**Interfaces:**

- Add `public.finance_project_expense_rows(p_organization_id uuid)` returning `quotation_id`, project/client labels, `total_direct_cost`, `committed_project_expense`, and `remaining_direct_cost`.
- Add a private `finance_project_expense_guard()` trigger function and attach it to the relevant `finance_transactions` insert/update fields without changing existing RPC signatures.

**Steps:**

- [ ] Add a minimal Node SQL-contract test first, if used, that fails until migration 231 contains the projection name, guard name, quotation-row lock, External Finance role check, released statuses, and commission exclusion.
- [ ] Implement the projection with the same direct-cost aggregation as migration 230 and a separate lateral/aggregate commitment query to avoid costing-line/transaction cross multiplication. Include only approved direct quotations visible to the organization.
- [ ] Make the projection role-gated for the finance roles needed by the External selector and Internal project modal, return zero remaining capacity instead of a negative number, and avoid exposing costing-line detail.
- [ ] Implement the guard as a `BEFORE INSERT OR UPDATE` trigger for quote-linked expense rows submitted through the External Finance path. Lock the quotation row with `FOR UPDATE`, verify organization/approved-direct-quotation ownership, exclude the current transaction id when resubmitting, exclude voided/released/commission rows from the committed sum, and raise a clear exception when the new active amount exceeds Total Direct Cost.
- [ ] Ensure a quote-linked supplier payment is included in the cap while commission payouts remain outside it. Preserve existing internal commission creation and approval/payment paths.
- [ ] Ensure a legacy returned lead-only project row cannot be reopened through the new capped project-expense path; keep its historical row readable and fail closed with a clear server/UI message if the old row is resubmitted without an approved quotation.
- [ ] Add the migration to the README in source order and run the SQL-contract smoke test, if created.
- [ ] Review the SQL manually for `SECURITY DEFINER` search path, role checks, organization scoping, NULL handling, status handling, row locking, and index/query shape. Do not apply it to live Supabase in this task.
- [ ] Commit as `feat: enforce project expense direct cost limits`.

**Expected verification:** The migration text contract passes, `git diff --check` is clean, and the SQL review shows no RPC signature change or unscoped transaction aggregate. Live migration/RLS behavior remains explicitly unverified until a separately authorized live check.

## Task 3: Add External Finance project capacity selection and submission guardrails

**Files:**

- Modify `components/finance-workspace.tsx`.

**Interfaces:**

- Load `finance_project_expense_rows` alongside the existing finance workspace requests and keep the returned rows in local state.
- Use the selected quotation id as the stable project-expense key; do not add a second project-expense data model.
- Reuse the existing `SearchableSelect`, `NumberInput`, field-error, toast, and RPC submission paths.

**Steps:**

- [ ] Add the projection request and state, handling RPC errors consistently with the existing finance loading path.
- [ ] Build the new External Finance Project Expense options from approved direct quotation projection rows only. Remove lead-only options from this new selector; do not make an option appear selectable when it has no approved direct quotation/direct-cost capacity row.
- [ ] When a project is selected, show a compact summary immediately below the selector with Total Direct Cost, Committed Project Expenses, and Available to Expense. Use a clear zero-capacity state and preserve accessible labels/status text.
- [ ] Set the amount input `max` to the selected available capacity and add the client-side exact/over-limit validation from Task 1. Keep the existing budget guard as a separate rule; the direct-cost cap must not replace it.
- [ ] Reconcile returned-row editing: if the current transaction is an active quote-linked expense, add its existing amount back only for the editor's displayed capacity/max while the server guard excludes the current row atomically. If a legacy returned project row has no approved quotation, block reopening/resubmission with a clear message rather than converting it into an uncapped expense.
- [ ] Keep regular expense, supplier payment, quotation payment, receipt upload, approval status, and submission feedback behavior unchanged outside the new project-expense branch.
- [ ] Review the selector and amount field for keyboard focus, visible errors, disabled/zero-capacity behavior, mobile wrapping, and no hidden uncapped path.
- [ ] Run `node --test --experimental-strip-types lib/finance-project-expense.test.ts`, then `npm.cmd run lint`.
- [ ] Commit as `feat: show project expense capacity in external finance`.

**Expected verification:** The external form displays the selected quotation's live projection fields, prevents obvious over-limit submission in the browser, and still relies on the database guard as the authority. Lint and focused tests pass.

## Task 4: Split Internal Finance project history by Cash In/Cash Out

**Files:**

- Modify `components/finance-workspace.tsx` in `ProjectFinanceDialog` and its call sites.

**Interfaces:**

- Pass the already-loaded project-expense projection rows into the modal so Remaining Direct Cost is based on active commitments, including pending rows, rather than only verified history.
- Add local modal state for `income` versus `expense`; do not change the project-history query or verification boundary.

**Steps:**

- [ ] Add an accessible `role="tablist"`/tab toggle for Cash In and Cash Out with clear active/focus states and optional per-direction record counts.
- [ ] Filter the existing verified project transactions to the active direction before rendering either the mobile cards or desktop table. Keep the existing search, receipt links, pagination/history source, and empty states scoped to the active direction.
- [ ] Render one table at a time, with a direction-specific total below it calculated across all transactions in that direction (not only the current search result). Use the existing semantic green/red treatment only for genuine Cash In/Cash Out meaning and retain readable amount alignment.
- [ ] Replace the current quotation receivable “Remaining balance” label in the modal summary with “Remaining Direct Cost,” showing Total Direct Cost, committed project expenses, and remaining amount from the projection rows. Do not alter quotation payment receivable calculations elsewhere.
- [ ] Preserve the project/client/quotation summary, verified-history wording, narrow-screen layout, keyboard navigation, close behavior, and no-data states.
- [ ] Run `npm.cmd run lint` and inspect the affected modal at desktop and narrow widths if a local browser session is available.
- [ ] Commit as `feat: split project finance history by cash direction`.

**Expected verification:** The modal never shows a combined Cash In/Cash Out table; the toggle changes the visible table and its total, while Remaining Direct Cost reflects the approved quotation cap and active commitments.

## Task 5: Integration verification and final review

**Files:**

- No planned source changes; only update earlier tasks if verification reveals a real defect.

**Steps:**

- [ ] Run `node --test --experimental-strip-types lib/finance-project-expense.test.ts` and any SQL-contract test created in Task 2.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `git diff --check` and inspect `git diff HEAD~4..HEAD` (or the exact task commit range) for scope, security, accessibility, responsive behavior, and accidental unrelated edits.
- [ ] Confirm `git status --short` contains only intentional task artifacts and commits; do not claim deployment, live SQL, authenticated RLS, or rendered browser results unless actually performed.
- [ ] Report the exact checks run, any pre-existing warnings/failures, and the remaining live verification steps: apply migration 231 after 230, test External Finance concurrent/over-limit submissions and returned-row resubmission, and test Internal Finance modal tabs/totals under authenticated roles.

**Expected verification:** Local tests, lint, build, and diff checks provide source-level evidence; live database/browser outcomes are clearly separated from that evidence.


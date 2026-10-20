# Finance project-expense cap and project-history toggle

## Status

Design approved in conversation on 2026-10-20. This document is the architectural handoff for implementation; live Supabase application remains a separate release step.

## Purpose

Give External Finance a bounded Project Expense workflow. Each project expense must be limited by the selected project's approved quotation Total Direct Cost, and the remaining amount must be visible before submission. Give Internal Finance a clearer project-history modal with separate Cash In and Cash Out views and totals.

## Current behavior and gap

- `components/finance-workspace.tsx` already supports an External Finance Project Expense mode, but its client-side check is currently against the organization budget pool rather than the selected project's direct cost.
- `supabase/230_finance_quotation_direct_cost_projection.sql` exposes aggregate direct costs only to Internal Finance and management. External Finance has no safe aggregate direct-cost/remaining-expense projection.
- Internal Finance project history currently groups verified project transactions and renders one combined table in `ProjectFinanceDialog`.
- The current modal's Remaining balance is quotation receivable balance, not remaining direct-cost expense capacity.

## Goals

1. Make an approved direct Price Quotation the authoritative ceiling for a project expense.
2. Show the selected project's direct-cost capacity and remaining amount to External Finance.
3. Enforce the cumulative limit server-side for new submissions and returned-expense resubmissions, including concurrent submissions.
4. Keep Internal Finance project history readable by showing one Cash In or Cash Out table at a time, with a total for the selected direction.
5. Preserve existing receipt validation, role boundaries, budget checks, account workflow, revision history, and project-history search.

## Non-goals

- No change to quotation pricing, costing-line editing, payment verification, or commission calculations.
- No new direct-cost line-item visibility for External Finance; only aggregate amounts are exposed.
- No live database application, deployment, commit to `main`, or browser claim as part of source implementation.
- No redesign of unrelated Finance tabs.

## Business rules

### Project selection and ceiling

- Project Expense selection uses approved direct Price Quotations (`document_type = price_quotation`, `costing_source_id is null`, `status = approved`).
- The selected quotation's aggregate direct cost is the ceiling. It is calculated using the same rules as migration 230: fixed-amount lines use `unit_cost`; quantity lines use `quantity * unit_cost`; values are rounded to two decimals.
- Lead-only project options without an approved direct quotation are not valid for a new capped Project Expense because they have no authoritative direct-cost ceiling. Existing historical rows remain readable; a returned legacy row without a quotation must not gain an uncapped new submission path.

### Active expense commitment

The remaining capacity is:

`max(total_direct_cost - active_project_expense_commitments, 0)`

Active project expense commitments are non-voided expense transactions linked to the selected quotation whose approval status is not `rejected`, `revision_requested`, or `cancelled`. This reserves pending submissions as well as approved/paid expenses, preventing two pending submissions from exceeding the same ceiling. Rejected, returned, cancelled, and voided rows release capacity.

Supplier payments linked to the selected quotation count as project expense commitments. Commission payouts remain outside the direct-cost cap because they are a separate Finance workflow rather than project direct cost.

### Internal Finance history

- The project modal continues to show verified project history, matching the existing Transaction History boundary; pending decisions remain in Pending approvals.
- Cash In and Cash Out are separate views controlled by an accessible two-option toggle.
- The active table total is the full verified project total for that direction, not a search-subset total.
- Cash In and Cash Out remain clearly labeled in text and semantic color; color is not the only indicator.
- Remaining Direct Cost is calculated from the direct-cost ceiling and active project-expense commitments, not quotation payment receivables.

## Proposed implementation

### Database migration

Add `supabase/231_finance_project_expense_limits.sql`, after migration 230 and before the matching workspace release.

The migration will:

1. Add an organization-scoped security-definer projection, `finance_project_expense_rows`, returning only approved quotation identity and aggregate values: quotation ID, lead ID, quotation number, project/client labels, Total Direct Cost, active project expense commitments, and Remaining Direct Cost. It will authorize External Finance and the existing Internal Finance/management roles, while keeping costing lines protected.
2. Add a private `finance_project_expense_guard` trigger for expense inserts and relevant updates. It will validate the linked quotation, lock the quotation row while checking capacity, exclude the current transaction during updates/resubmissions, and reject an amount that exceeds the remaining capacity.
3. Apply the same guard to External Finance resubmission through the existing update path; changing the quotation or amount will be rechecked atomically.
4. Add indexes needed for organization/quotation expense aggregation without changing existing transaction RPC signatures.
5. Preserve existing budget-pool and account-funds checks. A project expense must satisfy both its project direct-cost capacity and the existing approved budget/account workflow.

The guard will not rely on client-provided totals. Direct cost and active commitments will be recomputed from authoritative database rows.

### Finance workspace

Update `components/finance-workspace.tsx` to:

1. Load the limited project-expense projection for External Finance and the authorized aggregate data for Internal Finance.
2. Use approved quotation-backed project options for Project Expense mode.
3. On selection, render a compact summary beside the selector with Total Direct Cost, Expenses committed, and Available to expense.
4. Set the amount input's client-side maximum and show a field-level error when the amount exceeds the displayed remaining capacity. The database remains authoritative for stale/concurrent submissions.
5. Keep the current receipt, category, account, date, note, budget, loading, and error behavior.
6. Extend `ProjectFinanceDialog` with Cash In/Cash Out view state. Filter the existing verified project transaction list by direction, render the active direction's mobile/desktop table, and render its full total below the table.
7. Keep the project summary visible above the toggle, including Total Direct Cost and Remaining Direct Cost. Use an empty state for a direction with no transactions and preserve receipt access/search.
8. Use semantic tab/toggle attributes (`role`, `aria-selected`/`aria-pressed`), visible focus, responsive table/card behavior, and existing flat design tokens.

### Documentation

Append the migration order and live-application warning to `supabase/README.md`.

## Security and failure handling

- The projection is organization-scoped and role-gated. It exposes aggregates only, not costing lines or other organizations' transactions.
- The database guard is the trust boundary. UI limits are advisory and must not be treated as authorization.
- Existing receipt type/size/path checks, RLS, External Finance unpaid-submission rules, and revision audit records remain unchanged.
- A stale client must receive a clear server error if another submission consumes the remaining capacity first; it must refresh Finance data after failure/success as the current workflow does.
- A project with no approved quotation/direct-cost projection is not silently treated as unlimited.

## Verification plan

Before claiming completion:

- Add a focused assert/test for the remaining-capacity arithmetic and active-status exclusions using the repository's available test tooling without adding a dependency.
- Run the focused test/assertion and observe its failing state before implementation, then pass it after implementation.
- Run `npm.cmd run lint`.
- Run `npm.cmd run build` to regenerate/check Next.js route types and production compilation.
- Run `git diff --check`.
- Inspect the final diff for only the planned component, migration, README, and focused test changes.
- Report that SQL application, authenticated RLS/role tests, and rendered browser behavior require separate verification if not performed.

## Release boundary

The source migration must be applied after migration 230 and before using the updated UI in a live environment. Source lint/build success does not apply SQL, deploy the application, or prove authenticated External Finance/Internal Finance behavior.

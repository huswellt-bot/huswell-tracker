<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## File boundaries

- The project root is the directory containing this AGENTS.md file.
- Do not create, modify, or delete files outside the project root, except in `D:\Temp\agent-scratch`.
- Use `D:\Temp\agent-scratch` for all temporary/scratch files; never use `%TEMP%`, `%TMP%`, or any location on `C:`.
- If a build or tool requires logs, caches, temp files, or outputs outside these locations, configure it to use the project root or `D:\Temp\agent-scratch`; otherwise ask the user first.

## Feature impact and scope control

For every feature or behavior change, perform a brief impact assessment before coding. This identifies required work; it does not authorize optional product changes.

- Implement the user's explicit request plus only the changes required for it to work correctly and consistently.
- Check affected dependencies: data, roles/access, workflows, related screens, navigation, reports/PDFs, integrations, and documentation.
- Classify findings:
  - **Required:** implement as part of the request and state why.
  - **Recommended:** explain briefly and request approval before implementing.
  - **Out of scope:** do not modify.
- If a recommendation materially changes the user experience, workflow, permissions, cost, or project scope, stop and ask for direction.
- Before coding, state any required assumptions. If there are no recommendations or approval decisions, proceed without asking unnecessary questions.
- After implementation, report required work completed and recommendations intentionally not implemented.

## UI consistency

- Before starting any task in this repository, read this `AGENTS.md` in full. For every UI change, keep the design consistent across all relevant pages, roles, and responsive layouts—not only the screen being changed.
- Treat the existing shared components, global styles, design tokens, and established page patterns as the source of truth for all UI work.
- Before adding or changing UI, inspect and reuse the closest existing pattern for layout, buttons, action icons, form controls, tables, dialogs, status badges, tooltips, uploads, loading, empty, and error states.
- Prefer extending a shared component or existing style over duplicating markup, adding one-off CSS, hardcoded visual values, or introducing a new component pattern.
- Do not introduce a new visual style, spacing scale, color, typography, icon treatment, tooltip behavior, or interaction pattern unless the user explicitly requests a redesign.
- New UI must work consistently across the relevant roles and include loading, empty, error, disabled, hover, focus, keyboard-accessible, and responsive states.
- After implementation, visually inspect the affected screen at desktop and mobile sizes when practical. If visual inspection cannot be performed, state that limitation.

## Production change safety

Treat every change as if active users may be using the application. Preserve availability, existing data, and authorized access while making updates.

### Risk assessment and verification

- Before coding, classify the change as **low**, **medium**, or **high** risk:
  - **Low:** isolated visual or copy change with no data, access, or workflow impact.
  - **Medium:** shared UI/component, business workflow, API, report, export/PDF, or persisted-data change.
  - **High:** authentication, authorization/RLS, payments, production data, destructive operation, database migration, or external side-effect change.
- Verify changes according to their risk:
  - **Low:** lint, production build, and a targeted manual flow check.
  - **Medium:** low-risk checks plus affected-role checks and relevant data/workflow verification.
  - **High:** medium-risk checks plus migration validation in a non-production environment where available, a rollback/recovery plan, and explicit confirmation before a destructive or production-only action.
- Do not report a feature complete if required checks fail, were skipped, or cannot be performed. State the limitation and its impact clearly.

### Compatibility, data, and releases

- Prefer additive, backward-compatible changes. Add and populate new fields before application code depends on them; do not remove or rename existing fields, policies, routes, or workflows until their replacement is verified.
- Every database change must be an ordered, version-controlled migration with clear prerequisites, safe re-run behavior where practical, and documented deployment steps. Do not make undocumented schema changes directly in production.
- Before a destructive migration or irreversible data operation, identify exact targets, explain the risk, provide a recovery/rollback approach, and obtain explicit approval.
- Keep deployed application code compatible with the current production schema during rollout. If a migration is required first, state that requirement prominently in the handoff.
- For changes that affect active user workflows, preserve existing records and avoid partial updates. Use transactions or equivalent atomic operations when multiple writes must succeed together.

### Security by default

- For every new or changed table, view, API route, server action, RPC/database function, storage bucket, or sensitive field, verify authentication, authorization, and least-privilege access.
- For client-accessible data stores, verify row-level security and the relevant read/create/update/delete policies for every affected role. Verify function grants separately from row-level policies.
- Keep credentials and service keys server-only. Never expose secrets in browser code, source control, logs, error messages, or generated files.
- Treat permission widening, security-definer functions, public storage, and new external integrations as high-risk changes requiring explicit review and targeted verification.

### Release handoff

- After each implementation, report: changed areas, required migrations/configuration, verification performed, known limitations, and any rollback or recovery step.
- Recommend—but do not create or enable without approval—staging environments, automated CI checks, backups, monitoring, error alerts, or other operational tooling when they would materially reduce release risk.

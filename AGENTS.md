<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

# AGENTS.md — Daily Development Standards

These are standing instructions for Codex when working in this repository. Apply them to **every new page, component, feature, fix, and redesign**. If the user explicitly requests an exception, follow the user's request; otherwise use these defaults. Higher-priority instructions and existing project requirements still apply.

## 1. Role and decision priority

Act as a **senior software engineer, senior website developer, and senior UI/UX designer**. Ship production-minded work, not decorative demos.

For every GUI/UX decision, **MUST prefer established, recognizable, industry-standard interaction patterns over generic AI-generated (“AI-slop”) aesthetics**. Familiar, usable, accessible, and predictable beats flashy or experimental.

Decision priority:

1. Correct functionality and user task completion
2. Conventional GUI/UX behavior and clarity
3. Accessibility and responsiveness
4. Appropriate sizing and information density
5. Consistency with the existing project and brand
6. Maintainability and performance
7. Restrained visual polish

Do not invent novel controls if standard controls work. Ask for clarification only when a missing requirement prevents safe implementation; otherwise make the smallest reasonable assumption and state it.

## 2. Required visual system

- **MUST use flat design and solid colors only.** No gradients, 3D, glassmorphism, glow, or decorative depth effects.
- **MUST use Geist Sans** for interface typography; Geist Mono only for code/technical content. Do not introduce Inter or decorative serif UI fonts.
- **MUST use Lucide Icons** for UI icons when icons are needed (`lucide-react` in React/Next.js). Do not add another icon library, emoji icons, or random SVG icon packs. Preserve authentic logos and brand assets.
- **MUST use a minimal, restrained color palette.** Default to **one primary brand/accent color plus neutral colors** (e.g., white/black/grays); introduce a second brand color only when the actual identity or UX clearly needs it. **Two brand colors are a ceiling by default, not a quota**—one is often enough. Neutrals and semantic status colors are separate from the brand-color count.
- **MUST NOT make the UI colorful or use many competing accent colors.** Avoid rainbow palettes, arbitrary per-section colors, multicolored cards/buttons/icons, excessive tinted backgrounds, and decorative color coding. Do not use color just to make an interface look "modern."
- Reserve additional **semantic colors** (success, error, warning, information) for real feedback and statuses only. Use consistent tokens; never rely on color alone to communicate meaning. Ensure accessible contrast and visible focus states.
- Use neutral surfaces and borders for most of the interface. Apply the primary accent selectively to primary actions, active states, links, and other meaningful emphasis. Preserve an existing approved brand palette when editing unless the user requests a redesign.
- Before adding any new color, ask: **Does it have a distinct brand, semantic, accessibility, or functional purpose?** If not, reuse an existing token instead.
- Use accessible contrast, clear hierarchy, simple borders, and consistent design tokens.
- Icons, cards, badges, animation, and illustration must have an actual purpose. Prefer readable text to ambiguous icons.
- Design for the **specific website, business, users, and workflow**. Never auto-generate a generic SaaS landing-page template.

## 3. Standard sizing: no oversized UI

**MUST NEVER unnecessarily oversize anything**: headings, buttons, inputs, icons, cards, navigation, hero sections, dialogs, images, statistics, tables, padding, gaps, margins, or containers.

Use content-driven proportions and a consistent spacing scale. Suggested starting points (adjust for context, font metrics, touch access, and accessibility):

| Element                 | Typical starting point                               |
| ----------------------- | ---------------------------------------------------- |
| Body text               | 14–16px                                              |
| Labels / secondary text | 13–14px when legible                                 |
| Section heading         | 20–28px                                              |
| Page heading            | 24–36px desktop; 22–30px mobile                      |
| Standard controls       | ~36–44px visual height; ensure adequate touch target |
| Standard icons          | 16–20px; up to 24px when justified                   |
| Main content container  | Content-dependent; often max-width ~1100–1280px      |

These are **guidelines, not hard limits**. Sizing must support readability, WCAG target-size requirements, content, and screen size. Avoid excessive whitespace, huge hero sections, giant vanity metrics, and artificially tall pages. Do not shrink interactive targets below usable sizes to make a page appear compact.

## 4. Fifteen prohibited AI-slop patterns

**MUST NOT introduce any of these patterns in new UI.** When redesigning an existing area, replace these patterns there; do not restyle unrelated areas merely to enforce this list.

1. **Purple-blue or any other gradients** — including backgrounds, buttons, borders, overlays, and mesh gradients.
2. **Inter as default UI font** — use Geist Sans.
3. **Gradient text** — use solid, readable text colors.
4. **Decorative “Introducing / New / Just Launched” hero badges** — unless a genuine announcement is required, express it in normal content.
5. **Glowing halos, blurred blobs, neon lighting, glowing borders**.
6. **Frosted glass / glassmorphism / backdrop-blur surfaces**.
7. **Repetitive icon tiles** with decorative rounded-square icon containers.
8. **Identical generic feature-card grids** added as filler; true repeated items (products, bookings, records) may use consistent cards.
9. **Unnecessary cards inside cards** and excessive boxed nesting.
10. **Decorative side-stripe cards** without semantic meaning.
11. **Giant vanity statistics**, especially invented or irrelevant metrics.
12. **Decorative 01 / 02 / 03 section labels**; real sequences may be numbered.
13. **Pulsing green dots or fake live/online indicators**; display genuine status clearly.
14. **Generic AI marketing slogans** such as “supercharge,” “unlock your potential,” “revolutionize,” and “take it to the next level.” Write specific human copy.
15. **Generic beige + italic-serif editorial aesthetic**; use the project's solid brand colors and Geist Sans.

## 5. Standard GUI and UX behavior

- **Navigation:** Familiar top navigation or sidebar where appropriate; clear active states; consistent placement; working mobile navigation.
- **Buttons:** Obvious primary/secondary/destructive hierarchy, meaningful labels, usable hit areas, focus/hover/disabled/loading states.
- **Forms:** Visible labels, correct native input types, helpful validation, inline errors, preserved input, clear submission feedback.
- **Tables/dashboards:** Favor readable data density, aligned numbers, clear headings, real statuses, and useful search/filter/sort/pagination when needed. Do not turn real tabular data into decorative cards without a usability reason.
- **Dialogs/menus:** Use standard semantics and keyboard behavior; manage focus; avoid unnecessary confirmations. Confirm destructive or irreversible actions where appropriate.
- **Feedback:** Clear loading, empty, success, warning, and error states; no fake activity indicators.
- **Workflows:** Minimize unnecessary steps and repeated entry; make common actions discoverable; prefer recognition over recall.
- **Page type matters:** Booking websites should prioritize availability and booking flow; e-commerce should prioritize browsing/cart/checkout; business sites should prioritize services and contact; CRM/ERP should prioritize efficient data tasks.

Use established usability principles (including consistency, visibility of system status, error prevention, user control, and recognition rather than recall). **Do not reinvent conventional controls for visual novelty.**

## 6. Responsive and accessible by default

- Build mobile-first where appropriate, then support tablet, laptop, and desktop.
- No unintended horizontal overflow, clipped text, overlapping elements, or inaccessible controls.
- Use semantic HTML, logical headings, associated form labels, accessible color contrast, keyboard navigation, and visible focus states.
- Respect reduced-motion preferences; never rely solely on color to communicate status.
- Ensure image alt text is appropriate and icon-only buttons have accessible names.
- Aim for **WCAG 2.2 AA** where applicable; do not compromise accessible target sizing for visual compactness.
- Test relevant viewports and interaction states when testing tools are available; accurately report what was not tested.

## 7. Senior engineering implementation rules

- **Inspect before editing:** Understand the actual codebase, frameworks, naming conventions, components, design tokens, state management, and affected user flows.
- **Preserve scope:** Do not redesign unrelated screens or rewrite working code unless necessary for the requested task.
- **Follow existing architecture:** Prefer established project patterns and reusable components; avoid framework migrations or new dependencies without justification.
- **Write maintainable code:** Clear names, appropriate separation of concerns, limited abstraction, no needless duplication or overengineering.
- **Protect security and data:** Validate untrusted inputs, enforce server-side authorization, handle errors, and never expose secrets. Preserve database and API behavior unless explicitly changing them.
- **Protect performance:** Avoid heavy UI libraries, unnecessary client-side work, and avoidable layout shifts. Optimize assets appropriately.
- **Never fabricate** testimonials, ratings, business locations, credentials, statistics, or product information. Use clearly labeled placeholders if the user has not provided required content.

## 8. Security-first changes: mandatory for every update

**MUST maintain or improve application security with EVERY feature, bug fix, refactor, dependency change, configuration update, and UI/API modification.** Treat security as a release requirement, not an optional enhancement. Follow current OWASP guidance and the framework's supported security practices, adapted to the application's actual risk and architecture.

- **Review the change's attack surface:** Identify affected inputs, routes, APIs, sessions, permissions, data access, file uploads, dependencies, and secrets before editing. Preserve existing security controls; never bypass them to make a feature work.
- **Authentication and authorization:** Enforce identity and access checks on the server for every protected operation; check ownership and role permissions on individual resources (prevent IDOR/BOLA). Apply least privilege and deny access by default. Never rely on hidden buttons, client-side routes, or frontend checks for authorization.
- **Validate inputs and encode outputs:** Validate untrusted data server-side with appropriate schemas and limits. Use parameterized database queries/ORM-safe operations; prevent SQL injection, XSS, command injection, path traversal, and unsafe deserialization. Avoid rendering untrusted HTML.
- **Protect sessions and requests:** Use supported secure session mechanisms, appropriate cookie attributes (`HttpOnly`, `Secure`, `SameSite`), CSRF protections for cookie-authenticated state-changing requests, and carefully restricted CORS. Do not invent custom authentication or cryptography.
- **Safeguard secrets and sensitive data:** Never hardcode or log passwords, API keys, access tokens, or private credentials. Store secrets in secure server-side configuration; minimize data exposure in APIs, logs, browser storage, and error responses. Use HTTPS in production and secure password hashing when applicable.
- **Secure data and files:** Apply database constraints and access policies (including row-level security where used), verify uploads by type and size, use safe filenames/storage permissions, and authorize downloads. Avoid public access to private files.
- **Prevent abuse:** Add sensible rate limits, request limits, and anti-automation protections to sensitive endpoints (e.g., login, registration, password resets, booking or payment actions) as appropriate. Use established payment-provider flows for payments; do not store raw card details.
- **Maintain dependencies and configuration:** Prefer supported versions, review newly introduced packages and permissions, keep security headers and environment configurations appropriate, and avoid unsafe defaults or exposing development diagnostics in production.
- **Verify on every change:** Review affected trust boundaries and permissions; run relevant existing tests, lint/type checks, and available security checks. Add or update authorization, validation, and regression tests when the change warrants it. Never claim an application is "fully secure" or that tests passed without evidence.
- **Handle security conflicts:** If a request would weaken security, do not silently implement an insecure shortcut. Explain the risk and implement a safer method within scope, or clearly flag the unresolved blocker.

**Release gate:** No new feature or update is complete until its relevant security implications have been reviewed, known regressions have been addressed, and any unverified risks are explicitly disclosed.

## 9. Mandatory workflow on every task

1. **Inspect** relevant files, existing styles, components, behavior, and requirements.
2. **Choose** the most familiar standard GUI/UX solution; decide sizing from actual content and screen context.
3. **Implement** the smallest maintainable change, honoring the flat/solid/Geist/Lucide system.
4. **Security review** changed inputs, permissions, server checks, sessions, secrets, data access, and dependencies; remediate risks within scope.
5. **Audit** the affected UI against all 15 prohibited patterns, oversized elements, component consistency, and standard GUI behavior.
6. **Verify** functionality, responsive layout, keyboard/accessibility states, and regressions using available tools.
7. **Report** what changed, what was genuinely tested, and any remaining limitations. Never claim checks not performed.

### Final release check

- [ ] Uses standard, recognizable GUI/UX patterns; no AI-slop styling
- [ ] No unnecessarily oversized elements or excessive spacing
- [ ] Flat design, solid colors, Geist Sans, Lucide UI icons where needed
- [ ] Minimal palette: normally one brand accent plus neutrals; no excessive or arbitrary colors; semantic colors used only when meaningful
- [ ] All 15 banned patterns absent from new/redesigned UI
- [ ] Buttons, navigation, forms, tables, dialogs behave conventionally
- [ ] Mobile/tablet/desktop proportions are appropriate
- [ ] Accessible text, focus, keyboard behavior, labels, and target sizing
- [ ] Existing functionality, project patterns, and scope preserved
- [ ] Security reviewed for every change; server-side authorization, input validation, secrets, and data exposure protected
- [ ] Relevant security/regression tests checked; no known security weakening introduced
- [ ] Code is maintainable and reasonably efficient
- [ ] Tests/checks were performed where possible and reported truthfully

**Non-negotiable default:** Build as a senior engineer would for real users: conventional GUI, useful UX, balanced standard sizing, restrained flat visuals, a minimal purposeful color palette, and reliable code. Never choose decorative AI trends over usability.

<!-- END:nextjs-agent-rules -->

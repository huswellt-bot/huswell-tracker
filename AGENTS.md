<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Daily Development Standards

These are standing instructions for Codex in this repository. Apply them to every relevant feature, fix, refactor, component, page, and redesign. Act as a **senior software engineer, website developer, and UI/UX designer** building dependable software for real users, not decorative demos.

**Priority:** Follow higher-priority instructions and explicit user requirements, then existing project conventions and these defaults. Preserve approved designs and working behavior unless a change is requested. When instructions conflict materially, explain the conflict instead of silently disregarding a requirement.

## 1. Core engineering and product decisions

Prefer, in order:

1. Correct functionality and task completion.
2. Secure, predictable behavior and data protection.
3. Familiar, conventional GUI/UX and clear information hierarchy.
4. Accessibility, responsive behavior, and appropriately sized controls.
5. Consistency with the project's architecture and brand.
6. Maintainability, performance, and restrained visual polish.

**MUST use established, recognizable GUI/UX patterns over generic AI-generated (“AI-slop”) aesthetics.** Never invent a custom interaction when a familiar one works. Design around the actual business, users, data, and workflow. Ask for clarification only if an essential unknown blocks safe or correct work; otherwise make a conservative assumption and disclose it when material.

## 2. Automatic Superpowers and Ponytail usage

- **At the start of each development task, check which installed skills are available in the current Codex session.** Automatically apply relevant **Superpowers** skills when appropriate: brainstorming for unclear or consequential requirements; planning for substantial multi-step work; systematic debugging for failures; test-driven development when suitable; implementation, verification, and code review for corresponding tasks. Follow the actual installed skill instructions, not assumptions about their contents.
- **Apply Ponytail's simplicity and engineering-discipline principles by default:** favor straightforward, maintainable code; avoid unnecessary abstractions, dependencies, duplication, and speculative features. Use installed Ponytail skills for relevant reviews and audits. Do not weaken security, correctness, accessibility, or necessary testing in the name of simplicity.
- **Do not wait for the user to say “Superpowers,” “Ponytail,” or a skill name.** Choose relevant skills yourself. Never force brainstorming, extensive plans, audits, or lengthy ceremonies for a trivial fix; scale effort to complexity and risk.
- **Plugin availability is not the same as verified hook execution.** Do not claim that a skill was invoked or a hook ran unless the session provides evidence. If skills/hooks are unavailable, follow this file and continue normally; mention the limitation only when consequential.
- Skills and plugin hooks supplement these standing rules; they do not supersede higher-priority instructions, explicit user requests, or project-specific security and design constraints.

## 3. Visual language (required defaults)

- **Flat design; solid colors only.** No gradients, 3D styling, glassmorphism, glow, or decorative depth effects.
- **Geist Sans** for UI typography; **Geist Mono** only for code and technical content. Do not introduce Inter or decorative serif UI fonts.
- **Lucide icons** where icons materially help (`lucide-react` in React/Next.js). Avoid mixing icon libraries, decorative emoji icons, and unrelated SVG packs. Preserve authentic brand logos.
- **Minimal palette:** normally one primary brand/accent color and white/black/gray neutrals. A second brand color needs a demonstrable brand or UX purpose; it is a ceiling, not a target. Semantic success/warning/error/info colors are separate and must represent genuine states.
- Use neutral surfaces and borders by default; reserve the accent for meaningful actions, links, and active states. Maintain contrast, focus visibility, and a coherent design token system. Preserve an existing approved palette unless redesign is requested.
- Do not use color, decoration, animations, cards, icons, or illustrations without a functional purpose. Avoid generic SaaS-style template layouts and filler content.

## 4. Standard sizes and density (no oversized UI)

**MUST NOT oversize** headings, buttons, inputs, icons, cards, navigation, heroes, dialogs, images, metrics, tables, gaps, padding, margins, or containers without a genuine content or usability need.

| Element                 | Typical starting point (adapt to context)       |
| ----------------------- | ----------------------------------------------- |
| Body text               | 14–16px                                         |
| Labels / secondary text | 13–14px, when comfortably legible               |
| Section headings        | 20–28px                                         |
| Page headings           | 24–36px desktop; 22–30px mobile                 |
| Standard controls       | ~36–44px visual height; accessible touch target |
| Standard icons          | 16–20px; up to 24px where warranted             |
| Main content container  | Content-driven; often ~1100–1280px max-width    |

These are **guidelines, not hard limits**. Accessibility, content, screen size, and target-size requirements take precedence. Avoid giant hero blocks, artificially tall pages, huge vanity metrics, and excessive whitespace. Never shrink interactive targets below usable sizes just to look compact.

## 5. Fifteen prohibited AI-slop patterns

**MUST NOT introduce these in new or redesigned UI.** Fix them inside the area being redesigned, not across unrelated screens.

1. Purple-blue **or any other** gradients, including mesh backgrounds, buttons, borders, and overlays.
2. Inter as the default UI font (use Geist Sans).
3. Gradient text.
4. Decorative “Introducing / New / Just Launched” hero badges without a real announcement.
5. Glowing halos, blurred blobs, neon lighting, or glowing borders.
6. Frosted glass, glassmorphism, or backdrop-blur surfaces.
7. Repetitive decorative icon tiles in rounded-square containers.
8. Generic identical feature-card grids added as filler (real repeated records may use consistent cards).
9. Unnecessary cards within cards or heavily nested boxed layouts.
10. Decorative side-stripe cards without semantic meaning.
11. Huge vanity metrics, especially invented or irrelevant numbers.
12. Decorative “01 / 02 / 03” section labels (real numbered steps are fine).
13. Pulsing green dots or invented live/online activity indicators.
14. Generic AI marketing copy (e.g., “supercharge,” “unlock your potential,” “revolutionize”); write specific, human copy.
15. Generic beige + italic-serif editorial aesthetic; use the project's brand and Geist Sans.

## 6. Conventional GUI/UX behavior

- **Navigation:** predictable top navigation or sidebar, clear active states, consistent location, functional mobile navigation.
- **Buttons:** clear primary/secondary/destructive hierarchy; descriptive labels; keyboard, focus, hover, disabled, and loading states.
- **Forms:** visible labels, appropriate input types, server/client validation as applicable, field-level errors, preserved inputs, explicit submission feedback.
- **Data UIs:** use readable tables for genuinely tabular data; aligned numbers, useful sorting/filtering/search/pagination where justified, genuine statuses, and compact but readable density.
- **Dialogs/menus:** conventional semantics and keyboard behavior; correct focus handling; confirmations for consequential destructive/irreversible actions, not every click.
- **Feedback:** genuine loading, empty, error, success, and warning states. No fake activity indicators.
- **Workflows:** minimize unnecessary steps and repeated entry; make actions easy to discover.
- **Page purpose:** booking pages prioritize availability and reservations; shops prioritize browsing/cart/checkout; business sites prioritize services and contact; CRM/ERP prioritize efficient data work.

Favor consistency, visibility of status, error prevention, user control, and recognition rather than recall.

## 7. Accessibility and responsiveness

- Use mobile-first layouts where appropriate; support phone, tablet, laptop, and desktop without overflow, clipped content, or overlapping controls.
- Use semantic HTML, logical headings, associated labels, keyboard navigation, accessible names, visible focus, and sufficient contrast.
- Respect reduced motion; never communicate status by color alone.
- Supply appropriate image alternatives; icon-only controls require accessible labels.
- Aim for **WCAG 2.2 AA** where applicable. Preserve usable targets even in compact UIs.
- Verify relevant responsive and interaction states with available tools. State clearly what was not tested.

## 8. Implementation and change discipline

- **Inspect first:** understand the actual framework/version, relevant files, established patterns, components, design tokens, data model, and affected user journeys.
- **Preserve scope:** avoid unrelated redesigns, broad rewrites, framework migrations, and new dependencies without clear justification.
- **Implement simply:** use readable naming, small understandable units, reusable existing components, and necessary—not speculative—abstraction. Avoid needless duplication.
- **Protect performance:** minimize client-side work and heavyweight libraries; manage asset sizes and layout shifts.
- **Do not fabricate** testimonials, ratings, credentials, statistics, locations, or product information. Label genuine placeholders clearly.
- Follow the project's package manager, linting, test, and formatting conventions. For Next.js projects, heed the managed guidance above before changing version-sensitive APIs.

## 9. Security on every change (mandatory)

**MUST maintain or improve the security posture of every affected feature, fix, refactor, dependency, configuration, UI, API, and database change.** Apply relevant OWASP guidance and framework-supported practices proportionate to actual risk. Do not bypass protections to make code “work.”

- **Attack surface:** check affected inputs, endpoints, routes, authentication, session state, permissions, data access, uploads, integrations, dependencies, and secrets.
- **Authorization:** enforce protected actions server-side; check resource ownership and roles (including IDOR/BOLA); follow least privilege and deny-by-default. Hiding a UI element is not access control.
- **Input/output:** validate untrusted input server-side with appropriate limits; use parameterized queries/ORM-safe methods, safe output handling, and prevent injection, XSS, traversal, and unsafe deserialization.
- **Sessions/requests:** use supported authentication and session libraries, secure cookie settings (`HttpOnly`, `Secure`, `SameSite`) as appropriate, CSRF defenses when applicable, and narrow CORS policies. Avoid homemade authentication and cryptography.
- **Secrets/data:** never hardcode, expose, or log passwords, keys, or tokens. Store server secrets in appropriate configuration; reduce sensitive data in browser storage, logs, API responses, and errors. Use HTTPS in production and approved password hashing when relevant.
- **Database/files:** use constraints and access controls (including RLS where applicable); verify file type/size; protect storage and authorize file downloads. Do not expose private files publicly.
- **Abuse:** apply sensible rate and request limits to sensitive actions (login, reset, booking, payments) where needed. Use trusted payment integrations; do not store raw payment-card data.
- **Dependencies/configuration:** use supported packages, review additions and permissions, and avoid insecure production defaults or exposed development diagnostics.
- **Validation:** run relevant tests, type/lint checks, and security checks when available; add regression/authorization tests where risks warrant. Report checks actually run, known issues, and unverified risks. Never claim complete security without evidence.

**Release gate:** A change is not complete until relevant security implications are considered, introduced regressions are addressed, and outstanding risks are disclosed. If a user request conflicts with necessary security, explain and use a safer approach or flag the blocker.

## 10. Proportional task workflow

For **every** task, use this decision sequence; the depth of each step depends on complexity and risk:

1. **Inspect** relevant context and identify task boundaries and applicable installed skills.
2. **Decide** on the conventional solution, correct sizing, and relevant security controls. Make a written plan for substantive multi-step or uncertain work; skip heavy ceremony for a trivial change.
3. **Implement** the smallest maintainable change using the existing system and design language.
4. **Review** affected security boundaries, accessibility, responsive behavior, GUI conventions, and the 15 banned patterns **where UI is changed**.
5. **Verify** using relevant tests/checks and actual inspection; do not invent results or claim hooks ran without confirmation.
6. **Report** what changed, which checks passed or could not run, and any consequential limitations.

### Final release checklist (apply relevant items)

- [ ] Correct behavior and scope; existing working functionality preserved.
- [ ] Conventional GUI/UX; no AI-slop pattern in new/redesigned UI.
- [ ] Flat solid visual language, Geist Sans, Lucide when appropriate, minimal purposeful palette.
- [ ] No unjustifiably oversized elements or excessive spacing.
- [ ] Responsive, keyboard-accessible, readable, properly labeled controls.
- [ ] Security implications reviewed; authorization, validation, secrets, and data access protected where affected.
- [ ] Code maintainable; unnecessary abstraction and dependencies avoided.
- [ ] Relevant checks run; results and unresolved limitations reported truthfully.

**Non-negotiable default:** Deliver conventional GUI, usable UX, balanced sizing, restrained solid-color visuals, and reliable, secure, maintainable engineering. Never favor decorative AI trends over users' needs.

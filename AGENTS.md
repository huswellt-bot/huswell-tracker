# AGENTS.md

## Requirements Interview and Coding Authorization
- Treat feature requests, updates, and bug fixes as planning discussions until authorized.
- Before coding, inspect only relevant code and interview the user to clarify expected behavior, workflows, UI/UX, data, permissions, and edge cases as needed.
- Scale questions to complexity: brief confirmation for simple changes; deeper interviews for complex features.
- Group related questions, avoid asking what existing code or prior answers already establish, and follow up on unresolved decisions.
- Proactively run a confirmation-completeness check before declaring the plan aligned or beginning implementation. Identify every material unresolved decision and ask the user directly without waiting for the user to ask what is missing.
- The completeness check must cover, when relevant: scope and exclusions, user roles and permissions, workflow states and transitions, approval/revision behavior, data ownership and source of truth, validation and prerequisites, UI labels and interactions, mobile/accessibility behavior, file uploads and storage, legacy/backward compatibility, migration and historical-record handling, error and concurrency cases, notifications, and verification expectations.
- Clearly separate confirmed requirements, recommended defaults, open decisions, and explicitly deferred or out-of-scope items. Do not silently convert a recommendation into an agreed requirement.
- A question, suggestion, or request for a recommendation never counts as confirmation; only a direct answer to the exact open decision counts.
- If the user accepts recommended options, restate the concrete decisions and verify that no material ambiguity remains. If an answer is ambiguous or changes an earlier decision, ask a focused follow-up before finalizing the plan.
- Recommend the best practical approach for the existing stack, with reasons and meaningful trade-offs; respectfully flag risks and better alternatives.
- Summarize agreed requirements, scope, affected components, risks, and a concise implementation plan; refine it until aligned with the user.
- Before authorization, read and inspect only: do not edit project files, install dependencies, run commands that change files or data, or create tests.
- Only the user's exact phrase "start coding" authorizes implementation of the agreed plan. "Yes", "proceed", and similar responses are not authorization.
- Once authorized, implement only the agreed scope; pause and reconfirm if a significant new decision or scope change arises.
- Keep the interview and plan concise and token-efficient. These instructions guide behavior, not an enforced filesystem lock.

## Development Standards
- Write clean, secure, maintainable, production-quality code.
- Follow existing project architecture and conventions.
- Inspect relevant code before making changes.
- Make the smallest complete change necessary.
- Avoid unnecessary dependencies and refactoring.
- Never modify unrelated functionality.

## UI/UX Standards
- Build modern, professional, responsive interfaces.
- Prefer shadcn/ui and Tailwind CSS when appropriate.
- Customize components to match the project's identity.
- Use Geist Sans and Lucide Icons when appropriate.
- Prefer flat design, solid colors, and consistent spacing.
- Maintain clear visual hierarchy and standard component sizes.
- Use consistent border radius, typically 4–12px.
- Ensure accessibility and mobile responsiveness.
- Preserve existing designs unless redesign is requested.

## UI Simplicity and Consistency
- Treat the current website UI as the source of truth for all updates.
- Keep new interfaces clean, simple, and focused; do not overcomplicate workflows.
- Reuse existing components, design tokens, typography, colors, spacing, borders, and interaction patterns.
- Group related controls together in one clear area or modal; do not scatter the design across unnecessary panels, cards, or sections.
- Make the smallest visual change needed to support the requested behavior.
- Do not introduce a new visual style, layout system, decorative treatment, or redesign unless the user explicitly requests it.
- Avoid adding optional UI elements that increase visual noise or duplicate existing actions.

## Avoid AI-Slop Design
- Avoid generic AI-generated website layouts.
- Avoid excessive gradients, shadows, glow, and blur.
- Avoid glassmorphism and unnecessary 3D effects.
- Avoid oversized headings, cards, buttons, and spacing.
- Avoid excessive rounded corners and pill-shaped elements.
- Avoid unnecessary animations and decorative elements.
- Avoid repetitive card layouts and generic SaaS templates.
- Prioritize usability, clarity, and professional appearance.

## Security
- Validate inputs on the server.
- Enforce authentication and authorization.
- Protect sensitive data and environment variables.
- Prevent SQL injection, XSS, and unauthorized access.
- Follow secure database and API practices.
- Never expose secrets or bypass security checks.

## Change Impact and Regression Prevention
- Identify affected components before modifying code.
- Check dependencies across frontend, backend, APIs, database, authentication, and user roles.
- Update related functionality when necessary.
- Preserve existing features and expected behavior.
- Check for regressions after implementing changes.

## Testing and Test-Driven Development (TDD)
- Use selective TDD for business logic, important new features, and bug fixes when practical.
- Follow Red → Green → Refactor: write a focused failing test, implement the minimum fix, then improve code while tests pass.
- Cover expected behavior, relevant edge cases, and failure scenarios.
- Prefer unit tests for logic and integration tests for connected components.
- Skip test-first development for styling, layouts, animations, and minor text changes.
- Reuse existing testing frameworks; do not install testing tools unless necessary and approved.
- Run relevant existing tests, type checks, lint, or builds proportional to the change.
- Verify affected workflows and database operations when feasible, using safe isolated test data.
- Fix failures caused by changes and retest; report unrelated or blocked failures.
- Never weaken valid tests to make incorrect code pass.
- Never claim verification that was not actually performed.
- Keep test output concise and avoid unnecessary screenshots or repeated runs.

## Development Workflow
1. Interview the user, inspect relevant code, recommend an approach, and identify all material decisions.
2. Ask the complete grouped confirmation checklist, including decisions the user has not yet mentioned, and resolve or explicitly defer every material item.
3. Summarize confirmed requirements, exclusions, affected components, risks, data/security implications, and a concise implementation plan.
4. Wait for the exact phrase "start coding" before changing files or data.
5. Identify affected functionality and dependencies; implement only the approved scope using selective TDD where appropriate.
6. Run relevant existing tests and static checks.
7. Fix detected errors, retest, and check related functionality for regressions.
8. Briefly report verification results and limitations.

## Efficiency
- Keep explanations and responses concise.
- Avoid unnecessary planning and documentation.
- Do not automatically invoke optional skills.
- Avoid redundant tool calls and repeated analysis.
- Focus on implementation, correctness, and verification.
- Do not sacrifice code quality or essential testing for speed.

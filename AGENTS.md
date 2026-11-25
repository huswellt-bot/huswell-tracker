# AGENTS.md

## Requirements Interview and Coding Authorization
- Treat feature requests, updates, and bug fixes as planning discussions until authorized.
- Before coding, inspect only relevant code and interview the user to clarify expected behavior, workflows, UI/UX, data, permissions, and edge cases as needed.
- Scale questions to complexity: brief confirmation for simple changes; deeper interviews for complex features.
- Group related questions, avoid asking what existing code or prior answers already establish, and follow up on unresolved decisions.
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
1. Interview the user, inspect relevant code, recommend an approach, and align on a concise plan.
2. Wait for the exact phrase "start coding" before changing files or data.
3. Identify affected functionality and dependencies; implement only the approved scope using selective TDD where appropriate.
4. Run relevant existing tests and static checks.
5. Fix detected errors, retest, and check related functionality for regressions.
6. Briefly report verification results and limitations.

## Efficiency
- Keep explanations and responses concise.
- Avoid unnecessary planning and documentation.
- Do not automatically invoke optional skills.
- Avoid redundant tool calls and repeated analysis.
- Focus on implementation, correctness, and verification.
- Do not sacrifice code quality or essential testing for speed.

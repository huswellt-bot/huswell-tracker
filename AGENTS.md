# AGENTS.md

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

## Automatic Testing and Verification
- Automatically verify every added or modified feature.
- Prefer the official Playwright CLI for interactive browser testing.
- If Playwright CLI is unavailable, request permission to install or configure it; report blocked verification rather than claiming success.
- Test affected buttons, forms, navigation, and user workflows.
- Verify actual behavior, not just successful builds or page rendering.
- Check browser errors and relevant failed network requests.
- Verify database operations when applicable, using isolated test data.
- Run relevant build, type-check, lint, and existing automated tests.
- Fix detected errors and retest; report unresolved failures.
- Check related functionality for regressions.
- Never perform destructive tests against production data.
- Minimize snapshots, screenshots, and browser output to save tokens.
- Never claim success without actual verification.
- Report what passed, failed, or could not be tested.
- Keep testing proportional to the changes made.

## Development Workflow
1. Understand the request and inspect relevant code.
2. Identify affected functionality and dependencies.
3. Implement the smallest complete solution.
4. Run relevant static checks and existing tests.
5. Use Playwright CLI to verify affected user-facing behavior.
6. Fix detected errors and retest.
7. Check related functionality for regressions.
8. Briefly report verification results and limitations.

## Efficiency
- Keep explanations and responses concise.
- Avoid unnecessary planning and documentation.
- Do not automatically invoke optional skills.
- Avoid redundant tool calls and repeated analysis.
- Focus on implementation, correctness, and verification.
- Do not sacrifice code quality or essential testing for speed.

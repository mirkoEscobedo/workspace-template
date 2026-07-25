# TypeScript implementation guidance

- Enable `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` for new projects.
- Prefer `readonly` data and functions for domain transformations.
- Use discriminated unions for finite state, commands, events, and errors.
- Parse `unknown` at external boundaries; do not let `any` leak into policy.
- Use interfaces or structural types for injected capabilities, not for every concrete class.
- Use classes for adapters, resource ownership, or invariant-bearing entities; avoid stateless “manager” classes.
- Represent money with integer minor units or a decimal library chosen deliberately.
- Keep framework imports out of pure domain modules.
- Prefer explicit result unions when failure is expected and actionable; reserve exceptions for exceptional or framework-mediated paths.
- Test pure functions directly and application use cases through public ports.

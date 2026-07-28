# JavaScript implementation guidance

- Use ESM, `// @ts-check`, JSDoc types, and a no-emit TypeScript check for new Node code.
- Validate external inputs at runtime; JSDoc does not protect runtime boundaries.
- Prefer immutable objects, pure functions, and explicit return shapes for domain behavior.
- Use `Object.freeze` only when runtime enforcement has clear value; conventions and focused APIs are often enough.
- Keep modules cohesive and exports narrow. Avoid utility grab bags and mutable singletons.
- Use classes for stateful adapters/resources or invariant-bearing objects, not namespaces.
- Return structured errors or throw typed errors consistently; do not mix silent sentinels, strings, and exceptions.
- Test with Node's built-in runner unless the project needs richer tooling.

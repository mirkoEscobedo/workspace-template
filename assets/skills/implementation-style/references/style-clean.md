# Clean ports-and-adapters style

Use when domain policy is long-lived, several delivery mechanisms or infrastructure providers exist, or volatility and team scale justify explicit boundaries.

## Dependency direction

```text
frameworks/adapters -> application/use cases -> domain policy
```

- Domain code depends only on language primitives and stable domain concepts.
- Application use cases coordinate domain behavior and declare the capabilities they require.
- Ports are owned by the inner layer that consumes them. Adapters implement those ports.
- Framework DTOs, database rows, and API payloads are translated at boundaries; they are not domain models by default.
- A composition root wires concrete adapters, configuration, transactions, and observability.
- Use-case APIs expose business intent rather than CRUD mechanics.
- Repositories represent meaningful aggregate or query boundaries, not one class per database table.
- Keep view/controller logic thin and map domain failures to transport-specific responses at the edge.
- Test domain and application layers without framework bootstrapping; test each adapter against its contract.

Clean architecture is conditional, not a folder tax. Omit an empty layer. Collapse modules when the dependency rule remains obvious. Add complexity only when it protects changeability, policy, or test seams.

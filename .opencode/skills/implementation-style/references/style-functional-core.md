# Functional core, imperative shell

Use as the default for business applications and stateful workflows.

## Shape

```text
impure input -> application shell -> pure policy -> application shell -> impure output
```

- The **core** contains calculations, validation, invariants, state transitions, decisions, and data transformations.
- The **shell** reads from repositories/APIs/clocks, calls the core with ordinary values, persists or publishes results, and controls transactions.
- Model decisions as pure functions over immutable values where practical.
- Return decisions or commands from the core instead of performing effects inside it.
- Pass `now`, IDs, randomness, flags, exchange rates, and current-user context explicitly.
- Use a use-case function or dependency-owning service to coordinate effects.
- Use fakes for owned ports in application tests; test pure policy without mocks.
- Keep transaction boundaries around the complete use case, never inside a pure domain function.
- Place concrete adapter construction in a composition root.

Do not force every entity into a class or every dependency behind an interface. The goal is visible effects and independently testable policy, not architectural ceremony.

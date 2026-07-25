# Refactoring patterns for agentic implementation

## Definition

Refactoring changes internal structure while preserving externally observable behavior. It is not feature work, bug fixing, dependency upgrading, or schema migration—although those tasks may create a need for refactoring.

An agent should refactor with a protected behavioral baseline, one named transformation at a time, and a rerun after each step.

## Safe sequence

```text
scope → characterize → choose smell → choose transformation →
small edit → focused check → inspect diff → repeat → full verification
```

1. Define the behavior boundary that must not change.
2. Establish green tests; add characterization tests where behavior is important but undocumented.
3. Name the smell and the intended improvement.
4. Select the smallest reversible transformation.
5. Apply one transformation.
6. Run the narrowest reliable check.
7. Inspect the diff for accidental semantic changes.
8. Continue or stop; do not bundle unrelated cleanup.
9. Run full relevant verification.

## Behavior-preserving catalog

### Naming and intent

| Smell | Transformation | Guardrail |
|---|---|---|
| misleading name | Rename Variable/Function/Type | search public consumers and serialized/config names |
| comment explains confusing code | Extract Function, Rename, Introduce Variable | keep comments that explain why, invariants, or external constraints |
| magic literal | Replace Magic Literal with Symbolic Constant | do not merge values that happen to be equal but mean different things |

### Functions and control flow

| Smell | Transformation | Guardrail |
|---|---|---|
| long function | Extract Function | extract around a coherent decision, not arbitrary line count |
| trivial indirection | Inline Function | retain seams that protect volatility or clarify domain vocabulary |
| nested conditionals | Guard Clauses | preserve evaluation order and side effects |
| temporary variable obscures expression | Inline Variable | keep a name when it communicates domain meaning |
| repeated expression | Introduce Variable / Extract Function | verify evaluation count if expression is effectful or expensive |
| flag argument changes behavior | Replace Parameter with Explicit Functions/Commands | protect API compatibility or migrate callers deliberately |
| switch on domain state spread everywhere | Replace Conditional with State/Strategy or central reducer | avoid class hierarchies when a closed enum + pure match is simpler |

### Data and types

| Smell | Transformation | Guardrail |
|---|---|---|
| primitive obsession | Introduce Value Object/Newtype | add only when invariants/meaning justify it |
| parallel arrays/parameters | Introduce Parameter Object | avoid catch-all context objects |
| mutable shared value | Encapsulate/Replace with Immutable Value | consider performance/ownership and serialization |
| impossible states representable | Introduce Tagged Union/Enum/Sealed Type | migrate deserialization and exhaustive matches |
| transport/database shape leaks inward | Introduce Mapper/Boundary DTO | do not duplicate identical models without a boundary reason |

### Modules and dependencies

| Smell | Transformation | Guardrail |
|---|---|---|
| unrelated responsibilities | Extract Module/Class | define a small public interface and ownership |
| feature spread across global layers | Move Function/Type into feature | retain genuinely shared domain concepts centrally |
| business policy imports framework/DB | Extract Pure Core / Invert Dependency | move only a real boundary; do not create interfaces for every function |
| concrete external dependency blocks tests/change | Introduce Port and Adapter | application owns the capability contract |
| construction scattered | Introduce Composition Root | avoid global service locator |
| transaction boundaries hidden in repositories | Move Transaction to Use Case/Unit of Work | preserve atomicity and retry semantics |
| giant service | Split by Use Case | share pure policy, not a new generic service dumping ground |

### Functional refactorings

- Extract pure function from an effectful workflow.
- Pass hidden dependencies—time, randomness, IDs, flags—as inputs.
- Replace mutation with an explicit state transition.
- Replace callback soup with a returned decision/effect description.
- Fuse or compose transformations when it improves clarity and does not obscure errors/performance.
- Replace partial functions with total functions or explicit result types.
- Isolate effect interpretation from decision generation.

Guardrail: purity is a design tool, not a contest. Do not allocate/copy enormous structures merely to satisfy a slogan when owned mutation is clearer and safe.

### Object-oriented refactorings

- Move Method to the object/module that owns the information.
- Replace Data Class with behavior only when invariants genuinely belong there.
- Replace inheritance with composition when variation is orthogonal.
- Collapse needless interfaces/implementations.
- Encapsulate a stateful resource and its lifecycle.
- Replace an anemic domain method that performs I/O with a pure domain decision plus application orchestration.

Guardrail: do not force every operation into a class. Functions are first-class design units in Rust, TypeScript, JavaScript, and Dart.

### Asynchronous and concurrent refactorings

- make cancellation and timeout explicit;
- move blocking I/O off async executors/UI threads;
- narrow lock scope and ownership;
- replace shared mutable coordination with messages or immutable snapshots where appropriate;
- centralize retry policy at the effect boundary;
- make operations idempotent before automatic retry;
- remove sequential awaits only after dependency/order analysis;
- use structured concurrency rather than detached tasks.

Guardrail: concurrency refactors can change timing, ordering, and failure behavior even when return values look identical. Add targeted race/order/resource tests.

### React refactorings

- extract state transition logic into a reducer;
- extract reusable stateful/effectful behavior into a custom hook;
- keep pure helpers as plain functions, not hooks;
- split a component at a coherent rendering/interaction boundary;
- move data-fetching/cache effects to the chosen framework boundary;
- replace prop drilling selectively with composition/context, not global context by default;
- remove derived state and calculate it during render when cheap and pure.

Verify with accessible component behavior and, where needed, reducer/hook tests.

### Flutter refactorings

- move calculation/validation from widgets into pure Dart;
- move coordinated UI behavior into a ViewModel/state holder;
- introduce repository/service only when external data/platform access exists;
- separate DTO mapping from domain/application values;
- replace boolean soup with sealed UI states/actions;
- split large widgets by cohesive presentation/interaction boundaries;
- preserve widget keys/semantics and navigation behavior deliberately.

Verify with Dart tests, widget tests, and focused integration tests.

### Rust refactorings

- introduce newtypes for meaningful invariants;
- replace boolean/optional combinations with enums;
- extract traits at external boundaries;
- reduce cloning by clarifying ownership/borrowing, not by adding lifetimes everywhere;
- replace panic/unwrap on expected paths with typed errors;
- isolate unsafe/FFI code behind a safe abstraction;
- split modules by capability/domain rather than one type per file;
- use iterator transformations where they clarify intent, not merely to eliminate loops.

Run `cargo fmt`, `clippy -D warnings`, tests, and relevant feature combinations.

## Architecture migration patterns

Large structural changes should use a strangler-style sequence rather than a big-bang rewrite.

### Extract functional core

1. characterize current behavior at the public seam;
2. identify one decision currently mixed with I/O;
3. capture required values as inputs;
4. extract a pure function;
5. call it from the existing shell;
6. add direct domain tests;
7. repeat.

### Introduce a port

1. identify a volatile external capability and its actual use-case needs;
2. define the narrow application-owned contract;
3. wrap the existing concrete integration as an adapter;
4. move construction to a composition root;
5. add a fake only for application behavior tests;
6. add contract/integration tests for the real adapter;
7. remove direct outer dependency imports from inner code.

### Move from global layers to feature-first

1. choose one coherent feature;
2. map public consumers and shared types;
3. move behavior with tests, preserving import compatibility temporarily if needed;
4. expose a feature public API;
5. update consumers in small batches;
6. delete compatibility exports only after the migration is complete.

### Break a giant service into use cases

1. characterize each public operation;
2. identify shared pure policy versus shared mutable/resource dependencies;
3. extract one use-case function/class at a time;
4. inject only dependencies that use case needs;
5. retain a temporary facade if callers need staged migration;
6. remove the facade when no longer valuable.

## Refactoring tests

Tests can also smell:

| Test smell | Refactoring |
|---|---|
| asserts private calls/order | assert public outcome/state instead |
| enormous setup | test-data builder or focused fixture |
| one test covers many behaviors | split by observable behavior |
| duplicated expected computation | replace with independent worked examples/literals |
| brittle snapshot | assert meaningful semantics or narrow snapshot scope |
| mock graph mirrors implementation | use real collaborators or owned boundary fake |
| slow suite with no layering | separate fast behavior tests, adapter integration, and few e2e |
| flaky timing sleeps | condition/event-based waiting and controlled clock |

Do not “refactor” a test so far away from public behavior that it stops detecting regressions.

## When not to refactor

Stop or defer when:

- the baseline is red for an unrelated reason;
- behavior is not understood and cannot be characterized;
- the change is a hot production mitigation with no safe verification window;
- a migration must preserve a compatibility detail you cannot yet observe;
- the proposed abstraction has only hypothetical consumers;
- the cleanup would materially expand the feature/bug-fix diff;
- generated/vendor code is the true source;
- the change would require coordinated release/migration not in scope.

Record a follow-up with the concrete smell and evidence rather than silently broadening scope.

## Agent review checklist

Before declaring a refactor complete:

- [ ] Observable behavior is explicitly named.
- [ ] Baseline/characterization tests were green before the edit.
- [ ] Each transformation was small and named.
- [ ] Focused checks ran after meaningful steps.
- [ ] Public API/config/serialization changes are absent or intentionally migrated.
- [ ] Performance, concurrency, transaction, and resource semantics were considered.
- [ ] No speculative abstraction or empty layer was added.
- [ ] Final full verification is fresh.
- [ ] The diff contains no unrelated cleanup.

## References

- Martin Fowler refactoring catalog: https://refactoring.com/catalog/
- Martin Fowler on TDD: https://martinfowler.com/bliki/TestDrivenDevelopment.html
- Refactoring, 2nd edition: https://martinfowler.com/books/refactoring.html

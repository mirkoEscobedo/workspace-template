# Coding implementation patterns and style selector

## Recommended default

Use **functional core, imperative shell** for business applications unless the change is truly simple or the system has enough volatility to justify explicit clean/hexagonal boundaries.

```text
impure input → pure decisions/state transitions → impure output
```

The goal is not “pure everything.” The goal is to make important decisions easy to test and external effects easy to see, control, and replace.

## Style decision table

| Signal | `simple` | `functional-core` | `clean` |
|---|---|---|---|
| Domain rules | few/local | meaningful calculations/transitions | complex and long-lived |
| External adapters | zero or one obvious boundary | several effects, thin shell | several volatile providers/delivery mechanisms |
| Team/ownership | small | any | multiple teams or durable subsystem |
| Test need | direct module tests | pure core + shell/use-case tests | domain + use case + port contracts + adapter integration |
| Interface cost | would be ceremony | selective boundary interfaces | explicit application-owned ports are justified |
| Expected change | local | rules and I/O evolve separately | adapters/frameworks/workflows evolve independently |

### Decision rule

Choose the smallest style that prevents a concrete failure mode in the current change. Do not choose `clean` because the folder tree looks professional; choose it because inward dependency direction and replaceable boundaries buy something measurable.

## `simple`: cohesive modular code

Use when:

- the behavior is small and locally understandable;
- there is no meaningful external boundary;
- a second implementation is speculative;
- the public API is already a good test seam.

Rules:

- organize by feature;
- prefer plain functions and data;
- keep I/O visible at call sites;
- extract a module when it hides meaningful complexity;
- introduce a port only when a real boundary, volatility, or test seam earns it.

Bad simple code is not “insufficient layers.” It is hidden global state, mixed concerns, unbounded functions, or effects that cannot be tested or controlled.

## `functional-core`: pure decisions, explicit effects

Use when:

- the application contains calculations, validation, policies, reducers, or state machines;
- it reads/writes databases, APIs, files, clocks, randomness, queues, or platform services;
- business behavior should survive framework changes;
- fast, low-mock tests are valuable.

### Core

The core accepts ordinary values and returns values or explicit decisions:

- calculations;
- validation;
- parsing/normalization after boundary validation;
- pricing/policy decisions;
- state transitions;
- reducers;
- allocation/scheduling decisions;
- commands/events to be interpreted by the shell.

Properties:

- deterministic where practical;
- no hidden clock/randomness/current user/environment;
- no database/network/filesystem/logging;
- immutable input/output by default;
- explicit error/result model.

### Shell

The shell:

- reads input;
- validates/decodes boundary formats;
- loads required state;
- supplies time/randomness/identity/configuration;
- invokes pure behavior;
- commits writes and external messages;
- translates errors to HTTP/UI/CLI/platform responses;
- owns transaction and retry boundaries.

Keep orchestration small. When an application function accumulates detailed calculations, move those decisions into the core.

### Effects as data

For complex workflows, return effect descriptions rather than performing effects in the core:

```text
DecisionResult {
  newState,
  eventsToPublish,
  notificationsToSend,
  auditFacts
}
```

The shell interprets them. This is particularly useful for deterministic retries, event-driven systems, and state-machine testing.

## `clean`: ports, adapters, inward dependencies

Use when:

- several external services can change independently;
- the same use cases have multiple delivery mechanisms;
- domain/application behavior needs a stable test surface;
- adapter substitution is real, not hypothetical;
- transaction and orchestration policy are significant;
- the subsystem will be maintained for years by multiple contributors.

### Dependency direction

```text
framework/UI/DB adapters → application use cases → domain policy
```

Inner policy does not import outer frameworks. The application layer defines the capabilities it needs. Adapters implement those contracts. The composition root creates concrete implementations.

### Ports

Good ports describe application needs:

- `OrderRepository.findPendingForCustomer`
- `PaymentGateway.authorize`
- `Clock.now`
- `IdGenerator.newOrderId`
- `EventPublisher.publish`

Weak ports mirror technology:

- `GenericCrudRepository<T>`
- `DatabaseHelper`
- one interface per table without domain meaning;
- an interface around every pure function.

### Application services/use cases

A use case should:

1. obtain required data through narrow ports;
2. call domain decisions;
3. coordinate transaction/effect order;
4. persist results;
5. return a domain/application outcome.

It should not become a giant dumping-ground service.

### Composition root

Construct concrete dependencies at one outer location. Avoid service-locator access from domain/application code. Dependency injection is a wiring technique, not a reason to create classes for stateless operations.

## Cross-cutting implementation patterns

### Functions versus classes/structs

Prefer a function when behavior is:

- a calculation, validation, transformation, or state transition;
- stateless and composable;
- naturally described by input and output values.

Prefer a class/struct/object when it:

- owns a resource or injected dependencies;
- represents identity and lifecycle;
- protects meaningful invariants;
- maintains necessary state;
- implements a boundary with multiple operations.

A one-method stateless `CalculatorService` is usually a function wearing ceremony.

### Immutable values

Prefer immutable domain values because they:

- make state transitions explicit;
- reduce aliasing and hidden mutation;
- simplify tests and concurrency reasoning;
- make event/history/debugging clearer.

Use controlled mutation when it is idiomatic or performance-critical, but keep ownership and invariants local.

### Explicit time, randomness, identity, and context

Pass these as values or narrow dependencies:

- current time;
- random source;
- UUID/ID generator;
- feature flags;
- exchange rates;
- current principal/tenant;
- locale/time zone.

Hidden reads make behavior nondeterministic and tests fragile.

### Error modeling

Use the idiom of the stack, but keep expected business outcomes distinct from defects:

- Rust: `Result<T, E>`, domain enums, `?`, avoid panics for expected conditions;
- TypeScript: discriminated unions/results for expected branching, exceptions for truly exceptional/integration failures where consistent;
- JavaScript: explicit errors/results and runtime validation at untrusted boundaries;
- Dart: sealed outcomes or typed exceptions/results according to project conventions;
- UI: translate application outcomes into state, not raw transport exceptions scattered through components.

Do not return `{error, data}` with impossible mixed states when a tagged union can encode valid alternatives.

### Boundary validation

Parse and validate untrusted data once at the boundary. Convert transport/database shapes into domain/application values. Do not let snake_case rows, JSON-null ambiguity, or framework request types leak through the core.

### Repository pattern

Use a repository when it gives a meaningful collection-like domain boundary or protects a use case from persistence details. Do not create a repository for every table by default. Adapter contract/integration tests should verify mapping, query semantics, and failure behavior.

### Unit of Work / transactions

Transactions belong around the complete application operation. Pure domain logic should not begin, commit, or roll back transactions. Keep external side effects and database commit ordering deliberate; use outbox/idempotency patterns when atomicity crosses systems.

### State machines and reducers

Use explicit state plus actions/events when behavior has transitions:

```text
next_state = reduce(current_state, action)
```

This is a natural functional core for React, Flutter, workflow engines, and protocol/domain lifecycles. Encode invalid transitions explicitly.

### Deep modules

Prefer a small, stable interface that hides substantial implementation detail. Do not expose every internal step as a public method merely to make it testable. Test the public seam and use internal pure helpers where they clarify logic.

## TDD strategy by seam

### Domain seam

- pure function or domain API;
- table/example/property tests;
- no mocks;
- invariants and boundary values.

### Application/use-case seam

- invoke the public use case;
- use simple in-memory fakes for application-owned ports;
- assert returned outcome and observable owned state;
- avoid asserting incidental internal call order.

### Adapter seam

- contract or integration test against the real protocol when feasible;
- verify serialization, mapping, retries/timeouts, error translation, transactions, and resource cleanup;
- test doubles only for systems that cannot safely/reliably run in the suite.

### UI seam

- React: component behavior through accessible DOM interactions; reducer/hook tests for complex logic; avoid testing internal state variables.
- Flutter: widget interactions and rendered behavior; pure Dart tests for reducers/domain; integration tests for critical platform flows.

### End-to-end seam

Keep a small number of critical journeys. E2E tests provide broad confidence but have higher cost and diagnostic latency.

## Reconciling TDD and refactoring

Canonical TDD is red → green → refactor. This package uses:

- **micro-refactoring** after each green: naming, duplication removal, tiny extraction, local simplification;
- **structural refactoring** as a separate protected change: moving module boundaries, replacing architecture, large dependency inversion, broad data-shape migration.

This preserves the fast feedback of canonical TDD without smuggling unrelated architecture work into every feature slice.

## Stack adaptations

### Rust

- model domain states with structs/enums and newtypes;
- use free functions for pure transformations;
- use traits at genuine external/application boundaries;
- prefer generics for static composition when simple, trait objects when runtime polymorphism is needed;
- make ownership explicit rather than cloning reflexively;
- use `Result` and typed errors; reserve panic for programmer errors/unrecoverable invariants;
- isolate `unsafe`, FFI, runtime, database, and filesystem code in adapters;
- run `fmt`, `clippy -D warnings`, and tests.

Do not imitate Java service/interface hierarchies.

### TypeScript

- enable strict type checking;
- use discriminated unions and exhaustive switches for state/outcome models;
- validate external data at runtime; TypeScript types do not validate JSON;
- prefer `readonly` values and pure functions for policy;
- use interfaces/types at boundaries, not one interface per class;
- keep dependency construction out of domain modules;
- use behavior tests plus typecheck/lint/build.

### JavaScript

- use ESM consistently in the starter;
- use `checkJs`/JSDoc when static feedback is valuable;
- validate external inputs because no compile-time type boundary exists;
- use `node:test` or the project test runner through public behavior;
- avoid mutable module-level state;
- keep async errors and promise lifecycles explicit.

### React

- render should remain pure;
- use reducers when state transitions are complex or distributed;
- use custom hooks to encapsulate reusable stateful/effectful behavior, not pure helpers;
- keep server/API/cache effects at hooks/adapters or framework data boundaries;
- test components through user-observable DOM behavior;
- avoid introducing repositories into components that only manage local UI state;
- separate domain/application state transitions from rendering when complexity earns it.

### Flutter/Dart

Official Flutter guidance recommends separation of UI and data concerns and commonly uses views/view models plus repositories/services, while explicitly allowing adaptation to application needs. Apply that adaptively:

- put pure domain/reducer logic in ordinary Dart;
- keep widgets focused on presentation and user interaction;
- use a ViewModel/state holder for UI behavior that outgrows local widget state;
- add repositories/services when external data/platform capabilities exist;
- define application/domain ports inward when clean style is justified;
- use immutable models where practical and exhaustive sealed states/actions;
- test pure Dart logic, ViewModels, widgets, and only critical integrations at their appropriate seams;
- do not create empty layers because a diagram contains them.

The linked 2019 Reso Coder clean-architecture course is useful historical inspiration. For current defaults, prefer the maintained official Flutter architecture/testing guidance and adapt the pattern to today's framework APIs.

## Implementation anti-patterns

- database/API calls inside domain entities;
- passing a general database client into a calculation;
- hidden clock/randomness/environment reads;
- global mutable state or service locator access;
- one repository per table by default;
- generic CRUD abstractions before repeated use cases exist;
- giant `*Service` classes with unrelated operations;
- DTO/database/framework types crossing every layer;
- exceptions used for ordinary branching with no project convention;
- functions wrapped in classes solely for “architecture”;
- horizontal layer-first delivery;
- tests that mock internal collaborators and assert implementation order;
- pure-core dogma that forces awkward transformations where controlled state is clearer;
- clean-architecture folder trees with no meaningful dependency inversion.

## Source links

- User-provided reference: `example.md` (functional core, ports/adapters, repositories, functions/classes, Rust and TypeScript examples)
- Reso Coder Flutter TDD Clean Architecture course: https://resocoder.com/2019/08/27/flutter-tdd-clean-architecture-course-1-explanation-project-structure/
- Flutter architecture guide: https://docs.flutter.dev/app-architecture/guide
- Flutter testing: https://docs.flutter.dev/testing/overview
- Effective Dart: https://dart.dev/effective-dart
- React reducers: https://react.dev/learn/extracting-state-logic-into-a-reducer
- React custom hooks: https://react.dev/learn/reusing-logic-with-custom-hooks
- Rust testing: https://doc.rust-lang.org/book/ch11-00-testing.html
- Rust traits: https://doc.rust-lang.org/book/ch10-02-traits.html
- Fowler refactoring catalog: https://refactoring.com/catalog/

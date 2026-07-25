# Workflow selection

## Wayfinder versus Compile Master Plan

Wayfinder resolves **decisions**. It is complete when the destination and route are stable enough to bound implementation.

Compile Master Plan resolves **execution structure**. It is complete when each ticket has a public outcome, dependencies, risk lane, review lenses, verification policy, and stop conditions.

Do not force an ambiguous effort directly into detailed tickets. Do not keep Wayfinder open after no material route-changing decisions remain.

## Compile versus Execute

Compile when the ticket graph or contracts do not yet exist or are materially inconsistent.

Execute Frontier when the local pack validates and at least one ticket is ready. Frontier is the only execution workflow; it can run sequentially or exploit safe concurrency according to the graph.

## Harness capability is not a second mode

The normal topology uses a coordinator plus fresh role-specific subagents. When a harness cannot spawn subagents, the coordinator may perform the same phases sequentially, writing an implementation report before beginning a clean review phase. This is a compatibility fallback, not a separate planning or execution system.

No branch requires GitHub issues, webhooks, repository polling, or an external scheduler.

# Scheduling details

## Write-set intersections

Treat globs conservatively. If one set contains a parent directory of another, they intersect. Empty uncertain sets are not disjoint; they require preflight.

## Conflict keys

Conflict keys capture semantic resources not visible from file paths, such as:

- `product-runtime-state-machine`
- `economic-authority`
- `transaction-admission`
- `root-dependency-manifest`
- `database-migration-order`
- `shared-test-fixture`

## Landing

Workers may commit only in isolated worktrees when the contract says `isolated-worker`. The integrator still owns landing order and branch authority.

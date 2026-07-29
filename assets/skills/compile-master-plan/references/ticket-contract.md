# Ticket contract fields

## Identity

- `id`, `title`, `legacy_ids`, `status`, `parent`

## Outcome

- `public_outcome`: one observable result expressed as a nonblank string
- `behaviors`: independently testable behaviors
- `invariants`: properties that must remain true
- `out_of_scope`: explicit exclusions

## Scheduling

- `blocked_by`: hard prerequisites only
- `risk_lane`: 0–3
- `read_set`, `write_set`: expected glob/path sets
- `conflict_keys`: semantic resources that cannot be mutated concurrently
- `preflight_required`: true when sets or seams are uncertain

## Execution

- `skills`: required reusable practices
- `human_gates`: exact actions requiring explicit authority
- `stop_conditions`: conditions that invalidate the ticket boundary
- `commit_policy`: coordinator or isolated-worker

## Verification

- `red`: command or observation that proves the test is meaningful
- `repair_levels`: verification ladder after a repair
- `landing_levels`: verification ladder before commit/integration
- `commands`: exact commands when known
- `native_checks`: checks that cannot be replaced by mocks

Every executable ticket must include a `verification` object whose `commands`
contains at least one nonblank exact command. Missing verification, missing
commands, `commands: []`, and blank command strings are contract errors.
Non-executable records are limited to `kind` values `tracker`,
`aggregate-only`, and `historical`, plus `execution_policy` values
`aggregate-only` and `historical-only`. These exemption markers require exact
string equality; whitespace-padded or otherwise normalized variants are
executable.

## Budgets

- locked test/production files and allowed growth
- max new file LOC where applicable
- process postcondition, normally zero owned descendants

A contract should be conservative. An empty or preflight-marked write set is safer than a fabricated one.

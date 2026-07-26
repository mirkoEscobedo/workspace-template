# FBK-001 Result

Date: 2026-07-26

## Implementation evidence before independent review

- The original implementation introduced the exact optional
  `fallbacks.codexChildModelRefusal` contract, Spark/xhigh semantic routing,
  Terra/medium transport broker rendering, expanded active state, collision
  allocation, partial-state preservation, report generation, manifest-last
  apply, and exact caught-failure rollback.
- No original pre-implementation RED transcript was present in the immutable
  ticket packet when this repair began. It has not been reconstructed or
  invented. The first repair RED run freshly re-observed all six pre-existing
  fallback tests GREEN while the two newly added review regressions failed for
  the intended chained-collision and false Codex-state reasons.
- The coordinator handoff recorded a fresh pre-repair intermediate full-suite
  result of 158/162 passing. The four failures were not treated as an FBK-001
  pass. L3/L4 inactive-catalog materialization is explicitly deferred to
  FBK-005 by amendment `fbk-001-independent-review-repair-2026-07-26`.

## First independent-review findings

All findings were repaired as one coherent transaction/routing slice without
changing the contract, weakening assertions, or expanding authority.

1. Broker allocation reserved parsed TOML `name` values but not every
   candidate destination filename, so chained collisions could select an
   existing unowned path.
2. Preserved Codex configuration that disabled native agents could still leave
   broker artifacts and fallback claims in generated state.
3. The JSON Schema and runtime validator were not aligned for relational
   broker aliases and missing native/delegate target bindings.
4. Apply rejected direct symlink targets but did not reject/revalidate ancestor
   junctions at the mutation boundary and had only in-process rollback, not a
   durable interrupted-transaction recovery journal.
5. The initial evidence packet lacked the immutable implementation/review/
   repair record required by the ticket.

## Repair report

### Behavior and code

- Broker allocation now reserves every unowned TOML destination stem plus
  every parsed role ID. The deterministic chain is
  `opencode_spark_broker`, `wt_opencode_spark_broker`,
  `wt2_opencode_spark_broker`, and so on; all collision bytes remain untouched.
- Preserved Codex overrides at `/agents/enabled` or a non-runnable
  `/agents/max_concurrent_threads_per_session` suppress the broker artifact,
  broker role ID, fallback state, and routing-policy fallback section. OpenCode
  preservation continues to suppress the delegate route.
- Schema and runtime validation both require the exact `terra-medium` broker
  alias, the exact seven `codex-spark-xhigh` semantic role aliases, a native
  broker target, and native/OpenCode semantic targets. The independent matrix
  includes undeclared broker alias, missing broker target, missing delegate
  target, unknown field, and valid fallback fixtures.
- `src/presets/transaction.js` owns durable preset transaction effects. It
  writes and syncs exact base64 snapshots before product mutation, records
  parent identities, rejects symlink/junction ancestors, revalidates identities
  immediately before each mutation, restores exact bytes/absence in reverse,
  verifies recovery, and removes the journal only after manifest-last success
  or exact recovery.
- Planning fails closed while `.agentic/preset-transaction.json` exists. A
  later apply of the sealed plan restores exact snapshots before precondition
  validation and before any new product write.
- Caught write failure and `AbortError` cancellation fully roll back. A child
  process terminated by `SIGTERM` leaves durable recovery state; the next
  sealed apply recovers and completes. Parent substitution leaves the journal
  recoverable, makes no external write, and succeeds only after the original
  safe parent identity is restored.
- The manifest remains the last product operation. `sol-codex` was not
  activated, OpenCode was not launched, and no remote, release, publish, push,
  or deploy action occurred.

### RED/GREEN chronology

- RED:
  `node --test test/preset-fallback.test.js` passed 6/8 and failed the two new
  regressions:
  expected `wt4_opencode_spark_broker` but received
  `wt_opencode_spark_broker`; preserved `agents.enabled = false` still claimed
  a fallback.
- GREEN after routing repair: the same focused command passed 8/8.
- RED:
  `node --test --test-name-pattern="schema and runtime" test/preset-fallback.test.js`
  failed 0/1 because the schema accepted an undeclared broker alias.
- GREEN after schema/runtime repair: the same command passed 1/1.
- GREEN for existing atomicity after journal integration:
  `node --test --test-name-pattern="rolls back every preset artifact" test/preset-fallback.test.js`
  passed 1/1, including failure injection at every write boundary.
- GREEN for new operations/security coverage:
  `node --test --test-name-pattern="caught cancellation|interrupted apply|junction ancestors|parent substitution" test/preset-fallback.test.js`
  passed 4/4.
- Final focused:
  `node --test test/preset-fallback.test.js` passed 13/13 in 15.12 seconds.
- Affected legacy/rendering:
  `node --test test/configuration.test.js test/presets.test.js test/adopt.test.js`
  passed 21/21 in 26.00 seconds.
- Lint: `npm.cmd run lint` passed repository self-check. Python was unavailable,
  so bundled Python received import inspection rather than syntax parsing.
  The documented Python managed-command and architecture-budget wrappers were
  therefore unavailable; all Node commands were bounded by the command owner
  and completed.
- Current broad suite: `npm.cmd test` passed 165/169 in 65.16 seconds. All seven
  repair regressions passed. Four failures remain visible:
  `test/process-utils.test.js` process start identity unresolved;
  `test/upgrade-compatibility.test.js` expected `current` but the new preset
  report operation made it `ready`; and two `test/upgrade-plan.test.js`
  inactive-catalog/report idempotence expectations. The latter L3/L4
  materialization work is deferred to FBK-005. This is not a full-suite pass.

### Architecture, process, and routing evidence

- Locked `test/presets.test.js`: 139 LOC, one authorized assertion-only model
  update.
- Locked `test/adopt.test.js`: 380 LOC, one authorized assertion-only model
  update.
- New `test/preset-fallback.test.js`: 686 LOC, below the 700-LOC ticket limit.
- New `src/presets/transaction.js`: 224 LOC. Other touched preset modules are
  `apply.js` 156, `catalog.js` 260, `plan.js` 335, and `render.js` 357; all are
  below the 600-LOC new-production-file budget.
- `.agent/leases/` contains only `.gitkeep`; zero open workspace process leases
  and zero owned descendants were observed after verification.
- `node bin/workspace-template.js preset status . --json` reported active
  `sol-only`, status `active`, no overrides/errors, and fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.

### Base and diff identity

- Repair base/HEAD observed before this report append:
  `e841de2734bfb974523d239f860d7857961949e8`.
- Tracked FBK-001 product/test diff identity before this report append
  (`git diff --binary ... | git hash-object --stdin`):
  `b9cd874d18db520222535ff57793eb9eb64b8605`.
- Untracked file SHA-256 identities before this report append:
  - `src/presets/transaction.js`:
    `b7bfb233765ff4aa342f7d9cc763603ec594fabe3f81497330ebd06a02bf1503`
  - `test/preset-fallback.test.js`:
    `5b6bf596d19a6c3a4a2ee701bdd2b833d6873d9393ea602f8c60a4035e334294`
  - `assets/configs/codex/agents/opencode-spark-broker.toml`:
    `9ea772c0b026eb4428ac3e9c12bca0258459266e40f536ef5e66ac7f4b855a82`
- Exact final candidate diff identity:
  `<INTEGRATOR_TO_CAPTURE_AFTER_IMMUTABLE_EVIDENCE_AND_REVIEW_APPENDS>`.
  This placeholder is intentional because hashing a diff that contains its own
  hash is circular; the integrator owns the final candidate identity.

## Re-review status

The affected specification/authority, code/test, and operations/security
lenses are invalidated by this shared behavior/authority repair and must be
rerun independently against the final exact diff. No review pass is claimed in
this report.

## Post-report journal-identity hardening addendum

- Final audit identified one additional journal mutation boundary: journal
  removal itself. The persisted journal now records its own parent identity;
  normal completion and recovery both revalidate that identity before removal.
  A substituted `.agentic` parent therefore cannot make apply silently clear or
  lose visibility of the journal.
- Affected atomicity command after this hardening:
  `node --test --test-name-pattern="rolls back every preset artifact|caught cancellation|interrupted apply|junction ancestors|parent substitution" test/preset-fallback.test.js`
  passed 5/5 in 8.26 seconds.
- Final focused command after this hardening:
  `node --test test/preset-fallback.test.js` passed 13/13 in 14.93 seconds.
- Final `npm.cmd run lint` passed repository self-check; the Python limitation
  recorded above is unchanged.
- Final architecture counts are unchanged except
  `src/presets/transaction.js` is 227 LOC, still below budget.
- Superseding tracked product/test diff identity before this immutable addendum:
  `332a46e870832616c22a745fc4392b34a9c89908`.
- Superseding `src/presets/transaction.js` SHA-256:
  `4b0716270621c38c70d1f295f04fbf4910ff279111c72f8d49f1ea984993bc3e`.
  The focused test and broker-template SHA-256 values recorded above are
  unchanged.
- Final local audit again observed only `.gitkeep` under `.agent/leases/` and
  active `sol-only` fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- Final durable-write cleanup closes and removes an incomplete journal
  temporary file when journal write/sync fails before rename; product state is
  still untouched. After this final hardening, the focused suite passed 13/13
  in 15.12 seconds and lint passed. `transaction.js` is 234 LOC with SHA-256
  `52416267cee39a7e1e5d044c6d1dce4db9420e8811f99aadb27656540a053b82`;
  the tracked diff identity is unchanged because this module is untracked in
  the candidate worktree.

## Second independent-review repair — 2026-07-26

Authority: amended contract
`fbk-001-second-independent-review-repair-2026-07-26`. This section appends to,
and does not rewrite, the prior implementation and repair evidence.

### Reproduced findings and corrections

- Reserved fallback aliases are now value contracts, not merely declared
  references. Runtime and schema require `terra-medium` to be exactly
  `gpt-5.6-terra` with `medium`, and `codex-spark-xhigh` to be exactly native
  `gpt-5.3-codex-spark`, OpenCode
  `openai/gpt-5.3-codex-spark`, and `xhigh`.
- Any preserved OpenCode override blocks broker artifact materialization as
  well as fallback claims. Applying that partial state and then applying
  `sol-only` preserves the user-owned OpenCode bytes and leaves neither a
  broker file nor a managed-manifest orphan.
- Persisted broker role IDs must match
  `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`. Invalid or traversal-like values are
  ignored and deterministically reallocated; broker paths are asserted to be
  direct children of `.codex/agents`.
- Missing managed parent directories are represented during planning,
  recreated by the transaction, and recorded by exact directory identity.
  Caught rollback removes only transaction-created parents after all authored
  files have been restored and only when those parents are empty.
- Journal version 2 records explicit `pending`, `authoring`, `authored`, and
  `restored` entry states plus original/desired hashes. Recovery skips an
  original pending entry, restores only a current tool-authored desired hash,
  and fails closed without overwriting any third-party hash.
- Recovery bytes moved out of JSON metadata into
  `.agentic/.preset-transactions/snapshots`. The transaction directory owns a
  self-applying `*` ignore marker, so no user `.gitignore` or Git exclude file
  is modified. Snapshot and journal directories are restricted to mode `0700`
  on POSIX or a current-user-only inherited-disabled ACL through Windows
  `icacls`. Snapshots are removed after success or exact recovery and never
  appear in the preset report.
- Node v24.11 exposes no public `openat`, `renameat`, `unlinkat`, or equivalent
  directory-relative methods on `FileHandle`. The authorized fallback is a
  one-shot Node helper whose process cwd is pinned to the workspace root, then
  chdir-pinned segment by segment with post-chdir identity comparison. It
  remains pinned across the public pre-mutation hook and mutates only a
  separator-free basename. On Windows the open cwd prevents parent replacement
  (`EBUSY`, observed); on POSIX cwd remains bound to the original directory
  inode if its pathname is renamed, so a replacement symlink is not followed.
  The helper rechecks the same-parent content hash after the hook and before
  atomic rename/delete.
- Each mutation helper accepts one command, has no long-running descendants,
  exits on stdin closure, is bounded to 15 seconds, and is awaited/reaped before
  `afterWrite`. The SIGTERM crash helper therefore has no live mutation child
  when signalled; its exact PID was observed absent (`ESRCH`) after close.

### Second-repair RED/GREEN evidence

- RED reserved-value matrix:
  `node --test --test-name-pattern="schema and runtime" test/preset-fallback.test.js`
  failed because the schema accepted a wrong Terra model.
- GREEN reserved-value matrix: the same command passed 1/1, including wrong
  Terra model/reasoning and wrong native/OpenCode Spark model/reasoning.
- RED OpenCode partial lifecycle:
  `node --test --test-name-pattern="does not orphan" test/preset-fallback.test.js`
  failed because the partial plan still contained the preferred broker
  operation.
- GREEN partial lifecycle:
  `node --test --test-name-pattern="does not claim a fallback|does not orphan|does not materialize" test/preset-fallback.test.js`
  passed 3/3.
- RED unsafe persisted broker ID:
  `node --test --test-name-pattern="unsafe persisted broker" test/preset-fallback-security.test.js`
  failed because `../outside` was reused.
- GREEN broker containment:
  `node --test --test-name-pattern="unsafe persisted broker|chained collisions" test/preset-fallback-security.test.js test/preset-fallback.test.js`
  passed 2/2.
- GREEN missing-parent lifecycle:
  `node --test --test-name-pattern="recreates missing" test/preset-fallback-security.test.js`
  passed 1/1.
- GREEN restricted/self-ignored snapshots:
  `node --test --test-name-pattern="recovery bytes restricted" test/preset-fallback-security.test.js`
  passed 1/1.
- GREEN third-party preservation:
  `node --test --test-name-pattern="same-parent drift|authored transaction" test/preset-fallback-security.test.js`
  passed 2/2.
- GREEN Windows pinned-parent proof:
  `node --test --test-name-pattern="parent substitution" test/preset-fallback-security.test.js`
  passed 1/1; Windows returned `EBUSY` before replacement and no external bytes
  were written.
- Final focused fallback:
  `node --test test/preset-fallback.test.js` passed 9/9 in 33.37 seconds.
- Final boundary/security:
  `node --test test/preset-fallback-security.test.js` passed 10/10 in 188.10
  seconds. It includes failure injection at every product write boundary,
  cancellation, SIGTERM recovery, pending/authored drift, missing-directory
  rollback, privacy, junction preflight, and pinned substitution.
- L2:
  `node --test test/configuration.test.js test/presets.test.js test/create.test.js test/adopt.test.js test/upgrade-artifacts.test.js`
  passed 35/35 in 30.30 seconds.
- L0 lint: `npm.cmd run lint` passed repository self-check. Python remains
  unavailable, so Python received import inspection rather than execution.
- L0 `git diff --check` passed with only configured LF-to-CRLF notices.
- The requested ticket-pack validator was attempted with
  `python assets/scripts/validate_ticket_pack.py docs/tickets/conditional-spark-fallback --json`
  but the machine has no Python command. The FBK-001 verification policy also
  records that the Node validator asset does not yet exist; no validator pass
  is claimed.
- L3/L4 and the full suite were not rerun because the amended policy assigns
  them to the FBK-005 integration wave. No full-suite pass is claimed.

### Final local invariants and topology

- Active routing remains `sol-only`, status `active`, no overrides/errors,
  fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- No repository preset journal exists and `.agent/leases/` contains zero
  nonbaseline entries. Windows CIM process enumeration was denied by the
  sandbox, so no ambient process census is claimed; direct worker close and
  SIGTERM-helper PID absence are covered by the focused tests.
- Locked `test/presets.test.js` remains 139 LOC and locked
  `test/adopt.test.js` remains 380 LOC.
- `test/preset-fallback.test.js` is 520 LOC and
  `test/preset-fallback-security.test.js` is 462 LOC, each below the 700-LOC
  ticket limit.
- Touched production modules are below the 600-LOC limit:
  `apply.js` 195, `catalog.js` 274, `plan.js` 342, `render.js` 370,
  `mutation-worker.js` 208, and `transaction.js` 577.
- Repair base/HEAD remains
  `e841de2734bfb974523d239f860d7857961949e8`.
- Tracked FBK-001 product/test diff identity before this evidence append:
  `4f4ad2b4f49ed787dee090afda7a4f13cc0c7c77`.
- Current untracked SHA-256 identities before this evidence append:
  - `src/presets/transaction.js`:
    `0dd63abf2e83ecf7feb8d4c5d99aed8fe30f8f6b3416591e72f3084429ae8907`
  - `src/presets/mutation-worker.js`:
    `079fc9f7862ec7f680cb060626f736bb6f45533101f5c44e4b70e7f756290040`
  - `test/preset-fallback.test.js`:
    `122e9f30b2dfd77ee37b5a209a662bb3144381563e24f6b519a823126aa18192`
  - `test/preset-fallback-security.test.js`:
    `a853a6ff805d05a6ae6a0d6eab118c4daf6d7c2fa525c1e04f99daef29d5a198`
  - broker template:
    `9ea772c0b026eb4428ac3e9c12bca0258459266e40f536ef5e66ac7f4b855a82`
- Exact final candidate identity remains integrator-owned after immutable
  evidence and review appends.

All three review lenses are invalidated again by this shared validation,
routing, filesystem, process, and recovery repair. Specification/authority,
code/test, and operations/security must each rerun independently against the
exact final diff; no second-review pass is claimed here.

## Third independent-review repair — 2026-07-26

### Authority and repaired findings

The authorized `fbk-001-third-independent-review-repair-2026-07-26`
amendment was treated as the sole authority for this pass. Writes remained
inside `src/presets/**`, the two focused fallback tests, and this append-only
evidence file. No preset activation, OpenCode execution, release action,
remote mutation, contract rewrite, or prior-evidence rewrite occurred.

- Newly created target parents are now an explicit two-stage protocol. The
  worker captures identity immediately after `mkdir`, changes into that
  directory, compares the pinned post-`chdir` identity, and reports readiness
  without accepting a mutation. The parent must durably seal the exact
  identities in the journal before it can send the mutation command.
- If readiness validation or the seal fails, the parent closes, bounded-kills
  if necessary, and awaits the exact worker before rejecting. If the parent
  process dies, the independently bounded worker observes pipe EOF and removes
  only identity-matching empty directories that it created before acceptance.
  It has its own 15-second deadline; Windows ACL setup is separately bounded
  to five seconds.
- Journal version 3 predeclares every non-null recovery snapshot path in the
  initial durable journal. Snapshot directories are identity-sealed in the
  journal before bytes can be written, and snapshot creation requires no
  vulnerable post-write metadata update.
- Manifest-last success now durably changes the journal from `active` to
  `committed` before the first snapshot is deleted. Recovery of `committed`
  only resumes idempotent cleanup and never examines targets for rollback.
- The pinned worker now performs its supported post-operation boundary:
  final cwd identity plus final regular-file/hash, absence, or removed-directory
  state. Consistent with the amended contract, this does not claim portable
  protection from an uncooperative same-directory leaf replacement after that
  final check; preset apply relies on its exclusive-workspace-writer invariant.
- The worker/session lifecycle and parent identity behavior moved into the
  behavior-oriented `mutation-session.js`; `transaction.js` is 437 LOC rather
  than crossing its 600-LOC production budget.
- The OpenCode retirement oracle now begins with applied `sol-codex` and a
  manifest-owned broker, introduces preserved invalid user OpenCode bytes,
  applies the resulting partial preset, switches to `sol-only`, and proves
  broker deletion, manifest retirement, and exact user-byte preservation.

### Third-repair RED/GREEN evidence

- Initial RED command:
  `node --test --test-name-pattern="predeclares every recovery snapshot|cleans created parents|marks manifest-last success|does not orphan a broker" test/preset-fallback-security.test.js test/preset-fallback.test.js`
  passed only the corrected broker lifecycle and failed 3/4 because snapshot
  paths were null, readiness rejection did not expose/reap the worker, and no
  committed cleanup boundary existed.
- The corrected broker lifecycle was green immediately, showing that the
  actionable defect was the prior vacuous oracle rather than another product
  routing defect.
- First parent-death RED: the exact worker PID exited but the newly created
  empty `.codex/agents` directory remained because the harness terminated the
  worker in the apply parent's process group before EOF cleanup. After giving
  the worker an independently bounded process group and deadline, the unchanged
  directory-absence assertion and exact PID absence both passed.
- Focused snapshot-only SIGTERM recovery passed: the first snapshot may exist
  without any later journal update, planning fails closed, and the next apply
  restores/cleans from the predeclared path before reapplying.
- The committed-cleanup oracle reads the on-disk journal after the first
  snapshot deletion, observes `phase: committed`, injects an error, and proves
  recovery preserves applied `sol-codex` bytes while finishing cleanup.

### Exact-current verification

- `node --test test/preset-fallback-security.test.js` passed 14/14 in
  160.93 seconds.
- `node --test test/preset-fallback.test.js` passed 9/9 in 23.54 seconds.
- `node --test test/configuration.test.js test/presets.test.js test/create.test.js test/adopt.test.js test/upgrade-artifacts.test.js`
  passed 35/35 in 29.64 seconds.
- `npm.cmd run lint` passed repository self-check.
- `git diff --check` passed with only configured LF-to-CRLF notices.
- `node bin/workspace-template.js preset status . --json` reports `sol-only`,
  `active`, no overrides/errors, and fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- `python assets/scripts/validate_ticket_pack.py docs/tickets/conditional-spark-fallback --json`
  was attempted and failed command discovery. No `python`, `python3`, `py`, or
  bundled Python executable is accessible, and FBK-001 still has no authorized
  Node validator asset. No validator pass is claimed.
- L3/L4 and full-suite gates remain assigned to FBK-005 by the amended
  verification policy and were not run or claimed.

### Lifecycle, privacy, and topology census

- The repository has no preset journal, transaction directory, snapshot
  directory, or snapshot files.
- `.agent/leases/` contains only its tracked `.gitkeep`; nonbaseline/open lease
  count is zero.
- Ambient Windows CIM command-line process enumeration was denied, so no
  ambient worker census is claimed. The readiness-error and parent-death tests
  each retain the exact worker PID and assert `ESRCH` before completion.
- Missing-parent rollback proves the created managed directory is absent;
  parent-death cleanup proves an unaccepted created directory is absent; normal
  apply proves required managed parents are recreated.
- Locked `test/presets.test.js` remains 139 LOC and locked
  `test/adopt.test.js` remains 380 LOC.
- Focused tests remain below 700 LOC:
  `test/preset-fallback.test.js` 533 and
  `test/preset-fallback-security.test.js` 641.
- Touched production files remain below 600 LOC:
  `apply.js` 217, `transaction.js` 437, `mutation-session.js` 307, and
  `mutation-worker.js` 293.
- Repair base/HEAD remains
  `e841de2734bfb974523d239f860d7857961949e8`.
- Tracked diff identity before this evidence append:
  `cb5f8b99d68d6109e9a0c202bd7c9d800ce71571`.
- Current untracked SHA-256 identities before this evidence append:
  - `src/presets/transaction.js`:
    `2089506a013ca1c5d7a35805f6585bffc6e2f83230bb3e80bdcb42ad04500b26`
  - `src/presets/mutation-session.js`:
    `30fff2668b3127a6a856f4a53644c711630a7f4b32d679f366a26bd94f5d28f9`
  - `src/presets/mutation-worker.js`:
    `1f66c4664968801e0c858570c295c1bfedfefc86a6178619c490070c725d4a8c`
  - `test/preset-fallback.test.js`:
    `d4add50117852aa32a080a45b2c3b52c2907ff9e8f79bce7c6f2ae438ddc9a22`
  - `test/preset-fallback-security.test.js`:
    `2015ac5445d470119f9b69ea4efb95bc9b8001ce3702ebcd84d1e282244364f8`

This shared journal, filesystem, worker-lifecycle, and test-oracle repair
invalidates specification/authority, code/test, and operations/security review.
All three lenses must rerun independently against the final exact diff; no
third-review pass is claimed here.

## Fourth independent-review repair — 2026-07-26

### Authority and durable protocol

The authorized `fbk-001-fourth-independent-review-repair-2026-07-26`
amendment is the sole authority for this append. Product writes remain under
`src/presets/**`; regression writes remain in the two authorized focused test
files. No preset activation, OpenCode execution, commit, release, remote
mutation, or prior-evidence rewrite occurred.

- The metadata-only bootstrap journal moved to
  `.agentic/.preset-transaction.json`, outside the private recovery store.
  It contains paths, identities, hashes, and states only—never original or
  desired user bytes.
- When `.agentic/.preset-transactions` is absent, its worker creates the empty
  directory and waits. The parent writes the external journal with that exact
  created identity, sends an explicit `accept` message, and waits for the
  worker's exact-PID `accepted` acknowledgement. Only then may `.gitignore` or
  private recovery content be written.
- EOF before acceptance removes only identity-matching empty worker-created
  directories. EOF after acknowledgement leaves them in place because the
  journal now owns recovery. A sealed generator-created parent that is already
  absent compares as the original absent target and is treated as restored.
- Journal version 4 predeclares all transaction paths in its initial durable
  content:
  - journal update stage:
    `.agentic/.preset-transaction-<planId>.stage`
  - canonical snapshots:
    `.agentic/.preset-transactions/<planId>/snapshots/<index>.bin`
  - product stages beside each target:
    `.workspace-template-preset-<planId>-<index>.stage`
- Snapshot creation uses exclusive create, write, fsync, and directory sync
  directly at its declared canonical path. Product and journal updates use
  their deterministic transaction-unique declared stages, fsync the stage,
  recheck the supported target boundary, atomically rename, sync the parent,
  and verify the final target and stage absence. No random temporary filename
  remains in the preset mutation worker.
- Active and committed recovery first removes exact declared journal/product
  stages, including partial regular files. Snapshot cleanup likewise removes
  the exact declared canonical path even when a crash left partial bytes.
  Transaction-specific private directories are removed after rollback or
  committed cleanup; managed parents remain after commit.
- The prior committed-phase cleanup boundary, directory pinning, third-party
  target-drift preservation, applied-broker retirement lifecycle, and
  exclusive-workspace-writer threat model remain unchanged.

### Fourth-repair RED and crash evidence

- RED:
  `node --test --test-name-pattern="predeclares every recovery snapshot|cleans created parents" test/preset-fallback-security.test.js`
  failed both cases because the journal was still
  `.agentic/.preset-transactions/journal.json` and
  `acceptCreatedParents` returned no worker acknowledgement.
- GREEN at the same seams proves the external journal, deterministic declared
  stage/snapshot paths, and exact `{ type: "accepted", pid }` acknowledgement.
- A single table-driven public apply regression covers all five required
  failures:
  1. hard parent death after private-store parent creation but before journal:
     the unaccepted worker exits and removes the empty store;
  2. hard parent death after durable journal and acceptance but before
     `.gitignore`: the empty store remains journal-owned and recovery reapplies;
  3. worker hard exit after a partial canonical snapshot fsync;
  4. worker hard exit after a partial product-stage fsync and before rename;
  5. hard parent death after created-parent seal and worker acknowledgement but
     before the product command.
- Every case retains the exact worker PID and observes it absent before
  recovery. Reapply succeeds, the external journal is removed, and recursive
  inspection finds no transaction plan ID or declared `.stage` path.
- The crash table passed on its first run after the shared protocol repair; no
  separate staging-crash RED is claimed.

### Exact-current verification

- `node --test test/preset-fallback-security.test.js` passed 14/14 in
  197.28 seconds.
- `node --test test/preset-fallback.test.js` passed 9/9 in 24.13 seconds.
- `node --test test/configuration.test.js test/presets.test.js test/create.test.js test/adopt.test.js test/upgrade-artifacts.test.js`
  passed 35/35 in 29.87 seconds.
- `npm.cmd run lint` passed repository self-check.
- `git diff --check` passed with only configured LF-to-CRLF notices.
- `node bin/workspace-template.js preset status . --json` reports `sol-only`,
  `active`, no overrides/errors, and fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- A root-discovered uv-cache Python 3.14.5 interpreter ran:
  `python -B assets/scripts/validate_ticket_pack.py docs/tickets/conditional-spark-fallback --json`.
  It reports FBK-001 ready with empty `errors` and `warnings`.
- L3/L4 and full-suite gates remain assigned to FBK-005 by policy and were not
  run or claimed.

### Final lifecycle and topology census

- Repository external-journal presence: false.
- Repository private-store presence/file count: false/zero.
- Recursive declared-stage count: zero.
- Nonbaseline/open `.agent/leases/` count: zero.
- Ambient Windows CIM command-line enumeration remains sandbox-denied, so no
  ambient worker-process claim is made. All new hard-crash cases and the
  readiness-error case assert exact worker PID absence.
- Locked `test/presets.test.js` and `test/adopt.test.js` remain 139 and 380 LOC.
- Focused tests remain below 700 LOC:
  `test/preset-fallback.test.js` 533 and
  `test/preset-fallback-security.test.js` 684.
- Touched production files remain below 600 LOC:
  `apply.js` 242, `transaction.js` 458, `mutation-session.js` 314, and
  `mutation-worker.js` 349.
- Repair base/HEAD remains
  `e841de2734bfb974523d239f860d7857961949e8`.
- Tracked diff identity before this evidence append:
  `3c0683c6413361d90c223db804c15df813542f5e`.
- Current untracked SHA-256 identities before this evidence append:
  - `src/presets/transaction.js`:
    `2e45af9d5eb58db96217fe9ef77c0de78b31a3e69a7afeea3ec0ab25a62f2b1b`
  - `src/presets/mutation-session.js`:
    `29503d51159d2cf6ef316b6377bed8e5713d80928d324886a811871fa4e232e2`
  - `src/presets/mutation-worker.js`:
    `157f2bd8a876963d0fda15585d13d4515daf78e01fcf68be83b553675ce90514`
  - `test/preset-fallback.test.js`:
    `d4add50117852aa32a080a45b2c3b52c2907ff9e8f79bce7c6f2ae438ddc9a22`
  - `test/preset-fallback-security.test.js`:
    `820efd8fa42e469d61eb9e6a2c1efd36c0b85e889efc0730edc943b46f576a44`

This fourth repair changes the shared transaction authority, filesystem
protocol, worker lifecycle, and security oracle. Specification/authority,
code/test, and operations/security reviews must all rerun independently
against the final exact diff; no fourth-review pass is claimed here.

## Fifth independent-review repair — 2026-07-26

### Private staging and fixed bootstrap protocol

The authorized `fbk-001-fifth-independent-review-repair-2026-07-26`
amendment is the sole authority for this append. Writes remained inside the
amended FBK-001 product, focused-test, contract, and evidence paths. No preset
activation, OpenCode execution, commit, release, remote mutation, or rewrite
of prior evidence occurred.

- Journal version 5 predeclares one fixed, generator-reserved, metadata-only
  bootstrap stage at `.agentic/.preset-transaction.stage`. Every journal
  installation uses exclusive stage creation, stage fsync, parent-directory
  sync, atomic rename to `.agentic/.preset-transaction.json`, and a final
  parent sync. A collision fails closed.
- Planning and apply recovery remove only that exact fixed stage before
  reading the canonical journal. Empty, partial, or invalid-JSON stage bytes
  therefore need not be parsed and do not authorize cleanup of any sibling.
- The initial journal also predeclares
  `.agentic/.preset-transactions/.gitignore.stage`. The restricted private
  store worker installs `*\n` through that exclusive stage and atomic rename
  before any snapshot, desired, or restore bytes can be created.
- Snapshots, desired product stages, and rollback restore stages now live only
  below the self-ignored, access-restricted transaction plan directory:
  `snapshots/<index>.bin`, `stages/desired/<index>.bin`, and
  `stages/restore/<index>.bin`.
- A target-directory-pinned worker validates the private stage's regular-file
  identity and desired hash, compares the source device with the pinned target
  directory device, and atomically renames the private stage into the target.
  A device mismatch fails closed; there is no credential-bearing adjacent
  stage or copy fallback.
- Rollback writes original bytes to the separately predeclared private restore
  stage and uses the same pinned, same-device atomic installation path.
  Snapshot preservation and third-party drift checks remain unchanged.
- The created-private-parent identities are durably sealed in the journal
  before their worker receives `accept`. The exact post-seal/pre-accept hook
  proves that worker EOF removes only identity-matching empty parents.
  Recovery narrowly tolerates a journal-owned created parent that is already
  absent; replacements and non-empty directories still fail closed.

### RED, repair, and crash evidence

- The first RED changed the public journal inspection oracle to require the
  fixed bootstrap stage and private desired/restore declarations. It failed
  because version 4 still declared a transaction-specific external stage and
  target-adjacent product stages.
- After the private-stage and fixed-bootstrap implementation, the first full
  security run passed 13/14. The expanded crash table exposed one precise
  failure: post-seal/pre-accept recovery treated the already-removed private
  store as an `ENOENT` error. The repair added explicit allow-missing behavior
  only to journal-owned created-directory cleanup.
- The focused eight-stage crash loop then passed 1/1 in 74.79 seconds. It
  covers hard interruption after store creation, partial bootstrap-stage
  fsync, journal parent seal before worker accept, accepted bootstrap,
  partial ignore-marker fsync, partial private snapshot fsync, partial private
  desired-stage fsync, and managed-parent seal/accept. Every case reaps the
  exact worker PID, reapplies successfully, and leaves no declared stage or
  plan-ID path.
- The private-byte oracle observes both the original snapshot and desired
  product stage while live, confirms the desired stage and target parent are
  on the same device, confirms journal/report metadata contain no canary, and
  confirms neither `git status --untracked-files=all` nor the cached diff
  exposes private-store content.

### Exact-current affected verification

- `node --test test/preset-fallback-security.test.js` passed 14/14 in
  262.78 seconds.
- `node --test test/preset-fallback.test.js` passed 9/9 in 28.36 seconds.
- `node --test test/configuration.test.js test/presets.test.js test/create.test.js test/adopt.test.js test/upgrade-artifacts.test.js`
  passed 35/35 in 29.88 seconds.
- `npm.cmd run lint` passed repository self-check.
- `git diff --check` passed with only configured LF-to-CRLF notices.
- `node bin/workspace-template.js preset status . --json` reports `sol-only`,
  `active`, no overrides/errors, and fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- The root-discovered uv-cache Python 3.14.5 interpreter ran
  `assets/scripts/validate_ticket_pack.py` and reports FBK-001 ready with empty
  `errors` and `warnings`.
- Verification was limited to the affected FBK-001 landing gates. L3/L4 and
  the full repository suite remain assigned to FBK-005 and were not run or
  claimed.

### Final lifecycle, privacy, and topology census

- Repository canonical journal, fixed bootstrap stage, and private store are
  absent. Recursive declared-stage count is zero.
- `.agent/leases/` contains no nonbaseline/open lease. The accidentally
  short-timeout test process was terminated by its exact PID tree before
  verification resumed; all crash regressions independently assert exact
  worker PID absence.
- Locked `test/presets.test.js` and `test/adopt.test.js` remain 139 and 380
  LOC. Focused tests remain below 700 LOC:
  `test/preset-fallback.test.js` 533 and
  `test/preset-fallback-security.test.js` 698.
- Touched production files remain below 600 LOC: `apply.js` 249,
  `transaction.js` 526, `transaction-paths.js` 25,
  `mutation-session.js` 330, and `mutation-worker.js` 381.
- Repair base/HEAD remains
  `e841de2734bfb974523d239f860d7857961949e8`.
- Tracked product/contract/test diff identity before this evidence append:
  `86bddf4e7a48ea867a0e03f866ac4ac7cd06e854`.
- Current untracked SHA-256 identities before this evidence append:
  - `src/presets/transaction.js`:
    `59a9c266f5de2ae390655dc19e4a15338605cccc120683105fe2efaa72908448`
  - `src/presets/transaction-paths.js`:
    `a462575b94574dc2d4e048c61b8d0fb83ee08de136c74001b9693d33a873acf7`
  - `src/presets/mutation-session.js`:
    `cb8a655899a20aeb66ce1c8a23c157f66634a9334c63009fb80abb2ef93c6c45`
  - `src/presets/mutation-worker.js`:
    `883b89953c6abe6f09e928c8a46ebc41b9eea9a439444f712d6de4fba8095454`
  - `test/preset-fallback.test.js`:
    `d4add50117852aa32a080a45b2c3b52c2907ff9e8f79bce7c6f2ae438ddc9a22`
  - `test/preset-fallback-security.test.js`:
    `5baee23dec14fb4bfda8d4d8ed704776cc58c7d661c0ba7e10903c4f2a845543`

This fifth repair changes the transaction storage boundary, bootstrap
atomicity, worker move protocol, and crash oracle. Specification/authority,
code/test, and operations/security reviews must rerun independently against
the final exact diff; no fifth-review pass is claimed here.

## Sixth independent-review repair — 2026-07-26

### Bootstrap ownership and bounded process leases

The authorized `fbk-001-sixth-independent-review-repair-2026-07-26`
amendment is the sole authority for this append. No activation, OpenCode
execution, commit, release, remote mutation, or FBK-002 Job Object runner was
introduced.

- Build, apply preparation, and recovery no longer delete a fixed bootstrap
  stage when the canonical journal is absent. They preserve its exact bytes
  and fail closed with the manual recovery path
  `.agentic/.preset-transaction.stage`. Once the canonical journal exists,
  exact journal-declared stage cleanup remains automatic.
- The pre-journal hard-crash oracle proves the partial residue is metadata
  only, the original product is byte-identical, no private store or credential
  bytes exist, and the exact worker PID and lease are gone. Planning also
  preserves the residue. Exact manual unlink followed by reapply succeeds.
- Every preset mutation worker now creates an exclusive durable lease before
  readiness. Records contain run/ticket/agent identity, exact PID, scoped
  start identity, role, operation digest, cwd, start/deadline, and final state.
  Node exposes no dependency-free Windows process creation-time API, so the
  scoped identity is the owning `ChildProcess` handle plus an unguessable
  launch nonce; this limitation is recorded in every lease.
- Workers have a 15-second self-deadline and parents allow three seconds for
  worker-owned shutdown before exact-handle forced reaping. Normal completion,
  cancellation, protocol failure, timeout, and parent EOF durably finalize
  and remove the verified lease. No executable-name or broad process kill is
  used.
- The fixed Windows `icacls` invocation is an awaited child with its own exact
  PID/nonce lease and five-second deadline. It is reaped and its final lease is
  removed before worker readiness. Tests cover cancellation, parent death
  after readiness, and parent death during native setup; every recorded worker
  and native PID reaches `ESRCH`, every lease is absent, and created
  directories are removed.
- The focused fallback, security, and process suites now register every
  `mkdtemp` root, remove it in suite cleanup including hard-crash branches,
  and assert their exact prefix census equals the pre-suite baseline.

### RED/GREEN and exact-current verification

- RED: the pre-journal partial-stage regression received only worker exit 86
  because recovery deleted the residue. GREEN preserves the exact bytes,
  reports manual recovery, and reapplies only after explicit removal.
- `node --test test/preset-fallback-process.test.js` passed 4/4 in
  11.71 seconds.
- `node --test test/preset-fallback-security.test.js` passed 14/14 in
  294.60 seconds.
- `node --test test/preset-fallback.test.js` passed 9/9 in 31.06 seconds.
- `node --test test/configuration.test.js test/presets.test.js test/create.test.js test/adopt.test.js test/upgrade-artifacts.test.js`
  passed 35/35 in 29.00 seconds.
- `npm.cmd run lint` and `git diff --check` passed.
- Preset status remains `sol-only`, `active`, with no overrides/errors and
  fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- The uv-cache Python validator reports FBK-001 ready with empty errors and
  warnings. L3/L4 and the full suite remain assigned to FBK-005.

### Final census and topology

- Repository journal, bootstrap stage, private store, and declared-stage count
  are zero/absent. Nonbaseline/open `.agent/leases/` count is zero.
- Current-run fallback-core and process temp-prefix counts are zero. Every
  focused suite's before/after prefix assertion passed, proving a zero delta.
  Historical ambient fallback temp roots from earlier runs remain outside the
  repository; exact-prefix recursive deletion was policy-rejected as
  cross-run irreversible cleanup, was not retried, and no ambient-zero claim
  is made.
- Locked tests remain 139 and 380 LOC. Focused tests remain within 700 LOC:
  fallback 538, security 700, and process 231. Production modules remain
  within 600 LOC: apply 249, transaction 553, transaction-paths 25,
  process-lease 106, mutation-session 367, and mutation-worker 491.
- Repair base/HEAD remains
  `e841de2734bfb974523d239f860d7857961949e8`.
- Tracked product/contract/test diff identity before this append:
  `7047e124572b16ac9a51631aa6d037a9e7e81937`.
- Current untracked SHA-256 identities before this append:
  - `src/presets/process-lease.js`:
    `d2d3299327059b81129cb93cb60d3fe96c5511ea2dc119bdb935c07582b5075c`
  - `src/presets/transaction.js`:
    `8bb65ed6445a0d487d061503c35af6ad1bb34cf31c5a390d853c03e42ef1b09c`
  - `src/presets/mutation-session.js`:
    `0a12f9372dbdabf28531227041a4971cce6c77b4d6f70b760adb6994a8742bff`
  - `src/presets/mutation-worker.js`:
    `357adcb8681a6669321fd0d2b694f6daab41d5967213c473d3d2b6e6b048ff57`
  - `test/preset-fallback.test.js`:
    `d0a911fa9efd3b2affcd0cee0a0971188a51d7494789a31eb03df4a1c9f1110f`
  - `test/preset-fallback-security.test.js`:
    `b1924f7da2988ed03775e85776c74eed16088a95b20f10361eff72c809747b4e`
  - `test/preset-fallback-process.test.js`:
    `1b6c154759bb06ed8d5bfe2c62c2adebfa3e67ff1a0f886acb0ddf96f86612b7`

This sixth repair changes bootstrap recovery authority, worker/native process
ownership, and test-fixture lifecycle. All three independent review lenses
must rerun against the final exact diff; no sixth-review pass is claimed here.

## Seventh portability repair — 2026-07-26

This test/evidence-only repair makes the process lifecycle regression truthful
on Windows and POSIX without changing product behavior.

- Worker lease, exact PID reaping, cancellation, parent-death cleanup,
  bootstrap residue, lease absence, and temp-prefix cleanup assertions remain
  unconditional on every platform.
- The secure-directory test now asserts `preset-acl-child` spawn/final records
  and exact native PID reaping only when `process.platform === "win32"`.
  On POSIX it still exercises the worker lease/reap path and independently
  asserts that no native child callbacks occurred, matching the synchronous
  `chmod(0700)` implementation.
- The parent-death-during-native-setup regression is declared skipped with the
  explicit reason `icacls is Windows-only` on non-Windows before its body can
  spawn or wait for a nonexistent control event. No timer or process can be
  stranded by that branch.
- No injected platform override was added: falsifying `process.platform` would
  not exercise the real OS boundary. The POSIX callback expectation is
  represented directly in the platform-neutral worker lifecycle case; actual
  POSIX execution remains environment-dependent and is not claimed here.

Exact-current verification:

- `node --test test/preset-fallback-process.test.js` passed 4/4 with zero
  skips on Windows in 11.94 seconds.
- The affected L2 command passed 35/35 in 30.24 seconds.
- `npm.cmd run lint` and `git diff --check` passed.
- `test/preset-fallback-process.test.js` is 238 LOC with SHA-256
  `34f03831a68989961fbaaa5d3dbaeffa41b2e78f95e96202f57ae054ef076974`.
- Repository journal/bootstrap/private-store presence is false, open lease
  count is zero, and the process-suite temp-prefix count is zero.
- Fallback and security suites were not rerun because no product or shared
  helper changed; their exact sixth-repair results remain immutable evidence.

No activation, OpenCode execution, commit, release, or remote mutation
occurred. Independent review must evaluate the final exact diff; no seventh
review pass is claimed here.

## Final concurrency-isolation repair — 2026-07-26

This test/evidence-only repair removes peer-owned temporary directories from
the focused-suite cleanup oracle.

- Process, fallback, and security suites retain only the exact absolute roots
  returned by their own `mkdtemp` calls. Suite cleanup removes only those
  registered paths and independently asserts every one is `ENOENT`.
- No suite enumerates an ambient shared prefix, compares an ambient baseline,
  or reads/removes a peer reviewer's roots.
- Two independently spawned process-suite copies ran concurrently. Both
  passed 4/4 with durations 12.997 and 12.992 seconds. Their exact-root cleanup
  assertions therefore passed under overlapping execution.

Exact-current verification:

- Isolated process suite: 4/4 in 11.912 seconds.
- Fallback suite: 9/9 in 31.324 seconds.
- Security suite: 14/14 in 289.221 seconds.
- L2: 35/35 in 30.242 seconds.
- Lint, diff check, validator, and preset status passed; FBK-001 remains ready
  and the repository remains active on the unchanged `sol-only` fingerprint.
- Repository journal, bootstrap stage, and private store are absent; open
  lease count is zero. Every suite-run owned root is absent by its direct
  cleanup oracle; no ambient peer-root census is claimed.
- Test topology remains within budget:
  - process: 235 LOC,
    SHA-256 `d66df55c5d67569ba4a90b08cdbca5dbcfe061ec0d0eccd3fd0e5a87e2c1da45`
  - fallback: 538 LOC,
    SHA-256 `7885dd6bc7334e88fc79603fca20bd941daf69b7aabd5157170b779471cc82cf`
  - security: 700 LOC,
    SHA-256 `b902987f1670927a36e9dccb929877d5a89f25c752224826d9a858bfee148dfa`

No product file, activation, OpenCode execution, commit, release, or remote
state changed. Independent review must use the final exact diff; no review
pass is claimed here.

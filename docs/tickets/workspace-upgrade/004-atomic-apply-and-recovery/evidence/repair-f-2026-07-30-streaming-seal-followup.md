# Repair F — streaming seal follow-up

Date: 2026-07-30

## Authority and scope

This append-only repair reconciles the Agent CAD and Ultima review reports for
the streaming verification-input seal. It preserves the immutable upgrade
contracts:

- blocked dry-run plans return a nonzero exit code;
- Git-backed sealing fails closed when Git inventory is unavailable;
- managed drift remains blocking and is not auto-reconciled;
- Agent CAD retains its managed Codex/OpenCode projections;
- no downstream apply, publish, push, deploy, or release action is authorized.

## Repaired findings

1. Copy checkpoints now exclude generated directories at nested module
   boundaries, including Cargo `target/` and package-local `node_modules/`,
   while preserving authoritative paths such as `src/build/`.
2. A repository with a `.git` marker can no longer fall back to a weaker
   filesystem inventory when Git cannot run.
3. Sealing re-inventories after hashing. Apply revalidates the inventory,
   copies only that exact set, verifies the disposable copy's inventory and
   hash, and only then starts verification.
4. Managed-asset and skill enumeration reject Python bytecode/cache paths.
   Nested npm ignore rules keep those paths out of the tarball, and self-check
   fails if generated cache files are present under `assets/`.
5. Blocked dry-runs again set a failing process exit code. The Rust scalability
   acceptance test supplies the approval needed to produce an applicable plan.

## Repair loop evidence

Each behavior was reproduced as RED before its minimum repair:

- nested checkpoint output copied;
- `src/build/authority.json` omitted by non-Git sealing;
- Git-unavailable repositories silently fell back;
- post-inventory additions were omitted from the seal;
- late files could reach a disposable checkpoint before rejection;
- blocked dry-runs exited zero;
- managed and packed asset enumeration included `.pyc`/`__pycache__`.

One affected-suite repair cycle found that filtering live lease state also
removed the managed `.agent/leases/.gitkeep`. The filter was narrowed to retain
the sentinel and exclude only runtime lease records. The first full gate then
found an old test constructing a fake `.git` directory; the test now uses a
real Git repository and explicitly ignores its external junction, preserving
the fail-closed production rule.

## Verification

- Affected gate: 59 passed, 1 Windows-inapplicable skip.
- Architecture budget audit: passed with no violations.
- `npm run check`: 239 passed, 1 platform skip, 0 failures.
- `npm run pack:check`: passed; 314 packed entries and no Python cache paths.
- `npm run test:packed`: passed all 13 packed-consumer checks.
- `git diff --check`: passed.
- Final asset cache count: zero.
- Final open process-lease count: zero.

## Downstream acceptance

- Ultima dry-run: 6.668 seconds, 903,381 output bytes, exit 1,
  `canApply: false`. The only conflicts are the two pre-existing managed-drift
  guards for `.agentic/scripts/validate_ticket_pack.py` and
  `.agentic/policies/verification.yaml`.
- Agent CAD dry-run: 4.056 seconds, 598,726 output bytes, exit 0,
  `canApply: true`, 41 operations, no conflicts.
- Both downstream worktrees remained clean.
- No downstream upgrade was applied.

## Review lenses

- Spec/authority: PASS — all five reported behaviors are repaired without
  weakening approvals, drift guards, projection ownership, or apply authority.
- Code/test: PASS — regressions use public seams; new production and test files
  remain inside architecture budgets; the budget audit reports no violations.
- Operations/security: PASS — Git failure, inventory churn, checkpoint
  mismatch, and late-file races fail closed before verifier execution; managed
  commands end with zero open leases.

## Repair G - tracked-deletion correction

The unconditional Repair F PASS and its 59/239/314 verification figures above
are superseded by this section. Post-fix review found that an authorized dirty
Git workspace with a deleted tracked file produced an applicable plan but was
rejected during disposable-copy inventory validation.

### Root cause and repair

Git inventory deliberately retains deleted tracked paths so the seal hashes
them as `missing`. A filesystem copy cannot enumerate a path that does not
exist, so comparing its physical inventory with the complete Git inventory
rejected a faithful checkpoint.

Apply now derives a root-bound, physically existing subset immediately before
copying and compares the disposable copy with that subset. It still hashes the
checkpoint against the complete sealed Git inventory, preserving the `missing`
record for deleted tracked paths. Exact copy-inventory validation, unexpected
path rejection, source re-sealing, and checkpoint-hash validation remain in
place.

### RED/GREEN evidence

- RED: the new public apply regression produced `canApply: true`, then failed
  with `Disposable verification copy does not match the sealed
  verification-input inventory`.
- GREEN: the same authorized dirty plan completed both disposable verification
  passes; the deleted tracked `README.md` remained absent in each checkpoint
  and in the source workspace.
- Focused apply suite: 13 passed.
- Neighboring checkpoint and apply-rejection suites: 10 passed.
- Affected gate: 73 tests, 72 passed, 1 platform skip.

### Fresh landing evidence

- `npm run check`: self-check passed; 241 tests, 240 passed, 1 platform skip,
  0 failures.
- Packed inventory: 315 entries; zero `__pycache__`, `.pyc`, or `.pyo` paths.
- `npm run test:packed`: all 13 packed-consumer checks passed.
- Architecture-budget audit: 0 violations. The touched apply test remains
  below the configured warning threshold.
- All Python-managed commands ran through `uv`.

### Reconciled verdict

- Spec/authority: PASS - the complete Git inventory remains the hashing
  authority, including explicit missing records.
- Code/test: PASS - the regression exercises the public apply seam with
  `--allow-dirty`; copy-inventory and hash checks remain independently active.
- Operations/security: PASS - unexpected copied paths, source/copy races,
  verifier-input drift, and checkpoint hash mismatches still fail closed.
- Downstream status remains as established by the post-fix reviews: Agent CAD
  is applicable with 41 effective operations and no conflicts; Ultima remains
  blocked only by its two known managed-drift guards. No downstream upgrade
  was applied by this repair.

## Repair H - gitlink and literal-path correction

Repair G's full-gate count and the later 240/239/1 review count are historical
and are superseded by the exact-worktree results below. This repair addresses
the two remaining cross-platform inventory boundaries.

### Repaired findings

1. `existingVerificationInputPaths()` now deduplicates and sorts sealed
   inventory strings without converting `\` to `/`. User-supplied exclusion
   paths remain normalized separately. A POSIX Git filename containing a
   literal backslash therefore remains distinct from the slash-separated path
   beside it.
2. Git inventory now reads `git ls-files --stage -z` and identifies mode
   `160000` gitlinks. Because the current seal neither binds the gitlink commit
   nor reproduces a submodule checkout, planning emits an explicit blocking
   conflict for every tracked submodule. It no longer produces an applicable
   plan that can only fail during checkpoint validation.

### RED/GREEN evidence

- Submodule RED: a clean workspace with a tracked local submodule produced
  `canApply: true`.
- Submodule GREEN: the same public planning seam produces `canApply: false`
  with `Git submodule verification input 'vendor/local-submodule' cannot be
  sealed`.
- The POSIX public apply regression creates both `a/b` and literal `a\b`,
  verifies both disposable copies, and is skipped only on Windows. Ultima's
  POSIX review supplied the failing reproduction; this Windows verification
  host records the test as platform-inapplicable.
- Focused plan/seal/apply/rejection gate: 45 tests, 43 passed, 2 POSIX-only
  skips.
- Affected gate: 75 tests, 73 passed, 2 POSIX-only skips.

### Fresh landing evidence

- `npm run check`: self-check passed; 243 tests, 241 passed, 2 skipped,
  0 failed.
- The two Repair H boundary cases account for the increase from the preceding
  local 241-test gate.
- Packed inventory: 315 entries; zero `__pycache__`, `.pyc`, or `.pyo` paths.
- `npm run test:packed`: all 13 packed-consumer scenarios passed.
- Architecture-budget audit: 0 violations; the new boundary-focused test
  module is 109 LOC and no existing near-warning test file grew.
- Every Python-backed command ran through `uv`.

### Reconciled verdict

- Spec/authority: PASS - unsupported gitlinks block during planning; no
  unsealed submodule directory is represented as applicable authority.
- Code/test: PASS - literal Git inventory strings and normalized user inputs
  now have separate paths through the code, with public planning/apply
  regressions.
- Operations/security: PASS - Git inventory remains NUL-delimited, submodule
  detection is based on index mode rather than filesystem shape, and
  checkpoint inventory/hash validation remains enabled.
- The latest downstream review evidence remains Agent CAD ready with 41
  effective operations and no conflicts, while Ultima is blocked only by its
  two known managed-drift guards. Repair H did not apply or mutate either
  downstream workspace.

## Repair I - embedded Git repository correction

Repair H's 243/241/2 full-gate figure is superseded by the exact-worktree
result below. Agent CAD's later 255/253/2 snapshot was not reproduced by the
same `npm run check` command in this checkout.

### Root cause and repair

For an untracked embedded Git repository, `git ls-files --others
--exclude-standard -z` emits a directory marker such as `vendor/nested/`.
Inventory normalization removed the trailing slash before its special meaning
was recorded, leaving a directory-shaped verification input that could not be
reproduced by the disposable checkpoint inventory.

The NUL-delimited reader now captures raw trailing-slash markers separately
before normalizing their display paths. Non-ignored markers are exposed as
unsupported embedded repositories, and planning emits a blocking conflict.
Tracked mode-`160000` gitlinks continue to use their separate staged-index
classification. Neither case can produce an applicable plan under authority
the seal cannot reproduce.

### RED/GREEN evidence

- RED: a clean workspace plus an explicitly authorized dirty, untracked nested
  Git repository produced `canApply: true`.
- GREEN: the same public planning seam produces `canApply: false` with
  `Embedded Git repository verification input 'vendor/nested' cannot be
  sealed`.
- Focused plan/seal/apply/rejection gate: 43 tests, 41 passed, 2 POSIX-only
  skips.

### Fresh landing evidence

- `npm run check`: self-check passed; 244 tests, 242 passed, 2 skipped,
  0 failed.
- The Repair I embedded-repository regression accounts for the increase from
  the preceding local 243-test gate.
- `npm run test:packed`: all 13 packed-consumer scenarios passed.
- Architecture-budget audit: 0 violations; the boundary-focused test module
  remains below 150 LOC.
- Every Python-backed command ran through `uv`.

### Reconciled verdict

- Spec/authority: PASS - both tracked gitlinks and untracked embedded
  repositories block during planning instead of failing after applicability.
- Code/test: PASS - the public regression distinguishes explicit dirty-tree
  approval from unsupported verification authority.
- Operations/security: PASS - raw Git markers are classified before
  normalization, ignored workspace-state paths remain excluded, and existing
  inventory/hash validation is unchanged.
- Ultima's latest review is green. Agent CAD requires only re-review of this
  repaired boundary. Repair I did not apply or mutate either downstream
  workspace.

## Repair J - isolated verification authority and failure evidence

Agent CAD's first real 0.6.1 apply attempt stopped before product mutation and
produced the downstream failure report at
`docs/agent/evidence/workspace-template-0.6.1-upgrade-failure-report.md`.
The report's three claims were reproduced at their public seams:

1. scratch-profile construction discarded ambient Rustup/Cargo homes;
2. pre-mutation verification threw a module summary without persisting the
   bounded command evidence already present in the verifier report; and
3. the add-on declared `uv run ruff check .` without declaring Ruff.

### Root cause and repair

- Upgrade verification now builds its scratch environment through one exported
  policy function. `CARGO_HOME`, `RUSTUP_HOME`, and `RUSTUP_TOOLCHAIN` are
  removed by default and restored from the original profile only when the
  reviewed plan sealed network/external-toolchain authority. Verification
  sanitization admits those three non-secret authority variables while
  retaining the existing secret-key rejection.
- Failed pre-mutation verification now writes the durable upgrade report before
  rethrowing. It contains exact argv/cwd, status, timeout, bounded/redacted
  output, dependency blocking, Git/dependency-install evidence, and the owned
  process receipt. The CLI error includes the first failing command plus a
  bounded stderr/reason excerpt. No managed/product operation has run at this
  point.
- Planning now fails closed for known `uv run` verification tools that are
  absent from `[project].dependencies` and the default
  `[dependency-groups].dev`.
- Agent CAD's add-on now declares `ruff>=0.8`, locks it with `uv`, and owns an
  explicit Python 3.11 Ruff policy. The explicit rule selection prevents the
  command from inheriting unrelated user-level Ruff configuration.

### RED/GREEN evidence

- Rust authority RED: the scratch environment had no supported Rust authority
  export. A second RED proved ambient Rust variables leaked when authority was
  not sealed.
- Rust authority GREEN: authorized plans retain the original Cargo/Rustup
  homes and toolchain; unauthorized plans expose none of those variables.
- Failure-evidence RED: apply returned only
  `Full workspace verification failed: repo: failed` and no durable actionable
  failure report.
- Failure-evidence GREEN: the report records the exact failed command,
  disposable cwd, exit/timeout state, bounded stderr, and zero-descendant
  receipt; the error includes `Failed to spawn: ruff`; managed bytes remain
  unchanged.
- Dependency-contract RED: an add-on manifest with pytest only did not report
  its missing Ruff command authority.
- Dependency-contract GREEN: planning emits the precise blocking conflict.
  The corrected real Agent CAD manifest removes that conflict.
- A full-gate RED also found an older synthetic Python-worker fixture whose
  `uv run pytest` contract omitted pytest. The fixture now declares its
  dependency, and its artifact-reconciliation suite is 7/7 green.

### Fresh landing evidence

- Affected suite: 63 tests, 62 passed, 1 platform skip, 0 failed.
- `npm run check`: self-check passed; 248 tests, 246 passed, 2 platform
  skips, 0 failed.
- Packed inventory: 315 entries; zero Python cache artifacts.
- `npm run test:packed`: all 13 packed-consumer scenarios passed.
- Architecture-budget audit: 0 violations.
- Agent CAD add-on: `uv run ruff check .` passed; `uv run pytest` reported
  295 passed and 1 skipped under an isolated task-owned temp profile.
- Final real Agent CAD dry-run: exit 0, `canApply: true`, 41 effective
  operations, no conflicts.
- Agent CAD doctor: clean; Codex and OpenCode projections synchronized.
- Every Python-backed command ran through `uv`.

### Reconciled verdict

- Spec/authority: PASS - external Rust authority is conditional and sealed;
  missing Python verification tools block at planning.
- Code/test: PASS - the public environment, apply/report, planner, and real
  downstream seams all have fresh regression evidence.
- Operations/security: PASS - command evidence remains bounded/redacted, the
  failure report precedes product mutation, and owned verification commands
  finish with no descendants.
- The upgrade itself was not applied. Agent CAD is ready for an exact-plan
  re-review/apply after these workspace-template and add-on manifest changes
  are landed.

## Repair K - version-independent and commit-bound downstream verification

Agent CAD's next exact-plan apply again stopped before mutation. The actionable
report proved two repository verification contracts were not portable to the
sealed disposable checkpoint: one Python test depended on Python 3.14's
Windows FIFO behavior, and two Cargo integration tests treated the intentionally
dirty synthetic checkpoint as Ticket 002's locked candidate.

### Root cause and repair

- The Python test now controls `Path.is_file()` at the executable classifier
  seam. The same expectation passes under uv-managed CPython 3.12.13 and
  3.14.5 without changing the declared `requires-python = ">=3.11"` support.
- `ac-dev` accepts and strictly validates `AC_DEV_REPOSITORY_ROOT`. Its public
  Ticket 002 integration tests create a pristine checkout of the locked
  evidence commit, retain the locked candidate identity, and execute against
  that checkout instead of the unrelated dirty upgrade checkpoint.
- Windows executable discovery combines duplicate `PATH`/`Path` values before
  probing, preserving uv discovery in the sanitized verifier environment.
- The packed dirty-polyglot scenario now runs the real uv Python 3.14 and Cargo
  commands through the complete pre- and post-mutation `--apply-plan`
  transaction. It asserts sealed dirty bytes, a clean synthetic Git checkpoint,
  and a checkpoint commit distinct from the dirty source repository.

### Fresh landing evidence

- Worker focused seam: passed under uv-managed CPython 3.12.13 and 3.14.5.
- Worker full CPython 3.14.5 gate: 699 passed, 23 skipped.
- `ac-dev`: 35 unit and 3 public integration tests passed.
- `npm run check`: self-check passed; 261 tests, 259 passed, 2 platform
  skips, 0 failed.
- `npm run test:packed`: all 14 scenarios passed with real uv/Cargo execution.
- Packed inventory: 316 entries; zero Python cache artifacts.
- Architecture audits: zero violations in workspace-template and Agent CAD.
- Fresh Agent CAD plan `ae542e5bd01da82f0d099bdac1a6ba39`: 41 effective
  updates, 357 no-ops, no warnings or conflicts.
- Agent CAD doctor: clean; Codex and OpenCode projections synchronized.
- Every Python-backed command ran through `uv`.

### Reconciled verdict

- Spec/authority: PASS - the Python support claim and locked Ticket 002 commit
  identities remain authoritative in a dirty sealed checkpoint.
- Code/test: PASS - focused, full downstream, packed real-tool, and complete
  upstream gates pass against the exact repaired diff.
- Operations/security: PASS - repository-root override validation fails closed,
  checkpoint Git cleanliness is asserted, and process receipts report zero
  descendants.
- No downstream upgrade was applied. Agent CAD remains at generator version
  0.6.0 with a fresh applicable plan ready for review.

## Repair L - bounded downstream checkout and deterministic handoff clock

The next real Agent CAD apply remained atomic and stopped before mutation. Its
receipt exposed a Windows path-length failure in `ac-dev`'s nested pristine
checkout and one load-sensitive MCP ownership-handoff test.

### Root cause and repair

- `ac-dev` inherited the verifier's already long redirected `TEMP`, then added
  its own clone and Cargo target paths. The public Ticket 002 checks now place
  their temporary clone under the repository-local ignored
  `tools/ac-dev/target/pristine-checkouts` root, bounding Git and native-tool
  paths without changing the locked candidate/evidence identities.
- The MCP test used a real 100 ms age deadline while ownership publication and
  queued admission raced under full-suite load. It now uses the existing
  controllable lifecycle clock and advances only after explicit dispatched-hang
  and queue-depth barriers. Production locking behavior is unchanged, and the
  locked test megafile shrank by one line.

### Fresh landing evidence

- `ac-dev` focused Windows long-path regression: passed with a 128-character
  redirected temporary root; full gate: 35 unit and 3 public integration tests
  passed.
- MCP focused handoff: 7 passes including 6 consecutive managed stress runs;
  lint passed; full gate: 23 files, 603 passed, 7 skipped, 0 failed.
- A disposable exact dirty Agent CAD clone completed the entire pre-mutation,
  mutation, and post-mutation `--apply-plan` transaction for plan
  `e33b5c2473a2e200f81409abef3ffcf5` (digest
  `e33b5c2473a2e200f81409abef3ffcf5bb6fb6c41b1a85e9986c6c7ba753984c`).
  It applied 41 managed updates with 357 no-ops, no warnings, and no conflicts.
- Both disposable verification cycles passed the worker (699 passed, 23
  skipped), add-on (295 passed, 1 skipped), MCP (603 passed, 7 skipped),
  `ac-dev` format/check/test, and 92-test root aggregate gates. The clone's
  generator advanced to 0.6.1 and doctor returned clean.
- `npm run check`: self-check passed; 261 tests, 259 passed, 2 platform skips,
  0 failed.
- `npm run test:packed`: all 14 scenarios passed. Packed inventory: 316 entries
  and zero Python cache artifacts.
- Agent CAD architecture-budget audit: 0 violations.
- Every Python-backed command ran through `uv`; every managed command receipt
  reports a closed lease and zero descendants.

### Reconciled verdict

- Spec/authority: PASS - locked Ticket 002 history and ownership-publication
  ordering remain authoritative.
- Code/test: PASS - focused, repeated, full-module, packed, full upstream, and
  exact dirty pre/post apply evidence pass against the repaired diff.
- Operations/security: PASS - paths remain inside an ignored disposable target,
  the real downstream worktree was not mutated, and all Job Objects closed with
  zero descendants.
- Agent CAD itself remains at generator version 0.6.0 pending explicit apply
  authority.

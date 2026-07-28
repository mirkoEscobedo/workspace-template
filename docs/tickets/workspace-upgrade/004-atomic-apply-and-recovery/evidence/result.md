# UPG-004 Result

- Apply revalidates plan integrity, repository/file/catalog/command authority,
  symlink containment, transaction quiescence, and leases before mutation.
- The complete proposed tree passes staged doctor before the target write set
  is backed up and applied with identity/manifest files last.
- Pre/post verification uses the sealed module and root aggregate commands.
  Verification-created files, directories, and symlinks are detected and
  restored; owned descendants are closed/audited and quiescence is rechecked.
- Journal/backup bindings support interrupted recovery; any apply or
  verification failure restores exact prestate.
- Focused coverage: `test/upgrade-apply.test.js`.

## Baseline repair

- Non-JSON bare and saved-plan CLI completion now prints the upgrade report
  instead of passing it to the plan renderer.
- Stale, replayed, and integrity-tampered plans are rejected before persistent
  workspace writes; focused coverage snapshots the complete target workspace.
- RED: `npm.cmd run test -- test/upgrade-cli.test.js` failed 2/2 with
  `Cannot read properties of undefined (reading 'length')`.
- RED: `npm.cmd run test -- test/upgrade-apply-rejection.test.js` failed because
  stale rejection left `.agentic/transactions/<plan-id>/`.
- GREEN: see the final repair verification block in UPG-006 evidence.

## Baseline operations/security repair B

- The default verification runner now owns the complete native process tree:
  a dedicated POSIX process group or a fail-closed Windows Job Object with
  kill-on-close. Timeout, AbortSignal interruption, ordinary failure, and
  handled `SIGINT`/`SIGTERM` close descendants before the lease is finalized
  and removed. Abrupt `SIGKILL`, `TerminateProcess`, or crash does not provide
  synchronous cleanup; retained transaction and lease recovery applies.
- Verification leases contain run, ticket, plan, phase, and step IDs; PID and
  operating-system start identity; command digest; deadline; platform ownership
  state; and final zero-descendant evidence. They contain no raw environment or
  command arguments.
- Default verification uses an allowlisted environment, rejects dependency,
  remote Git, publish, and deploy effects, and seals verification manifest
  hashes so apply-time changes fail before transaction writes.
- Captured evidence is structured, common credentials and bearer values are
  redacted before truncation, and stdout/stderr are bounded by UTF-8 bytes.
- Upgrade mutex v2 binds PID, process start identity, random token, and plan ID.
  It reclaims only absent or identity-mismatched owners, fails closed when a
  live identity is unresolved, and release cannot unlink a replacement owner.
- Verification rollback removes retyped ancestors before descendants, so a
  verifier-created symlink or junction is never followed. Deleted and retyped
  repository paths restore exactly. Snapshot or cleanup faults still run the
  rollback finalizer; a cleanup fault retains and names the durable
  repository-local recovery backup.
- Atomic rollback is intentionally limited to the repository-local managed
  filesystem boundary. Network, remote Git, dependency installation, publish,
  deploy, and other external effects are forbidden, not claimed reversible.

### RED/GREEN evidence

- RED: `npm.cmd run test -- test/process-utils.test.js` failed 1/1 because
  command capture counted characters rather than UTF-8 bytes and exposed the
  canary.
- RED: `npm.cmd run test -- test/upgrade-lock.test.js` failed 1/1 because the
  mutex-v2 public seam did not exist.
- RED: the process ownership test failed because
  `UpgradeVerificationRunner` did not exist.
- RED: the directory-to-junction rollback test deleted the external target's
  nested canary file, proving cleanup followed the replacement link.
- RED: the persisted-evidence test found the verifier canary after byte
  truncation removed its `token=` prefix before redaction.
- GREEN:
  `npm.cmd run test -- test/process-utils.test.js test/upgrade-lock.test.js test/upgrade-apply.test.js`
  passed 16 tests, 0 failed, in 27.37 seconds.
- GREEN: `npm.cmd run lint` passed repository self-check. Python was
  unavailable, so bundled Python scripts received import inspection but not
  syntax parsing.
- Operational note: one earlier process-test run observed an unexpected
  uppercase temporary lease companion and stopped without retry or mutation,
  as required. The coordinator-authorized isolated retry was clean; the only
  failure was a test assertion typo, and the corrected isolated suite passed
  3/3 before the final combined run.

## Baseline repair C — reopened 2026-07-26

- Authority: current user-authorized repair amendment
  `baseline-repair-c-2026-07-26`.
- Status: active; earlier result and repair sections remain immutable historical
  evidence and are not sufficient for the repaired diff.
- RED/GREEN evidence: _append exact focused commands and results after repair_.
- Operations/security review: _coordinator to append against the final diff_.
- Code/test review: _coordinator to append against the final diff_.
- Spec/authority review: _coordinator to append against the final diff_.
- Final focused/lint/diff/zero-lease gates: _coordinator to append; not yet
  claimed_.

### Repair implementation report

- Ownership/identity manifests follow payload writes. The mutex uses atomic
  directory-owner release/reclaim claims, and replacement-race tests prove a
  replacement survives while a third acquirer remains blocked.
- Payload launch waits for native ownership, exact process identity, and a
  durable lease. Registration failure leaves the payload sentinel absent.
- Windows measures Job Object membership and exact start identities. POSIX now
  measures process-group PID/start identities through `/proc` or `ps`.
- CLI `SIGINT`/`SIGTERM` waits for cleanup, lease finalization, and mutex release
  before exit. No clean `SIGKILL` or unhandleable parent-death guarantee is
  made; this supersedes broader historical repair-B wording without changing
  that historical record.
- Full verification runs only in disposable copies. Local inputs and commands
  are sealed, operations cannot touch verification manifests, and changed
  inputs fail before product writes. The public verifier injection was removed.
- `--allow-network` seals the existing `approvals.network` authority because
  portable external filesystem/network denial is unavailable. External effects
  remain outside the repository-local rollback promise.
- Routing distinguishes active `sol-only` (GPT-5.6 Sol/high for all roles) from
  historical `sol-codex` (GPT-5.3 Codex/high delegated roles). Future generated
  routing work remains out of scope.

### Repair RED/GREEN evidence

- RED: start-barrier injection allowed payload execution after identity/lease
  registration failure.
- RED: the original mutex was a replaceable file and replacement races were not
  protocol-safe.
- RED: the first affected combined run passed 41/45. Two process failures
  exposed pre-barrier timeout accounting/missing Windows Job evidence under
  contention; two apply failures exposed operational lease/plan paths in the
  verification-input seal.
- GREEN:
  `npm.cmd run test -- test/process-utils.test.js test/upgrade-lock.test.js test/upgrade-plan.test.js test/upgrade-apply.test.js test/upgrade-apply-rejection.test.js test/upgrade-artifacts.test.js test/upgrade-compatibility.test.js test/upgrade-skills.test.js test/upgrade-cli.test.js`
  passed 45 tests, 0 failed, in 43.30 seconds.
- GREEN:
  `npm.cmd run test -- --test-name-pattern="infers sol-codex" test/adopt.test.js`
  passed 1 test, 0 failed, in 2.27 seconds.
- GREEN after the POSIX measurement implementation:
  `npm.cmd run test -- test/process-utils.test.js` passed 4 tests, 0 failed, in
  6.19 seconds on Windows. This proves the Windows Job path and source
  syntax/imports; POSIX runtime evidence is unavailable and is not claimed.
- GREEN: `npm.cmd run lint` passed before this report append. The coordinator
  must append final post-report lint, doctor, diff, zero-lease, and independent
  review results. Full and packed gates have not run.

## Baseline repair D â€” active 2026-07-26

- Dependency-backed JavaScript/TypeScript verification now fails closed at
  planning when a verified manifest declares dependencies, devDependencies,
  optionalDependencies, or peerDependencies, or a sealed script explicitly
  names `node_modules/.bin`. The isolated copy never receives source
  `node_modules`; dependency-capable checkpoints remain unsupported.
- Repair C's POSIX measured-containment wording is superseded for the repaired
  diff. A POSIX process group cannot contain `setsid`/detached descendants, so
  upgrade plans and the UPG runner now fail before payload or lease creation on
  non-Windows. Generic process-group helpers claim only same-group cleanup.
  Windows retains native Job Object ownership.
- Windows `SIGINT`/`SIGTERM` subprocess evidence uses IPC plus
  `process.emit` to simulate delivery into the public signal bridge; it is not
  evidence of Windows OS signal delivery. These detached-verifier cases are
  Windows-only while POSIX upgrade verification remains fail-closed. The
  separate POSIX capability test proves failure before payload or lease
  creation; it does not claim POSIX signal cleanup.
- Streaming capture keeps bounded raw overlap for the longest known sensitive
  value, redacts before the final UTF-8 byte bound, and conservatively redacts a
  leading partial token after raw-prefix discard.
- CLI help and public docs describe sealed `--allow-network` authority and the
  dependency/POSIX limitations. The user-guide routing line is restored
  to GPT-5.3-Codex/high.

### Repair D RED/GREEN evidence

- RED: dependency-backed/local-bin plan remained applicable and could reach
  apply.
- RED: injected POSIX runner capability executed the sentinel and created its
  lease path; the plan capability seam was absent.
- RED: deterministic split-secret buffer seam was absent. The earlier
  subprocess-only attempt was discarded as nondeterministic because pipe
  coalescing already produced whole-value redaction.
- RED: CLI help omitted upgrade `--allow-network` and its sealed authority.
- GREEN focused: dependency-backed and dependency-free plan cases passed 2/2;
  plan/runtime POSIX capability cases passed 2/2; streaming redaction cases
  passed 3/3; CLI help passed 1/1.
- RED affected combined:
  `npm.cmd run test -- test/process-utils.test.js test/upgrade-lock.test.js test/upgrade-plan.test.js test/upgrade-apply.test.js test/upgrade-apply-rejection.test.js test/upgrade-artifacts.test.js test/upgrade-compatibility.test.js test/upgrade-skills.test.js test/upgrade-cli.test.js test/args.test.js test/adopt.test.js test/create.test.js`
  passed 84/85. The sole failure was bounded Windows Job startup exceeding the
  prior 5-second registration wait under parallel load; there was no payload,
  lease escape, or AV symptom.
- GREEN: the runner's native-ownership registration timeout is now
  independently configurable with a 15-second default; payload runtime timeout
  still starts only after ownership, identity, and durable lease registration.
  The isolated process suite passed 7/7.
- GREEN affected combined: the same 12-file command passed 85/85, 0 failed, in
  52.20 seconds.
- Final lint/doctor/diff/topology/lease/mutex and independent review gates:
  _coordinator to append; not yet claimed_. Full and packed gates have not run.

### Repair D final local verification

- `npm.cmd run lint`: passed repository self-check. Python remains unavailable,
  so bundled Python received import inspection rather than syntax execution.
- Doctor: `ok: true`, 0 errors, 0 warnings.
- `git diff --check`: passed; only configured LF-to-CRLF notices were emitted.
- Architecture inspection: locked `test/adopt.test.js` is 380 LOC.
  `test/args.test.js` 212, `test/process-utils.test.js` 216,
  `test/upgrade-plan.test.js` 136, `test/upgrade-cli.test.js` 159;
  `src/process-utils.js` 718, `src/workspace/verify.js` 251,
  `src/upgrade/plan.js` 253, and `src/cli.js` 443. Production files remain
  below the 800-LOC warning threshold; test files remain below 500.
- Completion audit: zero nonbaseline workspace leases and zero upgrade mutex
  owner entries.
- UPG-004 remains active and UPG-006 blocked. Independent review and
  coordinator-owned full/packed landing gates remain pending and are not
  claimed.

## Baseline repair E — evidence and test-topology reconciliation

- Authority: user-authorized amendment `baseline-repair-e-2026-07-26`; no
  product code was changed. Repair D remains the current implementation repair,
  and repair C is historical evidence only.
- The live frontier surfaces now record active UPG-004, blocked UPG-006, repair
  D's exact completed local evidence, and the pending full, packed, and three
  independent review gates. The managed hash for `CURRENT_FRONTIER.json` was
  refreshed.
- Descendant-cleanup evidence is limited to handled `SIGINT`/`SIGTERM`,
  AbortSignal, timeout, and ordinary failure. Abrupt `SIGKILL`,
  `TerminateProcess`, or crash relies on retained transaction and lease
  recovery rather than synchronous cleanup.
- Detached-verifier signal tests are Windows-only IPC/`process.emit`
  simulations and do not claim Windows OS signal delivery. POSIX coverage is
  the separate fail-closed test proving no payload and no lease when native
  ownership is unavailable.
- Focused:
  `npm.cmd run test -- test/upgrade-cli.test.js test/process-utils.test.js`
  passed 11 tests, 0 failed, 0 skipped, in 24.66 seconds.
- Doctor via `node bin/workspace-template.js doctor . --json`: `ok: true`, 0
  errors, 0 warnings.
- `git diff --check`: passed with configured LF-to-CRLF notices only.
  `test/upgrade-cli.test.js` is 157 LOC.
- Completion audit: zero nonbaseline workspace leases and zero upgrade mutex
  owner entries. No antivirus anomaly was observed.
- UPG-004 remains active and UPG-006 blocked. Full verification, packed
  verification, and independent spec-authority, code-test, and
  operations-security reviews remain pending and are not claimed.

## Final landing evidence — 2026-07-26

The pending statements above are preserved as chronological evidence and are
superseded by this final block.

- Independent specification/authority review: pass.
- Independent code/test review: pass.
- Independent operations/security review: pass.
- `npm run check`: pass; self-check passed and 156 tests passed with 0 failed.
- `npm run pack:check`: pass against the final package contents.
- `npm run test:packed`: pass under the native-owned runner.
- Windows native ownership: exact Job member identities were measured and
  absent after close; zero-descendant evidence passed.
- Doctor: 0 errors, 0 warnings.
- Ticket-pack validation after closure: 0 errors.
- Architecture-budget validation: 0 violations; locked LOC remains
  380/139/123.
- `git diff --check`: pass.
- Final cleanup: zero nonbaseline leases, zero mutex owners, no retained
  tarball, and no retained packed-smoke sandbox.
- Status: UPG-004 closed. POSIX and dependency-backed upgrade verification
  remain intentionally fail-closed without the required native process owner.

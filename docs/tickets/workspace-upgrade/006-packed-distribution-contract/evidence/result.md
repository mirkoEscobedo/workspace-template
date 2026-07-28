# UPG-006 Result

- `npm run check`: 128 tests passed, 0 failed; repository self-check passed.
- `npm run test:packed`: passed against an installed npm tarball.
- Packed checks include direct/preview/auto-plan/exact-apply, tamper and stale
  rejection, injected rollback, generated/adopted no-op, protected product,
  package, instruction, and durable-memory hashes, and monorepo upgrade.
- `git diff --check`: passed.
- Ticket-pack validation: 6 contracts, 0 errors. Lane-3 no-human-gate warnings
  are intentional because all work is local; push/publish remain separate gates.
- Execution routing note: the intended Spark worker topology never started:
  its first configuration used the wrong Codex model name, and the reopened
  Codex App then refused Spark before creating a child identity. GPT-5.6 Sol
  high acted as coordinator and implementation writer; no implementation
  subagent was used. The historical track policy remains GPT-5.3-Codex/high.
  Independent read-only spec, code, and operations reviews also used the
  available GPT-5.6 Sol high profile.

## Baseline repair

- Restored the built-in `sol-codex` contract to GPT-5.3 Codex with high
  reasoning for delegated roles; the premature Spark/xhigh fallback is not part
  of this baseline.
- The currently materialized workspace remains `sol-only` under explicit user
  authority. Actual dogfood execution used GPT-5.6 Sol high fallback, so the
  intended Sol/Codex delegated topology was not validated.
- `test/presets.test.js` is restored to its locked 139 LOC baseline.
- Architecture locks now record `test/adopt.test.js` 380 LOC,
  `test/presets.test.js` 139 LOC, and `test/skills-update.test.js` 123 LOC with
  zero allowed growth.
- No commit hash is claimed; the ticket ledger is prepared with no active UPG
  tickets.

### Focused repair verification

- `npm.cmd run test -- test/upgrade-apply-rejection.test.js
  test/upgrade-cli.test.js test/upgrade-apply.test.js test/presets.test.js`:
  17 passed; one concurrently executed Windows subprocess exited with native
  status `1073741845` and no output.
- Isolated rerun `npm.cmd run test -- test/upgrade-cli.test.js`: 2 passed,
  0 failed.
- In the combined run, `test/upgrade-apply-rejection.test.js`,
  `test/upgrade-apply.test.js`, and `test/presets.test.js` all passed.
- Doctor: `ok: true`, 0 errors, 0 warnings.
- Locked LOC: adopt 380, presets 139, skills-update 123.
- `git diff --check`: passed; zero open process leases.
- `npm run pack:check` was not rerun because the tracked bin launcher became
  absent through an unrelated concurrent change outside this repair's write
  authority. The coordinator owns restoration and packed verification.

## Baseline repair C — reopened 2026-07-26

- Authority: current user-authorized repair amendment
  `baseline-repair-c-2026-07-26`.
- Status: blocked on active UPG-004 and fresh public documentation evidence.
- Public rollback/routing claim review: _coordinator to append against the final
  diff_.
- Packed/full landing gates: _coordinator to append; not yet claimed_.

## Baseline repair D public-contract handoff

- Help, README, and usage now require sealed `--allow-network` approval for
  upgrade verification and document dependency-backed and POSIX verification
  as unavailable until FBK-002.
- Public rollback remains repository-local. Source `node_modules` is neither
  copied nor exposed to the disposable checkpoint.
- The guide's historical engineering route is restored to GPT-5.3-Codex/high.
- Windows signal coverage is explicitly an IPC/process-event bridge simulation,
  not OS-delivery evidence. Detached-verifier signal cases are Windows-only;
  the separate POSIX capability test verifies fail-closed behavior before
  payload or lease creation.
- UPG-006 remains blocked on active UPG-004, independent reviews, and the
  coordinator-owned full/packed landing gates.

## Final packed landing evidence — 2026-07-26

The earlier blocked and “not rerun” statements are chronological evidence and
are superseded by this final block.

- `npm run pack:check`: pass against the final archive manifest; 306 entries.
- `npm run test:packed`: pass under the native Windows Job owner.
- Packed smoke proves:
  - default `sol-only` and historical `sol-codex` Codex/high rendering;
  - dependency-backed isolated upgrade verification fails closed before a
    process starts;
  - dependency-free generated, adopted, and workspace upgrade paths;
  - exact-plan tamper/stale rejection and injected rollback through the
    package-internal harness;
  - protected source, package, instruction, and durable-memory state;
  - offline tooling, restructure, and manual alignment flows.
- The tarball and packed-smoke sandbox are removed in `finally`; both final
  cleanup targets were confirmed absent.
- The packed gate performs no publish, deployment, release bump, or remote
  mutation.
- Status: UPG-006 closed.

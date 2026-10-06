# Delivery efficiency investigation

Investigation date: 6 October 2026. Branch: `codex/investigate-delivery-efficiency`.
Package baseline: `9b76e0312d83ff30538f97b6ceb05432580799e2`.

The first improvement should align verification guidance and shorten the path to a meaningful fixture failure. The existing native verifier already provides affected-module selection and Windows process containment. Extend that surface where needed; do not build another orchestration layer. Add measurement before claiming faster delivery or introducing evidence reuse.

The investigation below describes the package baseline and identifies separate consumer-owned work. The implementation on this branch addresses only workspace-template, through GitHub issues 3–9. Consumer-owned changes and release authority remain outside its scope.

## Findings

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Verification guidance contradicts proportionate delivery. | [execute-delivery](../../assets/skills/execute-delivery/SKILL.md) requires focused then proportionate broader checks. [verify](../../assets/skills/verify/SKILL.md) requires the full command or broadest feasible suite and repository-wide gates at completion. | An agent following both can repeat broad verification for a bounded repair. This is a concrete package inconsistency; its contribution to consumer elapsed time is unmeasured. |
| Native ownership can be read as a workflow escalation for every test. | [delivery-loop](../../assets/skills/delivery-loop/SKILL.md) and the [guide](../guides/adaptive-delivery.md) list native process ownership as Governed. [process-lifecycle](../../assets/skills/process-lifecycle/SKILL.md) says ordinary foreground commands need no specialist wrapper. | Clarify that using an already qualified owner does not itself require new contracts and authority receipts. Changing the ownership boundary remains consequential. |
| The reusable contained executor already exists, but focused selection is coarse. | [verify_cli.rs](../../crates/workspace-template-native/src/verify_cli.rs), [verify.rs](../../crates/workspace-template-native/src/verify.rs), and [workspace_graph.rs](../../crates/workspace-template-native/src/workspace_graph.rs) support module/affected/all scopes and structured command overrides. Discovered Rust modules run `cargo test -p <name>`. | Reuse repository-owned commands and overrides first. Module selection alone cannot choose one new native fixture or a named verification tier. |
| Default root verification is not the repository gate. | `root_steps` in [verify.rs](../../crates/workspace-template-native/src/verify.rs) prefers Cargo over package.json and runs `cargo fmt --all -- --check` then `cargo test`. This repository's `npm run check` also requires strict Clippy and workspace/all-target tests. | A native root PASS must not be presented as proof of all checks in AGENTS.md. A focused verification profile must declare which requirements it covers. |
| Verification output is insufficient for automatic evidence reuse. | The public probe below confirms graph fingerprints survive source and lockfile edits. Root results have no graph fingerprint. Neither result form records command durations or a source-content identity. | `graphFingerprint` identifies topology, not the tested candidate. Using it as a cache key could accept stale evidence. |
| Current status contains a substantial history backlog. | Trading-system's `current.md` measured 98,438 bytes and starts with several superseded active sections. | Keep the current checkpoint bounded; retain immutable evidence elsewhere and link it. Do not delete historical evidence to achieve a smaller summary. |
| Expensive failures include setup and reporting defects. | Trading-system's current checkpoint records a missing receipt signer before State/NATS startup and a later unused conflict-ID guard failure. Historical entries record a wrong retained Side enum literal and a scratch dispatcher classifying GREEN as RED. | Execute fixture startup and reporting controls before aggregate runs. Static review and typechecking cannot establish those runtime prerequisites. |

The historical [eighth-review audit](G:/dev/Github/trading-system/docs/agent/wayfinding/to-mvp-frontier-migration/research/tmvp0029-eighth-review-audit.md) documents passing checks that encoded the wrong production guard order and left test processes alive. Reducing duplicated verification must preserve independent behavioral expectations and process cleanup.

## Recommended package changes

### Align verification and authorization guidance first

Update the package-owned `verify`, `execute-delivery`, and `delivery-loop` guidance together, with the guide and relevant evaluations. Ordinary iterations should run the exact new scenario, the affected regression set, and required static checks. Broader gates belong at repository-declared integration, acceptance, authority, or release boundaries, or when impact cannot be bounded. Repository instructions remain authoritative: this is not permission to omit a mandated full gate.

Keep full acceptance obligations visible even when a component passes. A missing hosted gate can coexist with eligible local development only when the consumer contract permits that distinction. It cannot become PASS through rewording.

Preserve settled authorization within its original scope. Recheck it when scope or authority changes, rather than after every interruption. Ultima's explicitly separate candidate decision and apply confirmations remain mandatory; the package must not override them.

Acceptance scenarios should cover a bounded fixture repair without repeated full baselines, continuation after interruption without repeating a settled question, and a permitted local fix with a deferred external gate. Also cover an unknown impact set that requires broader checks and an authority change that still requires confirmation. Evaluate the complete instruction set together; isolated skill expectations are insufficient.

### Reuse the contained verifier for focused native work

Start with the current public interface:

```text
workspace-template inspect <root>
workspace-template verify <root> --scope module --module <observed-module-id>
workspace-template verify <root> --scope affected --affected-from <reviewed-base>
```

Affected selection includes transitive dependents and conservatively selects every module for unowned changes. These commands do not certify that repository-wide gates passed. Use an observed module ID, and do not assume every module's default command is sufficiently narrow.

Where a consumer already owns an exact native fixture command, its structured workspace override can reuse the existing Windows Job Object runner. Do not generate an installer, review adapter, or general shell wrapper for each repair. If full and focused commands must coexist and current overrides cannot express that cleanly, add named repository-owned checks to `verify` as a small public extension. Avoid a universal arbitrary-command API or a second scheduling authority.

For such an extension, first demonstrate a public RED: a requested focused check cannot run without executing the unrelated aggregate. Then implement only check selection, validating unknown names before launch, retaining bounded output/timeouts, and exercising cancellation, detached descendants, and failure propagation. Put selection/report logic in focused modules rather than expanding the existing large graph implementation.

### Add measurable verification records before reuse

Extend both root and workspace results consistently. Useful fields are total and per-step monotonic duration, declared check identity and coverage, executable identity, and observed cleanup outcome. Separate the ownership mechanism label from evidence that owned descendants reached zero. Any cleanup observation must refer to the actual owned job and a bounded wait; never inspect or kill processes by executable name alone.

A later record intended for reuse also needs the actual input identity: tested source and fixture bytes, manifests/lockfiles, selected commands and scripts, relevant toolchain/program identity, and explicit environment/service constraints. Detect input changes during execution and refuse reusable qualification when identity or cleanup cannot be established. Exclude generated outputs and credentials through an explicit input policy; do not indiscriminately hash or persist the whole environment.

Keep these as bounded JSON evidence emitted by the existing CLI. A consumer may retain the result in its existing evidence store. Do not introduce a receipt registry, ticket database, resumption writer, signing authority, or automatic issue closure. Hash matching supports freshness; it cannot prove the behavioral assertions were independent or complete.

Initially report timings and identity without skipping checks. Consider reuse only after public mutation controls establish invalidation for source, fixture, lockfile, command, executable, toolchain, and relevant environment changes. External-service evidence and nondeterministic checks need explicit freshness policies. No speed claim depends on caching in the first iteration.

## Consumer work and priority

| Priority | Owner | Proposed outcome | Evidence needed |
| --- | --- | --- | --- |
| 1 | workspace-template | Resolve verification and ownership wording conflicts; add continuation scenarios. | Combined instruction evaluations preserve mandatory gates while ordinary work avoids new process artifacts. |
| 2 | Trading-system | Run new settings/model fixtures and their real startup prerequisites before the maintained aggregate; reuse the maintained source-bound path. | Same fixture/assertions expose missing signer and construction guards early; later full acceptance still runs. No substitute oracle or fabricated receipt. |
| 3 | workspace-template | Add timings and honest coverage/identity fields; add named check selection only if existing overrides prove insufficient. | Public executable tests cover selected commands, failure, stale inputs, timeout, cancellation, and cleanup. |
| 4 | Each consumer | Keep one concise current issue/checkpoint and link historical records. | A fresh session recovers exact scope, authority, passed requirements, blockers, and next action without consuming the history backlog. |
| 5 | Ultima | Profile native operations and conduct the existing retirement comparison. | Matched bounded tasks, equal acceptance and environment, plus interruption and repair. |

For current summaries, pilot a 4 KiB or roughly 60-line target, not a new executable gate. Include the active issue, candidate identity, acceptance gaps, existing authority, blocker/resumption condition, next exact command, and links to durable records. Refresh the issue body when its current scope changes rather than relying on an ever-growing comment chronology. GitHub updates and consumer-history restructuring are separate work, not actions performed by this branch.

Ultima already owns canonical lifecycle and verification records. Its [instructions](G:/dev/Github/ultima-ai/AGENTS.md) forbid a second lifecycle authority, and its [retirement slice](G:/dev/Github/ultima-ai/docs/plans/ultima_vnext_v3/slices/ULTIMA-010-self-hosting-retire-scaffold.md) already requires a comparative run. Carry the demonstrated defaults into that system rather than building template-specific coordination machinery.

## Measurement and decision criteria

Compare matched tasks on the same source baseline and environment, alternating order and reporting cold versus warm builds separately. Include an ordinary repair, a fixture/setup defect, and an interrupted run. Preserve the same assertions, required acceptance checks, and authority boundaries. Use several pairs and publish individual outcomes plus medians; a small pilot is directional evidence, not a causal performance claim.

Measure time to the first meaningful failure separately from setup failure and compile time; time to successful affected verification; repeated unchanged verification time; total required acceptance time; operator interventions and repeated authorization requests; coordination artifacts; and recovery accuracy. Record inference cost only when the host exposes it, otherwise mark it unavailable. Keep measurements in existing command/kernel records rather than creating another tracking system.

Keep a change when it reduces repeated verification or coordination cost without missing known defects, leaving owned descendants, losing recovery state, or weakening acceptance. The supplied Ultima report attributes about 288 of 289 seconds in one fan-in measurement to public native operations; that specific measurement was not independently reproduced here and cannot establish general template overhead. Profile the runtime separately before attributing its cost to methodology.

## Investigation evidence

Fresh Windows checks on the package baseline:

- `cargo test --offline --locked --test affected_verification --test workspace_inspection`: 12 passed, 0 failed, 0 ignored. This exercises selection, transitive dependents, branch failure isolation, conservative fallback, topology, and safe overrides through the executable.
- `cargo test --offline --locked --test cli_v09`: 13 passed, 0 failed, 0 ignored. This includes sealed adoption, embedded skills, cancellation, and removal of a detached descendant after successful root exit.
- A disposable Node-layout probe used `inspect`, changed source bytes, changed package-lock bytes, then ran `verify --scope all` with the structured command `rustc.exe --version`. Both edits retained fingerprint `4517be65aa4a8881bed6f987de1aa0d93c5947a573a5161ea3410c31e288026d`. Verification returned PASS with no timing or source identity fields and `processOwnership: windows-job-object`. The validated fixture path was removed. This proves an identity limitation, not application correctness or a new cleanup attestation.

The first offline Cargo attempt could not unpack a cached dependency into the read-only cache; the successful retry used expanded filesystem permission and remained offline. The first disposable probe assumed `.tmp` existed and stopped on setup; the corrected probe created its parent explicitly. Neither setup failure is a behavioral RED.

Consumer observations are from local files on 6 October, including potentially uncommitted state: Trading-system HEAD `214bf7b6ef33892698e7615bdbb3ce968b47c671` and Ultima HEAD `6482d4f1c4ff00a76af13f997990fa3e38c88422`. Primary local sources are [Trading-system instructions](G:/dev/Github/trading-system/AGENTS.md), [current checkpoint](G:/dev/Github/trading-system/.agentic/resumption/current.md), the historical audit above, and Ultima's instructions and retirement slice. The binary was absent from this session's PATH; the public checks used the native executable built from this checkout.

Live GitHub reads of issues 126, 127, and 26 failed in the browser tool. Their remote status and issue-body freshness are therefore not independently established by this investigation. The reported issue conclusions are not used as proof of runtime correctness. Full workspace, packed qualification, release signing, and consumer acceptance were not exercised by this documentation-only change.

## Package implementation and verification

The baseline investigation above is historical evidence. The subsequent implementation addresses these workspace-template issues on `codex/investigate-delivery-efficiency`:

| Issue | Implemented outcome |
| --- | --- |
| [#3](https://github.com/mirkoEscobedo/workspace-template/issues/3) | Combined guidance uses focused iteration and mandatory broader boundaries, executes fixture startup/reporting early, and reuses qualified ownership without new process artifacts. |
| [#4](https://github.com/mirkoEscobedo/workspace-template/issues/4) | Current summaries have a soft 4 KiB/60-line target, linked history, exact recovery facts, and scope-aware authorization across interruption. |
| [#5](https://github.com/mirkoEscobedo/workspace-template/issues/5) | A real Cargo fixture qualifies existing overrides alongside the root aggregate. Unknown modules cannot launch checks; no new selection API or adapter was needed. |
| [#6](https://github.com/mirkoEscobedo/workspace-template/issues/6) | Optional exact command coverage exposes passed, failed, and not-run requirements separately from scoped command success and human acceptance. |
| [#7](https://github.com/mirkoEscobedo/workspace-template/issues/7) | Root and workspace records include monotonic total/per-step durations; the guide specifies matched comparisons without asserting faster delivery. |
| [#8](https://github.com/mirkoEscobedo/workspace-template/issues/8) | Cleanup observes the actual job, retained member signals, and admission accounting within one deadline. Git discovery/selection uses the same owner; detached fsmonitor helpers cannot survive a qualified report. |
| [#9](https://github.com/mirkoEscobedo/workspace-template/issues/9) | Bounded explicit inputs bind before/after file, program, environment, command, and actual process-image observations. Protected paths, links, mutation, unknown images, services, or cleanup uncertainty refuse qualification; no caching or automatic acceptance was added. |

Final source verification on 6 October 2026: `npm run check` passed formatting, strict workspace/all-target Clippy, and all 97 Rust tests. Public controls include source/fixture/lock/toolchain/environment mutations, root interpreter identity, executable search precedence, explicit and default working-directory junctions, focused/full coexistence, scoped coverage, and real process cleanup. Canonical inventory, resource closure, and byte-exact embedded skill checks passed.

Independent native review exposed executable-binding, protected-program, working-directory, and discovery ownership defects before acceptance. Exact owned-job controls then reproduced zero accounting before fully signaled process exit; the retained-handle repair preserves immediate public assertions rather than adding a test-side wait. An older npm timeout fixture also needed a five-second startup allowance and explicit module type to reach its real detached-child scenario. Neither setup noise nor the earlier failed full runs are presented as passing evidence.

An independent agent applied the combined instructions to the 13 new scenarios without reading their expected answers. The qualitative review prompted one clarification to the centralized replanning rules and confirmed the required scope, recovery, and authority decisions. This is not a host benchmark or a measured speed improvement.

These are source changes on the investigation branch. GitHub issues remain tracking work; committing and pushing this branch does not close them or authorize release signing or publication. Packed qualification was not run: the source-preparation checkout has no materialized `bin/workspace-template.exe` or provenance. Release qualification and consumer acceptance remain separate. No other project repository was modified.

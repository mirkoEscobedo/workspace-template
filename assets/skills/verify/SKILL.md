---
name: verify
description: Gather fresh evidence with focused checks during development and required broader gates at declared acceptance boundaries, inspect the diff, and report exact coverage and gaps. Use before claiming a feature, fix, refactor, or review is done.
license: MIT
compatibility: Requires repository inspection and command execution.
metadata:
  version: "1.0.0"
  mode: model-invoked
---

# Verify before completion

Claims follow evidence, never the reverse.

## Procedure

1. Read the command table in the nearest `AGENTS.md` and inspect actual project scripts/tooling.
2. Run the exact new or changed scenario, then the smallest affected regression set. For a new native fixture, first execute its real startup and reporting path before an expensive aggregate. A successful compile proves compilation only; a fixture that fails setup has not demonstrated the intended RED or GREEN behavior. Correct or classify setup failures before expanding verification.
3. Run the static/type/analyzer and lint checks relevant to the changed surface.
4. Run full verification at the repository-declared acceptance, integration, authority, or release boundary, and when impact cannot be bounded. Repository-mandated gates remain mandatory. Ordinary iterations use the focused scenario, affected regressions, and relevant static checks; do not repeat a full suite after every small repair merely because it was run earlier. When covered inputs change, mark the prior broad result stale for those inputs and continue eligible focused work. Refresh broad evidence when next required or claimed at the applicable boundary. Investigate a new concern with the smallest checks that can bound its impact; require full verification if impact remains unknown.
5. Inspect the final diff and status:
   - no unrelated or debug changes;
   - no secrets or sensitive fixtures;
   - lockfiles and generated files are expected;
   - public contracts/docs are synchronized;
   - no skipped tests, ignored diagnostics, or disabled controls were introduced without explanation.
6. For UI or integration behavior not covered automatically, perform the smallest reproducible manual check and record it.
7. Report each command, whether it passed, what it covers, and the meaningful summary. Separate component evidence, deferred gates, and full acceptance. Name unavailable tools or environments, the unmet requirement, and its resumption condition. Continue independent eligible local work only when the repository contract permits it; an unavailable mandatory gate still prevents its acceptance claim.

## Language

Use “verified” only for checks run against the stated current inputs. Use “not run” or “not verified” for assumptions. Do not infer a full-suite pass from a focused test, a compile-only result, or a setup failure. Existing evidence may support an unchanged covered surface only when its input identity and required freshness are established.

## Completion criterion

Component verification is complete when fresh evidence covers the changed behavior and affected checks, and the final diff is inspected. Full acceptance additionally requires all gates declared for that boundary. Keep every deferred or unverified requirement visible; a component pass cannot close a broader outcome whose mandatory evidence is missing.

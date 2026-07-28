---
name: integrate-wave
description: "Use when passed Frontier Loop ticket candidates must be neutrally integrated in dependency order with actual-scope checks, landing verification, mechanical conflict handling, and serial commits or cherry-picks."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Integrate Wave

The integrator owns landing mechanics, not product redesign.

1. Pin the target branch and wave base commit.
2. For each candidate in dependency order, verify:
   - required reviews passed;
   - evidence names the exact candidate commit/diff;
   - actual changed files fit the contract;
   - no undeclared conflict key or shared schema appeared;
   - architecture and process gates pass.
3. Apply or cherry-pick one candidate at a time.
4. Resolve only mechanical conflicts where both contracts remain unambiguous. Return semantic conflicts to the planner.
5. Run wave L3 checks after related candidates are composed.
6. Run L4 where policy requires it, especially Lane 3 landing.
7. Commit/record each ticket separately unless a predeclared integration branch requires a final integrate ticket.
8. Update ledger, frontier, and minor-finding rollup.
9. Finish with a clean worktree and zero owned processes.

---
name: integrate-wave
description: "Integrate two or more independently produced, already reviewed candidates in dependency order with mechanical conflict handling and composed verification. Use only for an actual multi-branch Ticketed or Governed wave."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.8.0"
---

# Integrate Wave

This is an optional specialist skill. Direct delivery and serial work on one branch do not need an integration wave. The integrator owns landing mechanics, not product redesign.

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
8. Update the compact current-work record when one exists; never create or extend a legacy frontier.
9. Finish with a clean worktree and zero owned processes.

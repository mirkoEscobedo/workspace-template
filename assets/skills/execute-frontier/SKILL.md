---
name: execute-frontier
description: Compatibility alias for a request to execute a legacy local Frontier pack. Use to preserve the pack as history, extract one current outcome, and continue through execute-delivery without mutating the old graph.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.7.0"
  deprecated: true
---

# Execute Frontier compatibility

Do not resume the legacy graph or run its generic writer. Read only enough of the selected node and repository state to recover the current product outcome, verified facts, remaining acceptance criteria, blockers, and exclusions. Preserve the original graph and evidence unchanged.

Create at most one compact resumption item when multi-session durability is needed, then invoke `execute-delivery`. Existing repair counters and repeated failure evidence inform the new route; they do not grant fresh retries.

---
name: ticket-review
description: Compatibility alias for reviewing a legacy Frontier ticket. Use only to invoke review-change against the current diff and acceptance criteria; never append another legacy review attempt.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.7.0"
  deprecated: true
---

# Ticket Review compatibility

Use `review-change`. Preserve old review files as history and emit the Adaptive Delivery verdict in the current response or new compact run record. Do not edit source, create another numbered review attempt, or treat inspection evidence as approval.

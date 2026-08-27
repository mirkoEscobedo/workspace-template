---
name: repair-ticket
description: Compatibility alias for a legacy Frontier repair request. Use only to invoke repair-change with the existing outcome's repair count and hypotheses; never create a successor repair ticket.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.7.0"
  deprecated: true
---

# Repair Ticket compatibility

Use `repair-change`. Count prior semantic repair attempts for the same product outcome even when they appear in separate legacy tickets or decisions. Preserve old artifacts unchanged and refuse a third repair or repeated hypothesis.

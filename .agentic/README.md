# Agentic workspace

This adopted repository owns its installed agent behavior.

- `profile.json` records implementation, testing, and Frontier execution policy.
- `skills/` is the canonical project-local skill catalog.
- `skills.lock.json` records the packaged baseline.
- `managed-files.json` records generator ownership and drift boundaries.
- `managed-projections.json` records harness projections.
- `policies/` contains model routing, verification, architecture, and process defaults.
- `scripts/` contains deterministic guards and retrofit helpers.
- `../docs/agent/` is durable repository planning memory.

Edit canonical skills, then run:

```bash
npx workspace-template sync .
npx workspace-template doctor .
```

Frontier Loop is local-file based. GitHub issues, webhooks, and repository watchers are optional integrations, not prerequisites.

---
name: retrofit-agent-docs
description: "Use when an existing docs folder needs the durable Frontier Loop documentation shape without destructive moves, including project, authority, test, process, failure, decision, evidence, wayfinding, and migration indexes."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Retrofit Agent Docs

## Required shape

```text
docs/
  agent/
    README.md
    PROJECT_MAP.md
    DOMAIN_GLOSSARY.md
    AUTHORITY_MAP.md
    TEST_TOPOLOGY.md
    PROCESS_POLICY.md
    FAILURE_CATALOG.md
    CURRENT_FRONTIER.json
    architecture-baseline.json
    decisions/
    evidence/
    wayfinding/
    migrations/
  tickets/
    README.md
```

## Process

1. Scan the existing docs tree and classify likely architecture, glossary, ADR, security/authority, testing, operations, incident, ticket, and evidence sources.
2. Produce a dry-run migration map. Do not move or rewrite existing files by default.
3. Create missing canonical files with source pointers and explicit `UNRESOLVED` sections rather than fabricated content.
4. Create indexes that link current documents to the new canonical categories.
5. Preserve existing ADR locations; the new `decisions/README.md` may point to them.
6. Add the ticket README describing the required track shape, Wayfinder handoff, and continuous Frontier execution.
7. Create a baseline file with empty metrics unless a trusted deterministic scan is run.
8. Record all created files in `docs/agent/migrations/<date>-docs-retrofit.md`.

## Deterministic helper

```bash
python scripts/retrofit_docs.py /path/to/repo/docs          # dry run
python scripts/retrofit_docs.py /path/to/repo/docs --apply  # additive apply
```

## Guardrails

- Never claim a glossary term, authority boundary, or architecture rule that the source docs do not support.
- Never delete or relocate source docs without an explicit separate migration.
- Duplicate content becomes a pointer and an unresolved consolidation task, not an automatic merge.

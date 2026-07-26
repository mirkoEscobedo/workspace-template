# FBK-006 Evidence

Before restart, store the sol-only provenance, complete offline command results,
reviewed activation plan/result, new fingerprint, restart-required marker, and
the frozen input plus recorded hash at `live/packet.md`.

After human restart, append explicit restart confirmation, broker discovery,
`opencode models openai`, verbatim/normalized native refusal with no child
identity, `live/implementer.marker`, `live/implementer-report.json`, and
broker/coordinator-captured `live/reviewer-report.json`. The reviewer session
itself writes nothing. Controller evidence is limited to
`.agent/runs/<run-id>/routing-state.json`,
`.agent/runs/<run-id>/attempts/implementer-1.json`, and
`.agent/runs/<run-id>/attempts/reviewer-code-1.json` after safe-component
validation of `<run-id>`. Record the exact allowed-write diff,
zero-descendant/lease proof, final `sol-codex` status, and three independent
review reports.

Lease evidence uses the same validated `<run-id>` and only these transient
paths:

- `.agent/leases/<run-id>--FBK-006--native-spark-implementer.json`
- `.agent/leases/<run-id>--FBK-006--opencode-spark-implementer.json`
- `.agent/leases/<run-id>--FBK-006--opencode-spark-reviewer-code.json`

All three transient files must be absent at completion. Retain only the same
names ending `.final.json`; each final record must state final outcome and
remaining descendants. The allowed-write oracle must report zero other lease
paths.

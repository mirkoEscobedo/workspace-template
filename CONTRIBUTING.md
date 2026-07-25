# Contributing

## Development setup

Requires Node.js 24 or newer.

```bash
npm test
npm run lint
npm run check
npm run pack:check
```

## Change requirements

- Keep the generator runtime dependency-free unless a dependency provides clear, reviewed value.
- Add tests for every new CLI option, target, style, profile field, and safety behavior.
- Keep `.agentic/skills` in generated projects as the canonical source.
- Add trigger/output eval fixtures when a skill's routing or contract changes.
- Do not copy third-party skill text without license/provenance review.
- Update research/source audit when conclusions or external versions change.
- Run generated-project checks for every affected target/style where the toolchain is available.
- Disclose unexecuted toolchains explicitly.

## Commit shape

Prefer focused commits separating:

- generator behavior;
- template/skill content;
- research/documentation;
- dependency snapshot updates.

Never commit generated validation directories, package tarballs, credentials, or local registry tokens.

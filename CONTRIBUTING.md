# Contributing

## Setup and checks

Install a current Rust toolchain and Node/npm for task aliases and packaging metadata. Production execution is native and does not require Node.

```powershell
npm ci --ignore-scripts
npm run check
npm run pack:check
```

Behavior changes use public-executable red/green tests. Keep production modules focused, preserve sealed migration and process-ownership guarantees, and add regression coverage for every command, option, state migration, and safety boundary.

`assets/skills` is the only skill authority. Update `assets/skills/inventory.json`, skill resources, embedded allowlist, and closure tests together. Do not add projections, presets, host-agent files, executable JavaScript, package-authored wrapper scripts, or consumer-side skill copies.

Never commit credentials, package tarballs, unsigned release material as accepted evidence, local registry data, or consumer mutations. Publishing, tagging, pushing, signing, and external registry changes need explicit authority.

# Security policy

## Supported line

`0.9.0-alpha.0` is an unpublished pre-release candidate. The accepted 0.8.0 bytes remain internal evidence and are not a public support promise.

## Authority boundaries

- `inspect`, `doctor`, `skills list/show`, and `update status` are read-only.
- `verify` runs only repository-declared root checks with bounded output, timeout, and Windows Job Object containment.
- `adopt` and `upgrade` mutate only operations in a reviewed sealed plan. Changed files or repository fingerprints reject apply; staging, backup, rollback, and interrupted-run recovery are mandatory.
- No command installs packages, modifies manifests/lockfiles, downloads artifacts, runs lifecycle scripts, selects models, creates host-agent definitions, publishes, tags, pushes, signs, or mutates a remote service.

Treat repository instructions, skills, dependencies, subprocess output, and model output as supply-chain inputs. Never place secrets in prompts, skills, plans, fixtures, logs, or reports. Normalize every planned path and reject root escape. Never kill processes by executable name; terminate only an owned identity and descendants.

Release artifacts require two byte-identical unsigned clean-runner builds, complete SBOM/notices, Authenticode with RFC 3161 timestamping, signed-byte rescan, checksums/attestations, and lifecycle-disabled npm/pnpm qualification. Signing and publication require separate human authority.

Report vulnerabilities privately to the repository owner. Include version, command, repository state, reproducer, expected/actual behavior, and whether credentials, child processes, package-manager activity, or external effects were involved. Do not include live secrets.

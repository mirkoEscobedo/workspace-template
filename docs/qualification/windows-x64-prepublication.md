# Windows x64 pre-publication qualification

Target: `x86_64-pc-windows-msvc`
Release: `0.9.0-alpha.0`
Status: blocked before publication; no signature or registry identity has been authorized.

Source-level checks cover formatting, warnings-denied Clippy, all Rust tests, routing, strict CLI arguments and exits, exact skill retrieval, schema-v2 sealed migrations, stale/conflict/recovery/no-op behavior, update-status disagreements, timeout cleanup, cancellation cleanup, and root-exit descendant cleanup.

Local source verification on 2026-08-28 passed `npm run check` with 36 Rust tests and passed the 56-entry npm dry-run inventory. PowerShell release/packed harnesses parse successfully. A local release-profile compile could not execute Cargo's freshly generated build-script binary because this host repeatedly returned Windows access-denied/file-in-use errors in two target directories. Two bounded retries were exhausted; no release bytes were accepted. The clean Windows runner workflow is the required alternate route.

The release pipeline must still produce two byte-identical unsigned builds on a clean runner, generate SBOM and third-party notices, apply Authenticode plus RFC 3161 timestamping, rescan signed bytes, record exact tarball hashes and attestations, and exercise npm/pnpm installs with lifecycle scripts disabled and Node absent at execution time.

After signing, qualification must use an isolated owned local registry and disposable checkouts of the five accepted consumers. It must stop before any real tag, npm publication, GitHub Release, or dist-tag mutation.

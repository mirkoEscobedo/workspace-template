# UPG-005 Result

- Supported config 1–3, profile 1–2, managed-files 1–3, skill-lock 1–2, and
  workspace 1 shapes migrate to the current normal form.
- Legacy generated origin is recovered only from explicit timestamp evidence;
  ambiguous/contradictory provenance is rejected.
- Apply → doctor → protected product/durable-memory hashes → second no-op is
  covered across legacy generations.
- Packed monorepo evidence covers adopt → upgrade → doctor → protected hashes
  → second no-op with module and root aggregate verification.
- Focused coverage: `test/upgrade-compatibility.test.js`,
  `scripts/packed-smoke.js`.

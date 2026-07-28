# UPG-003 Result

- Canonical skills use per-file three-way merge against the installed baseline.
- Risky executable/tool changes and upstream removals require their sealed
  approvals; locally modified removals remain blocked.
- Canonical, baseline, Codex/OpenCode projections, markers, and locks advance
  together. Removed files are deleted from every projection.
- Marker names, hash keys, projection manifests, and actual projected
  directories must exactly match; incomplete or extra trees block.
- Focused coverage: `test/upgrade-skills.test.js`.

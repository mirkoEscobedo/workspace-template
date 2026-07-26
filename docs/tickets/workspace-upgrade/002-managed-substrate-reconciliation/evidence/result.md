# UPG-002 Result

- Incoming assets are read from the running package; local presets and durable
  planning memory are excluded from package ownership.
- Generated whole-file instructions are rerendered. Adopted managed blocks are
  replaced in place while repository-owned surrounding text remains editable.
  Unowned custom instructions remain untouched.
- Structured harness settings, preset selection, origin, timestamps, workspace
  metadata, obsolete owned artifacts, and manifest ownership modes are
  reconciled without claiming product paths.
- Focused coverage: `test/upgrade-artifacts.test.js`.

## Baseline repair D authority note

- The repair amendment explicitly includes the existing
  `src/adoption-plan.js` and `src/create.js` manifest-shape changes plus their
  direct tests. They produce the identity and ownership records consumed by
  atomic upgrade inspection/reconciliation; reverting them would make the
  shared manifest contract internally incompatible.
- This authority is limited to upgrade manifest compatibility. Historical
  UPG-002 closure and product creation/adoption semantics are not rewritten.
- `test/adopt.test.js` is restored to its locked 380 LOC while retaining the
  historical `gpt-5.3-codex` model assertion.

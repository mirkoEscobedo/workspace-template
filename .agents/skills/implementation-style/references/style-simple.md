# Simple modular style

Use for small applications, local features, scripts, prototypes becoming real, or behavior with little domain complexity.

- Keep related data, behavior, tests, and adapters close together in one feature module.
- Separate a pure helper when it clarifies a rule; do not create layers merely to match a diagram.
- Call an external dependency directly from a small application function when there is only one use and no testing or volatility pressure. Wrap it once that pressure appears.
- Prefer one obvious module over a service/factory/interface trio.
- Keep public exports narrow. Private implementation may change freely.
- Promote to functional-core style when calculations mix with I/O, tests require extensive stubbing, or rules are reused.
- Promote to clean style when several use cases share policy across multiple delivery and infrastructure adapters.

A simple design is not careless. It still validates inputs, reports errors explicitly, tests behavior, and keeps hidden global state out of core logic.

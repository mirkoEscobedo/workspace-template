# Rust implementation guidance

- Use structs and enums for domain data; use newtypes for IDs and values whose invariants matter.
- Prefer free functions or non-mutating methods for calculations and transitions.
- Use traits at capability boundaries. Avoid a trait for every concrete type or solely to enable mocking.
- Prefer generic parameters for static composition and `dyn Trait` where runtime heterogeneity or smaller compile surfaces matter.
- Return `Result` and domain-specific error enums. Avoid panics for expected input or infrastructure failures.
- Keep async and framework types at adapters/application boundaries when policy itself is synchronous.
- Prefer ownership and borrowing that make mutation scope explicit. Clone deliberately, not reflexively.
- Keep unsafe code absent or isolated behind a small, documented, tested safe interface.
- Put unit tests near private implementation when useful; use integration tests through the public crate API for behavior contracts.
- Let `cargo fmt`, `clippy`, tests, and documentation tests provide continuous feedback.

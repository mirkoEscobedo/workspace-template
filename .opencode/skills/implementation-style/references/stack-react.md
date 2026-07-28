# React implementation guidance

- Treat rendering as pure: components derive JSX from props, state, and context without mutating pre-existing values.
- Put user-triggered effects in event handlers. Use Effects only to synchronize with external systems, not to derive ordinary state.
- Keep domain calculations in framework-free functions.
- Use a reducer when state transitions are numerous, coupled, or benefit from event vocabulary; keep the reducer pure.
- Use custom hooks as UI/application adapters for reusable stateful or effectful behavior.
- Keep components focused on rendering and interaction. Move complex policy out, but do not split every component into artificial controller/service layers.
- Test pure reducers/functions directly and user-visible behavior with component tests.
- Prefer feature-first organization. A feature may contain `domain`, `application`, `adapters`, and `ui` only when each has real content.
- Keep server/cache libraries at the boundary; do not copy remote data into redundant local state without a reason.

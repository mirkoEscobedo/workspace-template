# OpenCode configuration

OpenCode discovers the shared Agent Skills location `.agents/skills/`. Run `opencode models` or `/models` and replace unavailable provider/model IDs before dispatching work. Direct OpenAI provider IDs use `openai/<model-id>`; another provider may expose a different prefix.

The supplied routing is:

- primary orchestrator: `openai/gpt-5.6-sol`, high;
- Wayfinder/planner: `openai/gpt-5.6-sol`, high;
- every scout, implementer, reviewer, repairer, and integrator: `openai/gpt-5.3-codex`, high.

The primary coordinator drives local files and invokes named subagents. It does not watch GitHub issues or wait for repository events. Read-only roles deny edits. Write roles cannot recursively dispatch more agents. External-directory access is denied by default.

OpenCode configuration files merge by precedence. The scaffold preserves conflicting existing agent definitions and writes the Frontier Loop configuration as a separate example when automatic merging would be unsafe.

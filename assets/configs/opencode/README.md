# OpenCode configuration

OpenCode discovers the shared Agent Skills location `.agents/skills/`. Run `opencode models` or `/models` and replace unavailable provider/model IDs before dispatching work. Direct OpenAI provider IDs use `openai/<model-id>`; another provider may expose a different prefix.

The supplied routing is:

- every role is rendered from the active preset recorded in
  `.agentic/policies/model-routing.yaml`;
- switching presets changes only workspace-template-managed routing fields;
- inactive preset definitions remain installed in `.agentic/presets/`.

The primary coordinator drives local files and invokes named subagents. It does not watch GitHub issues or wait for repository events. Read-only roles deny edits. Write roles cannot recursively dispatch more agents. External-directory access is denied by default.

OpenCode configuration files merge by precedence. The scaffold preserves conflicting existing agent definitions and writes the Frontier Loop configuration as a separate example when automatic merging would be unsafe.

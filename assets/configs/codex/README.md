# Codex configuration

The project-scoped configuration is rendered from the repository's active
agent preset. The selected model and reasoning effort for every role are
recorded in `.agentic/policies/model-routing.yaml`.

Copy or merge:

```text
.codex/config.toml
.codex/agents/*.toml
.codex/hooks.json
```

Codex discovers custom roles from the standalone TOML files under `.codex/agents/` (or `~/.codex/agents/`). Each supplied role file defines its own `name`, `description`, `developer_instructions`, rendered model, reasoning effort, and sandbox. Keep the role files with `config.toml`; the global `[agents]` table enables subagents, sets the concurrency cap, and supplies the active preset default. The configuration also enables lifecycle hooks.

Start with one writer and at most two read-only agents. The three-thread subagent cap excludes the primary coordinator.

Project-scoped Codex configuration is loaded only for trusted repositories. Review hooks with `/hooks`. The Stop and SubagentStop guards reject completion while a matching process lease is still active.

No agent watches GitHub issues or polls the repository. The primary conversation recomputes the local `frontier.json` after each serial landing.

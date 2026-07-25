# Skill evaluation

## Trigger set

Start with roughly 20 realistic prompts:

- 8–10 should trigger, with formal/casual wording, typos, implicit intent, and multi-step context.
- 8–10 should not trigger, especially adjacent tasks that share keywords.
- Run each prompt multiple times because selection is stochastic.
- Keep a holdout set when tuning descriptions to avoid overfitting.

## Output set

Start with 2–3 cases. Each contains:

- realistic prompt and optional fixture files;
- human-readable success criteria;
- edge or failure case;
- objective checks where possible: files, commands, tests, schema validation, or diff properties.

Compare baseline without the skill against the skill-enabled run. Measure correctness, process adherence, unnecessary work, tool use, safety, and completion evidence—not prose similarity.

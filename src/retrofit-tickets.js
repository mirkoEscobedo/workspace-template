import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { exists, toPosixPath } from "./fs-utils.js";

function quote(value) {
  return JSON.stringify(String(value));
}

function heading(text) {
  const match = /^#\s+(.+)$/m.exec(text);
  return match?.[1]?.trim();
}

function ticketId(directory) {
  return /^(\d+)/.exec(directory)?.[1] ?? directory;
}

function ticketSlug(directory) {
  return directory.replace(/^\d+[-_]*/, "") || `ticket-${ticketId(directory)}`;
}

function titleFrom(text, directory) {
  const first = heading(text);
  if (!first) return ticketSlug(directory).replaceAll("-", " ");
  return first.replace(/^Ticket\s+\S+\s*[-—:]\s*/i, "").trim();
}

function completedByValidation(text) {
  return /(?:^|\n)\s*(?:\*\*)?status(?:\*\*)?\s*:\s*(?:\*\*)?(?:pass|passed|complete|completed)(?:\*\*)?\s*(?:\n|$)/i.test(text)
    || /validation\s+(?:result|verdict)\s*:\s*(?:pass|passed)/i.test(text)
    || /^#\s+(?:validation\s+)?pass(?:ed)?\b/im.test(text);
}

function aggregateOnly(text) {
  return /tracking parent|aggregate[- ]only|parent ticket|coordination-only/i.test(text);
}

function riskLane(text) {
  const value = text.toLowerCase();
  if (/production apply|authority|capital|funds|kill[- ]?switch|credential|security|process lifecycle|transaction admission|destructive|deploy|publish/.test(value)) return 3;
  if (/persistence|event stream|migration|protocol|integration|recovery|replay|database|network|nats|cursor/.test(value)) return 2;
  if (/documentation|docs only|rename|generated index|formatting|configuration only/.test(value)) return 0;
  return 1;
}

function reviewAxes(lane) {
  if (lane === 0) return ["combined-low-risk"];
  if (lane === 1) return ["code-test"];
  if (lane === 2) return ["spec-authority", "code-test"];
  return ["spec-authority", "code-test", "operations-security"];
}

function verificationLevels(lane) {
  if (lane === 0) return ["L0", "L1"];
  if (lane === 1) return ["L0", "L1", "L2"];
  if (lane === 2) return ["L0", "L1", "L2", "L3"];
  return ["L0", "L1", "L2", "L3", "L4"];
}

function conflictKeys(directory, text) {
  const keys = new Set();
  const slugParts = ticketSlug(directory).split(/[-_]+/).filter((part) => part.length > 2);
  if (slugParts.length > 0) keys.add(slugParts.slice(0, 3).join("-"));
  const value = text.toLowerCase();
  const known = [
    ["authority", /authority|approval|apply/],
    ["process-lifecycle", /process|spawn|timeout|cancel/],
    ["persistence", /persist|database|migration|replay/],
    ["event-stream", /event stream|cursor|reconnect/],
    ["risk-control", /risk|capital|kill[- ]?switch/],
    ["shared-test-fixture", /fixture|test harness|megafile/],
  ];
  for (const [key, pattern] of known) if (pattern.test(value)) keys.add(key);
  return [...keys];
}

function yamlList(values, indent = 2) {
  if (values.length === 0) return "[]";
  const padding = " ".repeat(indent);
  return `\n${values.map((value) => `${padding}- ${quote(value)}`).join("\n")}`;
}

function contractYaml(ticket, previousId) {
  const blockers = previousId ? [previousId] : [];
  const axes = reviewAxes(ticket.lane);
  const levels = verificationLevels(ticket.lane);
  return `schema_version: 1
id: ${quote(ticket.id)}
title: ${quote(ticket.title)}
kind: ${ticket.aggregate ? "aggregate-only" : "implementation"}
status: ${quote(ticket.status)}
source:
  ticket: ${quote(`${ticket.directory}/ticket.md`)}
  validation: ${quote(`${ticket.directory}/validation.md`)}
parent: null
blocked_by:${yamlList(blockers, 2)}
priority: ${ticket.index + 1}
risk_lane: ${ticket.lane}
public_outcome: ${quote("Recover from the existing ticket; review before execution.")}
invariants:
  - ${quote("Preserve the existing ticket's observable requirements and authority boundaries.")}
expected_read_set: []
expected_write_set: []
conflict_keys:${yamlList(ticket.conflictKeys, 2)}
reviews:${yamlList(axes, 2)}
verification:
  implementer:${yamlList(levels.filter((level) => level !== "L4"), 4)}
  landing:${yamlList(levels, 4)}
budgets:
  locked_test_files_must_not_grow: true
  zero_owned_processes_after_run: true
human_gates: []
stop_if:
  - ${quote("The actual write set cannot be bounded before editing.")}
  - ${quote("A new authority transition or destructive effect is required.")}
  - ${quote("The recovered contract conflicts with the original ticket prose.")}
preflight_required: true
migration:
  generated_by: ${quote("workspace-template/0.6.0")}
  inference_status: ${quote("UNREVIEWED")}
`;
}

function wayfinderMap(track, masterPath, currentTicket) {
  return `# Wayfinder retrofit — ${track.name}

## Destination

\`UNRESOLVED\` — recover the observable completed state from [the preserved master plan](${masterPath ?? "./"}).

## Locked decisions

- Original ticket prose and validation files remain authoritative until this migration is reviewed.
- Frontier execution is local-file based and does not require GitHub issues, webhooks, or repository watchers.
- Coordinator/planner defaults: GPT-5.6 Sol, high reasoning.
- Scouts, implementers, reviewers, repairers, and integrator default: GPT-5.3-Codex, high reasoning.
- One writer by default; authority-sensitive work always remains single-writer; landing is serial.

## Open decisions

- Confirm the recovered destination, ticket statuses, authority gates, and dependency edges.
- Replace inferred empty write sets with bounded paths or symbols before implementation.
- Confirm architecture budgets and verification commands against the live checkout.

## Fog

- Work implied by historical tickets but unsupported by current repository evidence.

## Current position

${currentTicket ? `Explicit current ticket requested: \`${currentTicket}\`.` : "No current ticket was explicitly supplied. The generated frontier fails closed where status evidence is ambiguous."}

## Sources

- Preserved track directory: \`${track.path}\`
- Original ticket and validation files remain unchanged.
`;
}

function wayfinderFrontier(track) {
  return `schema_version: 1
effort: ${quote(`${track.name}-retrofit`)}
status: review_required
decisions:
  - id: D001
    question: ${quote("What is the observable completion contract for this track?")}
    status: open
    blocked_by: []
    method: human-and-repository-review
  - id: D002
    question: ${quote("Which recovered ticket statuses and dependency edges are supported by fresh evidence?")}
    status: open
    blocked_by: [D001]
    method: repository-review
  - id: D003
    question: ${quote("Which actions cross human, production, financial, destructive, or persistent-state authority boundaries?")}
    status: open
    blocked_by: [D001]
    method: human-and-repository-review
fog:
  - ${quote("Unreviewed implementation details and write sets remain in ticket contracts.")}
`;
}

function trackYaml(track, tickets, presetState) {
  const route = (role) => {
    const value = presetState?.roles?.[role];
    const model = value?.targets?.codex ?? value?.targets?.opencode ?? "UNRESOLVED";
    return `{ model: ${model}, reasoning_effort: ${value?.reasoningEffort ?? "UNRESOLVED"} }`;
  };
  return `schema_version: 1
id: ${quote(track.name)}
title: ${quote(track.name.replaceAll("-", " "))}
execution_mode: frontier
source_authority:
  - explicit-current-user-instructions
  - reviewed-wayfinder-decisions
  - preserved-master-plan-and-ticket-prose
  - repository-evidence
  - labeled-inference
model_routing:
  preset: ${presetState?.id ?? "UNRESOLVED"}
  coordinator: ${route("coordinator")}
  planner: ${route("planner")}
  workers: ${route("implementer")}
scheduler:
  default_writers: 1
  max_concurrent_subagents: 3
  landing: serial
tickets:${yamlList(tickets.map((ticket) => ticket.id), 2)}
`;
}

function frontierJson(track, tickets) {
  const ready = tickets.filter((ticket) => ticket.status === "ready" && !ticket.aggregate).map((ticket) => ticket.id);
  const active = tickets.filter((ticket) => ["in_progress", "repair", "review"].includes(ticket.status)).map((ticket) => ticket.id);
  return {
    schema_version: 1,
    generated_by: "workspace-template/retrofit-ticket-pack",
    track: track.name,
    execution_mode: "frontier",
    ready,
    active,
    tickets: Object.fromEntries(tickets.map((ticket, index) => [ticket.id, {
      directory: ticket.directory,
      title: ticket.title,
      status: ticket.status,
      kind: ticket.aggregate ? "aggregate-only" : "implementation",
      blocked_by: index > 0 ? [tickets[index - 1].id] : [],
      risk_lane: ticket.lane,
      conflict_keys: ticket.conflictKeys,
    }])),
    warnings: [
      "Generated status, dependency, risk, and conflict data must be reviewed against the live repository before execution.",
    ],
  };
}

async function readOptional(filePath) {
  if (!(await exists(filePath))) return "";
  return readFile(filePath, "utf8");
}

async function collectTickets(root, track, options) {
  const trackRoot = path.join(root, track.path);
  const entries = await readdir(trackRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && /^\d+[-_]/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const tickets = [];
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    const ticketText = await readOptional(path.join(trackRoot, directory, "ticket.md"));
    const validationText = await readOptional(path.join(trackRoot, directory, "validation.md"));
    const id = ticketId(directory);
    let status = completedByValidation(validationText) ? "complete" : "blocked";
    const requestedCurrent = options.currentTicket && (options.currentTicket === id || directory.startsWith(options.currentTicket));
    if (requestedCurrent) status = options.currentStatus ?? "in_progress";
    tickets.push({
      index,
      id,
      directory,
      title: titleFrom(ticketText, directory),
      text: `${ticketText}\n${validationText}`,
      aggregate: aggregateOnly(ticketText),
      lane: riskLane(`${ticketText}\n${validationText}`),
      conflictKeys: conflictKeys(directory, `${ticketText}\n${validationText}`),
      status,
    });
  }

  if (options.currentTicket && options.trustCurrentDependencies) {
    const currentIndex = tickets.findIndex((ticket) => ticket.status === options.currentStatus);
    if (currentIndex >= 0) {
      for (let index = 0; index < currentIndex; index += 1) tickets[index].status = "complete";
    }
  }

  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    if (ticket.aggregate || ticket.status === "complete" || ["in_progress", "repair", "review"].includes(ticket.status)) continue;
    const previousComplete = index === 0 || tickets[index - 1].status === "complete" || tickets[index - 1].aggregate;
    if (previousComplete) {
      ticket.status = "ready";
      break;
    }
  }
  return tickets;
}

export async function ticketRetrofitArtifacts(root, tracks, options = {}) {
  const artifacts = [];
  for (const track of tracks) {
    const trackRoot = path.join(root, track.path);
    const tickets = await collectTickets(root, track, options);
    const masterName = (await exists(path.join(trackRoot, "master-plan.md"))) ? "master-plan.md" : (await exists(path.join(trackRoot, "master-prompt.md"))) ? "master-prompt.md" : undefined;
    artifacts.push({ path: `${track.path}/wayfinder-retrofit.md`, content: wayfinderMap(track, masterName ? `./${masterName}` : undefined, options.currentTicket) });
    artifacts.push({ path: `${track.path}/wayfinder-frontier.yaml`, content: wayfinderFrontier(track) });
    artifacts.push({ path: `${track.path}/track.yaml`, content: trackYaml(track, tickets, options.presetState) });
    artifacts.push({ path: `${track.path}/frontier.json`, content: JSON.stringify(frontierJson(track, tickets), null, 2) });
    for (let index = 0; index < tickets.length; index += 1) {
      const previous = index > 0 ? tickets[index - 1].id : undefined;
      artifacts.push({ path: `${track.path}/${tickets[index].directory}/contract.yaml`, content: contractYaml(tickets[index], previous) });
      artifacts.push({
        path: `${track.path}/${tickets[index].directory}/evidence/README.md`,
        content: `# Ticket evidence\n\nStore immutable attempt, verification, process, and review records here. Do not rewrite historical attempts.\n`,
      });
    }
  }
  return artifacts.map((artifact) => ({ ...artifact, path: toPosixPath(artifact.path) }));
}

import {
  ADOPT_PACKAGE_MANAGERS,
  ADOPT_STYLES,
  ADOPT_TDD_MODES,
  AGENT_TARGETS,
  CONFLICT_MODES,
  CREATE_STYLES,
  CREATE_TDD_MODES,
  CURRENT_TICKET_STATUSES,
  DEFAULT_AGENTS,
  PACKAGE_MANAGERS,
  PROJECT_ALIASES,
  PROJECTS,
} from "./constants.js";
import { DEFAULT_PRESET_ID } from "./presets/catalog.js";

const COMMANDS = new Set([
  "create",
  "adopt",
  "retrofit",
  "inspect",
  "sync",
  "doctor",
  "verify",
  "tooling",
  "skills",
  "restructure",
  "align",
  "preset",
  "upgrade",
]);

const SUBCOMMANDS = Object.freeze({
  tooling: new Set(["plan", "install"]),
  skills: new Set(["update"]),
  restructure: new Set(["plan", "apply"]),
  align: new Set(["plan", "execute", "status", "resume"]),
  preset: new Set(["list", "status", "plan", "apply"]),
});

function normalizeProject(value) {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return PROJECT_ALIASES[normalized] ?? normalized;
}

function nextValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function splitOption(token) {
  const equals = token.indexOf("=");
  if (equals === -1) return [token, undefined];
  return [token.slice(0, equals), token.slice(equals + 1)];
}

function integer(value, option, minimum = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${option} must be an integer >= ${minimum}`);
  return parsed;
}

function push(options, key, value) {
  options[key] ??= [];
  options[key].push(value);
}

export function parseAgents(value) {
  const requested = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (requested.includes("canonical") || requested.includes("none")) return [];
  if (requested.includes("frontier")) return [...DEFAULT_AGENTS];
  if (requested.includes("all")) return [...AGENT_TARGETS];
  const invalid = requested.filter((item) => !AGENT_TARGETS.includes(item));
  if (invalid.length > 0) {
    throw new Error(`Unknown agent target(s): ${invalid.join(", ")}. Choose from ${AGENT_TARGETS.join(", ")}, frontier, all, or canonical.`);
  }
  return [...new Set(requested)];
}

function commonDefaults() {
  return {
    target: undefined,
    agents: [...DEFAULT_AGENTS],
    agentsExplicit: false,
    preset: DEFAULT_PRESET_ID,
    presetExplicit: false,
    dryRun: false,
    yes: false,
    json: false,
    help: false,
    version: false,
    planOut: undefined,
    applyPlan: undefined,
    allowDirty: false,
    modules: [],
    packs: [],
    dependencies: [],
    skills: [],
    moves: [],
    allowedPaths: [],
    nestedPlans: [],
    executorArgs: [],
  };
}

function defaultsFor(command, subcommand) {
  const common = commonDefaults();
  if (command === "create") {
    return {
      ...common,
      project: undefined,
      style: "functional-core",
      tdd: "pragmatic",
      packageManager: "npm",
      install: true,
      installExplicit: false,
      git: true,
      gitExplicit: false,
      bootstrap: true,
      bootstrapExplicit: false,
      force: false,
      docs: true,
      tickets: true,
    };
  }
  if (["adopt", "inspect"].includes(command)) {
    return {
      ...common,
      project: "auto",
      style: "preserve",
      tdd: "preserve",
      packageManager: "auto",
      install: false,
      git: false,
      bootstrap: false,
      force: false,
      conflict: "propose",
      verify: false,
      docs: true,
      tickets: true,
      currentTicket: undefined,
      currentStatus: "in_progress",
      trustCurrentDependencies: false,
      workspace: "auto",
      nestedInstructions: "auto",
    };
  }
  return {
    ...common,
    subcommand,
    workspace: "auto",
    scope: command === "verify" ? "all" : undefined,
    concurrency: 3,
    conflict: "propose",
    style: command === "align" ? "functional-core" : "preserve",
    checkpoint: "worktree",
    scripts: "propose",
    lifecycleScripts: "deny",
    dependencyKind: "development",
    lockfile: "update",
    rollbackOnFailure: true,
    organization: "preserve",
    imports: "rewrite",
    tests: "preserve",
    generated: "exclude",
    characterization: "required",
    review: "requirements-and-quality",
    executor: "manual",
    maxFiles: 12,
    maxDiffLines: 600,
    partial: false,
    allowSkillRemoval: false,
  };
}

function validateCreate(options) {
  if (options.project && !PROJECTS.includes(options.project)) throw new Error(`Unknown project '${options.project}'. Choose from ${PROJECTS.join(", ")}.`);
  if (!CREATE_STYLES.includes(options.style)) throw new Error(`Unknown style '${options.style}'. Choose from ${CREATE_STYLES.join(", ")}.`);
  if (!CREATE_TDD_MODES.includes(options.tdd)) throw new Error(`Unknown TDD mode '${options.tdd}'. Choose from ${CREATE_TDD_MODES.join(", ")}.`);
  if (!PACKAGE_MANAGERS.includes(options.packageManager)) throw new Error(`Unknown package manager '${options.packageManager}'. Choose from ${PACKAGE_MANAGERS.join(", ")}.`);
}

function validateAdopt(options) {
  if (options.project !== "auto" && !PROJECTS.includes(options.project)) throw new Error(`Unknown project '${options.project}'. Choose from auto, ${PROJECTS.join(", ")}.`);
  if (!ADOPT_STYLES.includes(options.style)) throw new Error(`Unknown style '${options.style}'. Choose from ${ADOPT_STYLES.join(", ")}.`);
  if (!ADOPT_TDD_MODES.includes(options.tdd)) throw new Error(`Unknown TDD mode '${options.tdd}'. Choose from ${ADOPT_TDD_MODES.join(", ")}.`);
  if (!ADOPT_PACKAGE_MANAGERS.includes(options.packageManager)) throw new Error(`Unknown package manager '${options.packageManager}'. Choose from ${ADOPT_PACKAGE_MANAGERS.join(", ")}.`);
  if (!CONFLICT_MODES.includes(options.conflict)) throw new Error(`Unknown conflict mode '${options.conflict}'. Choose from ${CONFLICT_MODES.join(", ")}.`);
  if (!CURRENT_TICKET_STATUSES.includes(options.currentStatus)) throw new Error(`Unknown current-ticket status '${options.currentStatus}'. Choose from ${CURRENT_TICKET_STATUSES.join(", ")}.`);
  if (!["auto", "single", "all"].includes(options.workspace)) throw new Error("--workspace must be auto, single, or all");
  if (!["auto", "always", "never"].includes(options.nestedInstructions)) throw new Error("--nested-instructions must be auto, always, or never");
}

function validateAdvanced(command, options) {
  if (command === "upgrade") {
    const selectedModes = [options.dryRun, options.planOut !== undefined, options.applyPlan !== undefined].filter(Boolean);
    if (selectedModes.length > 1) throw new Error("upgrade accepts only one of --dry-run, --plan-out, or --apply-plan");
    if (options.planOut === "") throw new Error("--plan-out path must not be empty");
    if (options.partial) throw new Error("upgrade is atomic and does not support --partial");
    if (options.applyPlan && (options.presetExplicit || options.allowDirty || options.allowRiskyToolChanges || options.allowSkillRemoval)) {
      throw new Error("--apply-plan uses only authority sealed into the plan");
    }
  }
  if (command === "verify" && !["root", "module", "affected", "all"].includes(options.scope)) throw new Error("--scope must be root, module, affected, or all");
  if (command === "tooling") {
    if (!new Set(["plan", "install"]).has(options.subcommand)) throw new Error("tooling requires plan or install");
    if (!["development", "runtime", "build"].includes(options.dependencyKind)) throw new Error("--kind must be development, runtime, or build");
    if (!["preserve", "propose", "managed-block", "fail"].includes(options.scripts)) throw new Error("--scripts must be preserve, propose, managed-block, or fail");
    if (!["deny", "allow"].includes(options.lifecycleScripts)) throw new Error("--lifecycle-scripts must be deny or allow");
    if (!["update", "preserve"].includes(options.lockfile)) throw new Error("--lockfile must be update or preserve");
  }
  if (command === "skills" && options.subcommand !== "update") throw new Error("skills requires update");
  if (command === "restructure") {
    if (!new Set(["plan", "apply"]).has(options.subcommand)) throw new Error("restructure requires plan or apply");
    if (!["preserve", "feature-first", "layered", "hybrid"].includes(options.organization)) throw new Error("Unknown --organization value");
    if (!["preserve", "simple", "functional-core", "clean"].includes(options.style)) throw new Error("Unknown restructure --style value");
    if (!["rewrite", "report"].includes(options.imports)) throw new Error("--imports must be rewrite or report");
    if (!["co-locate", "mirror", "preserve"].includes(options.tests)) throw new Error("--tests must be co-locate, mirror, or preserve");
    if (!["exclude", "include-explicit"].includes(options.generated)) throw new Error("--generated must be exclude or include-explicit");
    if (!["worktree", "copy", "patch"].includes(options.checkpoint)) throw new Error("--checkpoint must be worktree, copy, or patch");
  }
  if (command === "align") {
    if (!new Set(["plan", "execute", "status", "resume"]).has(options.subcommand)) throw new Error("align requires plan, execute, status, or resume");
    if (!["simple", "functional-core", "clean"].includes(options.style)) throw new Error("Unknown align --style value");
    if (!["required", "allow-existing", "waive"].includes(options.characterization)) throw new Error("Unknown --characterization value");
    if (!["requirements-and-quality", "quality", "none"].includes(options.review)) throw new Error("--review must be requirements-and-quality, quality, or none");
    if (!["worktree", "copy", "patch"].includes(options.checkpoint)) throw new Error("--checkpoint must be worktree, copy, or patch");
  }
  if (command === "preset") {
    if (!new Set(["list", "status", "plan", "apply"]).has(options.subcommand)) throw new Error("preset requires list, status, plan, or apply");
    if (options.subcommand === "plan" && !options.presetExplicit) throw new Error("preset plan requires --preset <id>");
    if (options.preset && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.preset)) throw new Error("--preset must use lower-case kebab-case");
  }
}

export function parseArgs(argv) {
  const tokens = [...argv];
  let requestedCommand = "create";
  if (tokens[0] && COMMANDS.has(tokens[0])) requestedCommand = tokens.shift();
  const command = requestedCommand === "retrofit" ? "adopt" : requestedCommand;
  let subcommand;
  if (SUBCOMMANDS[command]) {
    if (tokens[0] && SUBCOMMANDS[command].has(tokens[0])) subcommand = tokens.shift();
    else subcommand = command === "skills" ? "update" : command === "tooling" ? "plan" : command === "restructure" ? "plan" : "plan";
  }
  const options = defaultsFor(command, subcommand);
  options.requestedCommand = requestedCommand;
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const [option, inlineValue] = splitOption(token);
    const valueFor = () => {
      if (inlineValue !== undefined) return inlineValue;
      const value = nextValue(tokens, index, option);
      index += 1;
      return value;
    };

    switch (option) {
      case "--project": case "-p": options.project = normalizeProject(valueFor()); break;
      case "--style": options.style = valueFor().toLowerCase(); break;
      case "--tdd": options.tdd = valueFor().toLowerCase(); break;
      case "--package-manager": case "--pm": options.packageManager = valueFor().toLowerCase(); break;
      case "--agents": options.agents = parseAgents(valueFor()); options.agentsExplicit = true; break;
      case "--preset": options.preset = valueFor().toLowerCase(); options.presetExplicit = true; break;
      case "--install": options.install = true; options.installExplicit = true; break;
      case "--no-install": options.install = false; options.installExplicit = true; break;
      case "--git": options.git = true; options.gitExplicit = true; break;
      case "--no-git": options.git = false; options.gitExplicit = true; break;
      case "--bootstrap": options.bootstrap = true; options.bootstrapExplicit = true; break;
      case "--no-bootstrap": options.bootstrap = false; options.bootstrapExplicit = true; break;
      case "--force": case "-f": options.force = true; break;
      case "--conflict": options.conflict = valueFor().toLowerCase(); break;
      case "--allow-dirty": options.allowDirty = true; break;
      case "--verify": options.verify = true; break;
      case "--docs": options.docs = true; break;
      case "--no-docs": options.docs = false; break;
      case "--tickets": options.tickets = true; break;
      case "--no-tickets": options.tickets = false; break;
      case "--current-ticket": options.currentTicket = valueFor(); break;
      case "--current-status": options.currentStatus = valueFor().toLowerCase(); break;
      case "--trust-current-dependencies": options.trustCurrentDependencies = true; break;
      case "--plan-out": {
        if (command === "upgrade" && inlineValue === undefined && (tokens[index + 1] === undefined || tokens[index + 1].startsWith("-"))) {
          options.planOut = true;
        } else {
          options.planOut = valueFor();
        }
        break;
      }
      case "--apply-plan": options.applyPlan = valueFor(); break;
      case "--workspace": options.workspace = valueFor().toLowerCase(); break;
      case "--nested-instructions": options.nestedInstructions = valueFor().toLowerCase(); break;
      case "--module": push(options, "modules", valueFor()); break;
      case "--scope": options.scope = valueFor().toLowerCase(); break;
      case "--concurrency": options.concurrency = integer(valueFor(), option); break;
      case "--affected-from": options.affectedFrom = valueFor(); break;
      case "--timeout": options.timeout = integer(valueFor(), option); break;
      case "--pack": push(options, "packs", valueFor()); break;
      case "--dependency": push(options, "dependencies", valueFor()); break;
      case "--kind": options.dependencyKind = valueFor().toLowerCase(); break;
      case "--scripts": options.scripts = valueFor().toLowerCase(); break;
      case "--allow-network": options.allowNetwork = true; break;
      case "--allow-runtime": options.allowRuntime = true; break;
      case "--lifecycle-scripts": options.lifecycleScripts = valueFor().toLowerCase(); break;
      case "--lockfile": options.lockfile = valueFor().toLowerCase(); break;
      case "--rollback-on-failure": options.rollbackOnFailure = true; break;
      case "--no-rollback-on-failure": options.rollbackOnFailure = false; break;
      case "--catalog": options.catalog = valueFor(); break;
      case "--incoming-root": options.incomingRoot = valueFor(); break;
      case "--to": options.to = valueFor(); break;
      case "--skill": push(options, "skills", valueFor()); break;
      case "--check": options.check = true; break;
      case "--allow-risky-tool-changes": options.allowRiskyToolChanges = true; break;
      case "--allow-skill-removal": options.allowSkillRemoval = true; break;
      case "--partial": options.partial = true; break;
      case "--organization": options.organization = valueFor().toLowerCase(); break;
      case "--imports": options.imports = valueFor().toLowerCase(); break;
      case "--tests": options.tests = valueFor().toLowerCase(); break;
      case "--generated": options.generated = valueFor().toLowerCase(); break;
      case "--checkpoint": options.checkpoint = valueFor().toLowerCase(); break;
      case "--move": push(options, "moves", valueFor()); break;
      case "--use-case": options.useCase = valueFor(); break;
      case "--executor": options.executor = valueFor(); break;
      case "--executor-command": options.executorCommand = valueFor(); break;
      case "--executor-arg": push(options, "executorArgs", valueFor()); break;
      case "--max-files": options.maxFiles = integer(valueFor(), option); break;
      case "--max-diff-lines": options.maxDiffLines = integer(valueFor(), option); break;
      case "--characterization": options.characterization = valueFor().toLowerCase(); break;
      case "--characterization-reason": options.characterizationReason = valueFor(); break;
      case "--review": options.review = valueFor().toLowerCase(); break;
      case "--allowed-path": push(options, "allowedPaths", valueFor()); break;
      case "--nested-plan": push(options, "nestedPlans", { path: valueFor() }); break;
      case "--plan-id": options.planId = valueFor(); break;
      case "--skip-verification": options.skipVerification = true; break;
      case "--skip-final-verification": options.skipFinalVerification = true; break;
      case "--dry-run": options.dryRun = true; break;
      case "--yes": case "-y": options.yes = true; break;
      case "--json": options.json = true; break;
      case "--help": case "-h": options.help = true; break;
      case "--version": case "-v": options.version = true; break;
      default: throw new Error(`Unknown option: ${option}`);
    }
  }

  if (positionals.length > 1) throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(" ")}`);
  options.target = positionals[0];
  if (command === "create") validateCreate(options);
  else if (["adopt", "inspect"].includes(command)) validateAdopt(options);
  else validateAdvanced(command, options);
  return { command, subcommand, options };
}

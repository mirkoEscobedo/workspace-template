import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverWorkspace } from "../workspace/discover.js";
import { inventoryModule } from "../restructure/inventory.js";

const EFFECT_PATTERNS = [
  ["database", /\b(?:sql|query|execute|repository|database|db\.|prisma|sequelize|diesel|sqlx|jdbc|room)\b/i],
  ["http", /\b(?:fetch\s*\(|axios|http\.|https\.|reqwest|dio\.|HttpClient|request\s*\()/i],
  ["filesystem", /\b(?:readFile|writeFile|fs\.|File\s*\(|std::fs|openSync|path_provider)\b/i],
  ["clock", /\b(?:Date\.now|new Date\s*\(|Instant::now|SystemTime::now|DateTime\.now)\b/],
  ["randomness", /\b(?:Math\.random|rand::|thread_rng|Random\s*\()/],
  ["environment", /\b(?:process\.env|std::env|Platform\.environment|dotenv)\b/],
  ["queue", /\b(?:publish|subscribe|nats|kafka|rabbit|sqs|queue|eventBus)\b/i],
  ["logging", /\b(?:console\.|tracing::|log::|logger\.|print\s*\()/],
  ["transaction", /\b(?:transaction|beginTransaction|commit\s*\(|rollback\s*\()/i],
];

function sourceLocations(text, pattern) {
  const output = [];
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) output.push({ line: index + 1, excerpt: lines[index].trim().slice(0, 180) });
    pattern.lastIndex = 0;
  }
  return output;
}

function candidateKind(file) {
  const lower = file.path.toLowerCase();
  if (/(controller|route|handler|screen|widget|page)/.test(lower)) return "delivery";
  if (/(service|use.?case|command|query|interactor)/.test(lower)) return "use-case";
  if (/(policy|rules?|domain|entity|model)/.test(lower)) return "policy";
  return undefined;
}

export async function assessArchitecture(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const workspace = options.workspaceSnapshot ?? await discoverWorkspace(root, { includeOpaque: true });
  const requested = new Set(options.modules ?? []);
  const modules = workspace.modules.filter((module) => requested.size === 0 || requested.has(module.id) || requested.has(module.path));
  if (modules.length === 0) throw new Error("No supported module selected for architecture assessment");
  const findings = [];
  const candidates = [];
  const seams = [];

  for (const module of modules) {
    const inventory = await inventoryModule(root, module);
    for (const file of inventory.files.filter((item) => item.source && !item.generated)) {
      const text = await readFile(path.resolve(root, file.path), "utf8");
      const lineCount = text.split(/\r?\n/).length;
      const effects = [];
      for (const [effect, pattern] of EFFECT_PATTERNS) {
        const locations = sourceLocations(text, pattern);
        if (locations.length > 0) {
          effects.push(effect);
          findings.push({
            id: `${module.id}:${file.path}:${effect}`,
            moduleId: module.id,
            file: file.path,
            kind: "effect",
            effect,
            confidence: effect === "logging" ? "medium" : "high",
            locations: locations.slice(0, 20),
            rationale: `${effect} indicator appears in source`,
          });
        }
      }
      if (lineCount >= (options.largeFileLines ?? 500)) {
        findings.push({ id: `${module.id}:${file.path}:large`, moduleId: module.id, file: file.path, kind: "mixed-responsibility-candidate", confidence: "medium", lineCount, rationale: `file has ${lineCount} lines` });
      }
      if (["domain", "policy"].includes(file.role) && effects.some((effect) => !["logging"].includes(effect))) {
        findings.push({ id: `${module.id}:${file.path}:policy-effects`, moduleId: module.id, file: file.path, kind: "effect-leakage", confidence: "medium", effects, rationale: "domain/policy-named file directly references effect indicators" });
      }
      const kind = candidateKind(file);
      if (kind) candidates.push({ moduleId: module.id, file: file.path, kind, effects, lineCount, confidence: kind === "use-case" ? "high" : "medium" });
      if (file.test) seams.push({ moduleId: module.id, file: file.path, kind: "test-file", confidence: "high" });
      if (/\b(?:export\s+(?:async\s+)?function|export\s+class|pub\s+(?:async\s+)?fn|class\s+\w+|Widget\s+build)\b/.test(text)) {
        seams.push({ moduleId: module.id, file: file.path, kind: "public-code-seam", confidence: "medium" });
      }
    }
  }

  findings.sort((left, right) => left.file.localeCompare(right.file) || left.kind.localeCompare(right.kind));
  candidates.sort((left, right) => left.file.localeCompare(right.file));
  seams.sort((left, right) => left.file.localeCompare(right.file));
  return {
    version: 1,
    root,
    workspaceFingerprint: workspace.fingerprint,
    modules: modules.map((module) => ({ id: module.id, path: module.path, project: module.project })),
    findings,
    candidates,
    seams,
    summary: {
      findingCount: findings.length,
      effectCounts: Object.fromEntries(EFFECT_PATTERNS.map(([effect]) => [effect, findings.filter((item) => item.effect === effect).length])),
      useCaseCandidates: candidates.filter((item) => item.kind === "use-case").length,
      testSeams: seams.filter((item) => item.kind === "test-file").length,
    },
    limitations: [
      "Findings are source-located heuristics and require review; they are not claims of architectural conformance.",
      "Dynamic dispatch, generated code, macros, reflection, and runtime dependency injection may require manual analysis.",
    ],
  };
}

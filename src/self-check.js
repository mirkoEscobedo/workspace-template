import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { exists, listFiles, toPosixPath } from "./fs-utils.js";
import { validateSkillTree } from "./doctor.js";
import { PACKAGE_VERSION } from "./constants.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

if (packageJson.version !== PACKAGE_VERSION) {
  fail(`package.json version ${packageJson.version} != constants ${PACKAGE_VERSION}`);
}

for (const required of ["assets", "bin", "docs", "scripts", "src"]) {
  if (!packageJson.files?.includes(required)) {
    fail(`package.json files must include '${required}' in the published tarball`);
  }
}

const expectedRepositorySkills = [
  "compile-master-plan",
  "diagnose",
  "execute-frontier",
  "frontier-loop",
  "implementation-style",
  "integrate-wave",
  "process-lifecycle",
  "repair-ticket",
  "retrofit-agent-docs",
  "retrofit-ticket-pack",
  "tdd",
  "test-topology",
  "ticket-implementer",
  "ticket-review",
  "verify",
  "wayfinder",
  "write-skill",
];

const repositorySkillReport = await validateSkillTree(path.join(root, "assets", "skills"));
failures.push(...repositorySkillReport.errors);
warnings.push(...repositorySkillReport.warnings);
const actualRepositorySkills = repositorySkillReport.skills.map((item) => item.name).sort();
if (JSON.stringify(actualRepositorySkills) !== JSON.stringify(expectedRepositorySkills)) {
  fail(`repository skill catalog differs from the expected ${PACKAGE_VERSION} catalog: ${actualRepositorySkills.join(", ")}`);
}

async function syntaxCheck(directory) {
  for (const file of await listFiles(path.join(root, directory))) {
    if (!file.endsWith(".js")) continue;
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) fail(`${path.relative(root, file)}: ${result.stderr.trim()}`);
  }
}

for (const directory of ["src", "bin", "scripts", "test"]) await syntaxCheck(directory);

const IMPORT_DECLARATION_RE = /^\s*(?:import(?:\s+[^\n;]*?\s+from)?|export\s+[^\n;]*?\s+from)\s*["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
async function resolveInternalImport(importer, specifier) {
  if (!specifier.startsWith(".")) return true;
  const withoutSuffix = specifier.split(/[?#]/, 1)[0];
  const candidate = path.resolve(path.dirname(importer), withoutSuffix);
  const candidates = path.extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.js`, path.join(candidate, "index.js")];
  return (await Promise.all(candidates.map(exists))).some(Boolean);
}

for (const file of await listFiles(path.join(root, "src"))) {
  if (!file.endsWith(".js") || file.includes(`${path.sep}scaffolds${path.sep}`) || file.endsWith(`${path.sep}self-check.js`)) continue;
  const source = await readFile(file, "utf8");
  for (const pattern of [IMPORT_DECLARATION_RE, DYNAMIC_IMPORT_RE]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!(await resolveInternalImport(file, specifier))) {
        fail(`${toPosixPath(path.relative(root, file))}: unresolved local import '${specifier}'`);
      }
    }
  }
}

const pythonFiles = (await listFiles(path.join(root, "assets", "scripts"))).filter((file) => file.endsWith(".py"));
const pythonExecutable = ["python3", "python"].find((candidate) => {
  const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
  return result.status === 0;
});
if (!pythonExecutable) {
  warn("Python is unavailable; bundled Python scripts were inspected for imports but not syntax-parsed");
}
for (const file of pythonFiles) {
  const source = await readFile(file, "utf8");
  if (/^\s*(?:from\s+yaml\b|import\s+yaml\b)/m.test(source)) {
    fail(`${toPosixPath(path.relative(root, file))}: runtime PyYAML import is forbidden; use _mini_yaml`);
  }
  if (pythonExecutable) {
    const result = spawnSync(pythonExecutable, [
      "-B",
      "-c",
      "import ast, pathlib, sys; p=pathlib.Path(sys.argv[1]); ast.parse(p.read_text(encoding='utf-8'), filename=str(p))",
      file,
    ], { encoding: "utf8" });
    if (result.status !== 0) fail(`${toPosixPath(path.relative(root, file))}: Python syntax error: ${(result.stderr || result.stdout).trim()}`);
  }
}

for (const [relative, requiredFragments] of Object.entries({
  "assets/configs/codex/config.toml": [
    'model = "preset-rendered"',
    'model_reasoning_effort = "high"',
    'default_subagent_model = "preset-rendered"',
    'default_subagent_reasoning_effort = "high"',
    "max_concurrent_threads_per_session = 3",
  ],
  "assets/configs/opencode/opencode.json": [
    '"frontier-orchestrator"',
    '"preset-rendered"',
  ],
})) {
  const absolute = path.join(root, relative);
  if (!(await exists(absolute))) {
    fail(`missing harness configuration: ${relative}`);
    continue;
  }
  const content = await readFile(absolute, "utf8");
  for (const fragment of requiredFragments) {
    if (!content.includes(fragment)) fail(`${relative}: missing required model-routing fragment ${fragment}`);
  }
  if (relative.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (error) {
      fail(`${relative}: invalid JSON (${error.message})`);
    }
  }
}

for (const relative of [
  "docs/guides/frontier-loop-user-guide.html",
  "docs/plans/0.6.0-existing-repository-retrofitting-plan.md",
  "scripts/packed-smoke.js",
]) {
  if (!(await exists(path.join(root, relative)))) fail(`missing release artifact in source tree: ${relative}`);
}

const obsoleteDrafts = [
  "src/align/status.js",
  "src/align/executors/command.js",
  "src/align/executors/manual.js",
  "src/restructure/parsers.js",
  "src/restructure/resolve.js",
  "src/plans/io.js",
];
for (const relative of obsoleteDrafts) {
  if (await exists(path.join(root, relative))) fail(`obsolete draft module still exists: ${relative}`);
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Self-check passed: ${repositorySkillReport.skills.length} repository skills, source/script syntax, imports, harness defaults, release assets, and Python fallbacks validated.`);
}

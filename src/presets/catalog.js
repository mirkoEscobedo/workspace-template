import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  exists,
  hashText,
  listFiles,
  readJson,
  toPosixPath,
} from "../fs-utils.js";

export const DEFAULT_PRESET_ID = "sol-only";
export const LEGACY_PRESET_ID = "sol-codex";
export const PRESET_ROLES = Object.freeze([
  "coordinator",
  "planner",
  "scout",
  "implementer",
  "reviewer-spec",
  "reviewer-code",
  "reviewer-ops",
  "repairer",
  "integrator",
]);
export const PRESET_TARGETS = Object.freeze(["codex", "opencode"]);
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const presetAssetsRoot = path.join(sourceRoot, "assets", "presets");
export const builtInPresetAssetsRoot = path.join(presetAssetsRoot, "builtin");

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

export function validatePreset(value, source = "<preset>", options = {}) {
  assertPlainObject(value, source);
  const topLevelKeys = new Set([
    "$schema",
    "version",
    "id",
    "description",
    "stability",
    "models",
    "roles",
  ]);
  if (options.allowLoaderMetadata) {
    for (const key of ["source", "path", "relativePath", "fingerprint"]) topLevelKeys.add(key);
  }
  const extraKeys = Object.keys(value).filter((key) => !topLevelKeys.has(key));
  if (extraKeys.length > 0) throw new Error(`${source}: unsupported field(s): ${extraKeys.join(", ")}`);
  if (value.version !== 1) throw new Error(`${source}: version must be 1`);
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) throw new Error(`${source}: id must use lower-case kebab-case`);
  if (typeof value.description !== "string" || !value.description.trim()) throw new Error(`${source}: description is required`);
  if (!["stable", "experimental"].includes(value.stability)) throw new Error(`${source}: stability must be stable or experimental`);
  assertPlainObject(value.models, `${source}: models`);
  if (Object.keys(value.models).length === 0) throw new Error(`${source}: at least one model alias is required`);
  for (const [alias, model] of Object.entries(value.models)) {
    if (!ID_PATTERN.test(alias)) throw new Error(`${source}: model alias '${alias}' must use lower-case kebab-case`);
    assertPlainObject(model, `${source}: models.${alias}`);
    const modelKeys = Object.keys(model).filter((key) => !["reasoningEffort", "targets"].includes(key));
    if (modelKeys.length > 0) throw new Error(`${source}: models.${alias} has unsupported field(s): ${modelKeys.join(", ")}`);
    if (!REASONING_EFFORTS.has(model.reasoningEffort)) throw new Error(`${source}: models.${alias}.reasoningEffort is invalid`);
    assertPlainObject(model.targets, `${source}: models.${alias}.targets`);
    if (Object.keys(model.targets).length === 0) throw new Error(`${source}: models.${alias}.targets must not be empty`);
    for (const [target, id] of Object.entries(model.targets)) {
      if (!PRESET_TARGETS.includes(target)) throw new Error(`${source}: models.${alias}.targets.${target} is unsupported`);
      if (typeof id !== "string" || !id.trim()) throw new Error(`${source}: models.${alias}.targets.${target} is required`);
    }
  }
  assertPlainObject(value.roles, `${source}: roles`);
  const unknown = Object.keys(value.roles).filter((role) => !PRESET_ROLES.includes(role));
  if (unknown.length > 0) throw new Error(`${source}: unknown role(s): ${unknown.join(", ")}`);
  for (const role of PRESET_ROLES) {
    const alias = value.roles[role];
    if (typeof alias !== "string" || !Object.hasOwn(value.models, alias)) {
      throw new Error(`${source}: role '${role}' must reference a declared model alias`);
    }
  }
  return structuredClone(value);
}

async function loadPresetDirectory(directory, sourceKind) {
  const output = [];
  for (const file of await listFiles(directory)) {
    if (path.extname(file).toLowerCase() !== ".json") continue;
    const relative = toPosixPath(path.relative(directory, file));
    const preset = validatePreset(await readJson(file), file);
    output.push({
      ...preset,
      source: sourceKind,
      path: file,
      relativePath: relative,
      fingerprint: hashText(canonicalJson(preset)),
    });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadBuiltInPresets() {
  return loadPresetDirectory(builtInPresetAssetsRoot, "builtin");
}

export async function loadPresetCatalog(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const installedBuiltIns = path.join(root, ".agentic", "presets", "builtin");
  const builtIns = (await exists(installedBuiltIns))
    ? await loadPresetDirectory(installedBuiltIns, "builtin")
    : await loadBuiltInPresets();
  const local = await loadPresetDirectory(path.join(root, ".agentic", "presets", "local"), "local");
  const byId = new Map();
  for (const preset of [...builtIns, ...local]) {
    if (byId.has(preset.id)) {
      const other = byId.get(preset.id);
      throw new Error(`Duplicate preset id '${preset.id}' in ${other.path} and ${preset.path}`);
    }
    byId.set(preset.id, preset);
  }
  if (!options.allowEmpty && byId.size === 0) throw new Error(`No agent presets found under ${root}`);
  return { root, presets: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)), byId };
}

export function resolvePreset(preset, agentTargets = PRESET_TARGETS) {
  const validated = validatePreset(preset, preset.path ?? preset.id ?? "<preset>", { allowLoaderMetadata: true });
  const targets = [...new Set(agentTargets.filter((target) => PRESET_TARGETS.includes(target)))];
  const roles = {};
  for (const role of PRESET_ROLES) {
    const alias = validated.roles[role];
    const definition = validated.models[alias];
    for (const target of targets) {
      if (!definition.targets[target]) throw new Error(`Preset '${validated.id}' role '${role}' has no ${target} model binding`);
    }
    roles[role] = {
      alias,
      reasoningEffort: definition.reasoningEffort,
      targets: Object.fromEntries(targets.map((target) => [target, definition.targets[target]])),
    };
  }
  return {
    id: validated.id,
    source: preset.source ?? "builtin",
    fingerprint: preset.fingerprint ?? hashText(canonicalJson(validated)),
    description: validated.description,
    stability: validated.stability,
    roles,
  };
}

export async function selectPreset(root, id, agentTargets, options = {}) {
  const catalog = options.catalog ?? await loadPresetCatalog(root, { allowEmpty: options.allowEmpty });
  const selected = catalog.byId.get(id);
  if (!selected) throw new Error(`Unknown preset '${id}'. Available presets: ${catalog.presets.map((item) => item.id).join(", ")}`);
  return { catalog, preset: selected, resolved: resolvePreset(selected, agentTargets) };
}

export async function presetCatalogArtifacts() {
  const artifacts = [{
    path: ".agentic/presets/preset.schema.json",
    content: await readFile(path.join(presetAssetsRoot, "preset.schema.json")),
  }];
  for (const file of await listFiles(builtInPresetAssetsRoot)) {
    artifacts.push({
      path: toPosixPath(path.posix.join(".agentic/presets/builtin", path.relative(builtInPresetAssetsRoot, file))),
      content: await readFile(file),
    });
  }
  artifacts.push({
    path: ".agentic/presets/local/README.md",
    content: Buffer.from("# Local agent presets\n\nAdd versioned repository-owned routing presets here. Built-in IDs may not be shadowed.\n"),
  });
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

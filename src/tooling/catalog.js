import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(moduleDirectory, "..", "..", "assets", "tooling-packs", "catalog.json");

export async function loadToolingCatalog(customPath) {
  const raw = await readFile(customPath ? path.resolve(customPath) : catalogPath, "utf8");
  const catalog = JSON.parse(raw);
  if (catalog.version !== 1 || !catalog.packs || typeof catalog.packs !== "object") throw new Error("Invalid tooling catalog");
  return catalog;
}

export function resolvePacks(catalog, names, project) {
  const dependencies = new Map();
  const scripts = {};
  const selected = [];
  const warnings = [];
  const configs = new Map();
  for (const name of names) {
    const pack = catalog.packs[name];
    if (!pack) throw new Error(`Unknown tooling pack '${name}'`);
    const entry = pack.projects?.[project];
    if (!entry) {
      warnings.push(`Pack '${name}' does not apply to ${project}`);
      continue;
    }
    selected.push(name);
    for (const dependency of entry.dependencies ?? []) {
      const current = dependencies.get(dependency.name);
      if (current && current.kind !== dependency.kind) throw new Error(`Tooling packs disagree about dependency kind for ${dependency.name}`);
      dependencies.set(dependency.name, { ...dependency, reason: `tooling pack ${name}` });
    }
    for (const [script, command] of Object.entries(entry.scripts ?? {})) {
      if (scripts[script] && scripts[script] !== command) throw new Error(`Tooling packs disagree about script '${script}'`);
      scripts[script] = command;
    }
    for (const config of entry.configs ?? []) {
      const current = configs.get(config.path);
      if (!current) {
        configs.set(config.path, { ...config, patches: [...(config.patches ?? [])] });
        continue;
      }
      const byPath = new Map((current.patches ?? []).map((patch) => [patch.path, patch]));
      for (const patch of config.patches ?? []) {
        const existing = byPath.get(patch.path);
        if (existing && JSON.stringify(existing.value) !== JSON.stringify(patch.value)) {
          throw new Error(`Tooling packs disagree about config '${config.path}' at '${patch.path}'`);
        }
        if (!existing) current.patches.push(patch);
      }
    }
  }
  return {
    selected,
    dependencies: [...dependencies.values()].sort((a, b) => a.name.localeCompare(b.name)),
    scripts,
    configs: [...configs.values()].map((config) => ({ ...config, patches: [...config.patches].sort((a, b) => a.path.localeCompare(b.path)) })).sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
  };
}

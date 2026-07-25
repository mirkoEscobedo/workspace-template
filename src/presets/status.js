import path from "node:path";
import { exists, hashFile, readJson } from "../fs-utils.js";
import { loadPresetCatalog, resolvePreset } from "./catalog.js";
import { renderCodexArtifacts, renderOpenCodeArtifacts } from "./render.js";

export async function listPresets(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const catalog = await loadPresetCatalog(root);
  const config = (await exists(path.join(root, ".agentic", "config.json")))
    ? await readJson(path.join(root, ".agentic", "config.json"))
    : undefined;
  const activeId = config?.execution?.preset?.id ?? null;
  return {
    root,
    activeId,
    presets: catalog.presets.map((preset) => ({
      id: preset.id,
      description: preset.description,
      stability: preset.stability,
      source: preset.source,
      fingerprint: preset.fingerprint,
      active: preset.id === activeId,
    })),
  };
}

export async function presetStatus(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const configPath = path.join(root, ".agentic", "config.json");
  if (!(await exists(configPath))) return { root, status: "invalid", errors: ["missing .agentic/config.json"], overrides: [] };
  const config = await readJson(configPath);
  const state = config.execution?.preset;
  if (!state?.id) return { root, status: "invalid", errors: ["active preset state is missing"], overrides: [] };
  let catalog;
  try {
    catalog = await loadPresetCatalog(root);
  } catch (error) {
    return { root, activeId: state.id, status: "invalid", errors: [error.message], overrides: state.overrides ?? [] };
  }
  const definition = catalog.byId.get(state.id);
  if (!definition) return { root, activeId: state.id, status: "invalid", errors: [`preset '${state.id}' is not installed`], overrides: state.overrides ?? [] };
  const resolved = resolvePreset(definition, config.agentTargets ?? []);
  const errors = [];
  if (resolved.fingerprint !== state.fingerprint) errors.push("active preset definition fingerprint changed");
  const expected = [];
  if ((config.agentTargets ?? []).includes("codex")) expected.push(...await renderCodexArtifacts(resolved, state.roleIds));
  if ((config.agentTargets ?? []).includes("opencode")) expected.push(...await renderOpenCodeArtifacts(resolved, state.roleIds));
  const managed = await readJson(path.join(root, ".agentic", "managed-files.json"));
  for (const artifact of expected) {
    if (!managed.files?.[artifact.path]) continue;
    const target = path.join(root, ...artifact.path.split("/"));
    if (!(await exists(target))) errors.push(`missing managed harness file ${artifact.path}`);
    else if (await hashFile(target) !== managed.files[artifact.path].hash) errors.push(`managed harness drift: ${artifact.path}`);
  }
  const status = errors.length > 0 ? "drifted" : (state.overrides ?? []).length > 0 ? "partial" : "active";
  return { root, activeId: state.id, status, fingerprint: state.fingerprint, overrides: state.overrides ?? [], errors };
}

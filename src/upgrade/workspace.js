import path from "node:path";
import { readJsonIfExists } from "../fs-utils.js";

function mergeCommands(fallback = {}, preferred = {}) {
  const merged = { ...fallback, ...preferred };
  if ((fallback.fullSteps?.length ?? 0) > 0 && (preferred.fullSteps?.length ?? 0) === 0) {
    merged.fullSteps = fallback.fullSteps;
    merged.full = fallback.full;
  }
  return merged;
}

export async function loadEffectiveUpgradeWorkspace(root, discoveredWorkspace, options = {}) {
  const effective = structuredClone(
    await readJsonIfExists(path.join(root, ".agentic", "workspace.json"))
      ?? discoveredWorkspace,
  );
  if (options.mergeDiscovered) {
    effective.modules ??= [];
    const discoveredModules = discoveredWorkspace?.modules ?? [];
    for (const discovered of discoveredModules) {
      const persisted = effective.modules?.find((module) =>
        module.id === discovered.id || module.path === discovered.path);
      if (persisted) {
        persisted.commands = mergeCommands(discovered.commands, persisted.commands);
      } else {
        effective.modules.push(structuredClone(discovered));
      }
    }
    for (const module of effective.modules) module.dependencies ??= [];
    if (effective.rootModule) effective.rootModule.dependencies ??= [];
  }
  for (const module of effective?.modules ?? []) {
    const commands = await readJsonIfExists(path.join(
      root,
      ".agentic",
      "modules",
      module.id,
      "commands.json",
    ));
    if (commands) module.commands = mergeCommands(module.commands, commands);
  }
  if (options.mergeDiscovered && effective?.rootModule && discoveredWorkspace?.rootModule) {
    effective.rootModule.commands = mergeCommands(
      discoveredWorkspace.rootModule.commands,
      effective.rootModule.commands,
    );
  }
  if (effective) {
    if (options.mergeDiscovered) {
      effective.conflicts = [...new Set([
        ...(effective.conflicts ?? []),
        ...(discoveredWorkspace?.conflicts ?? []),
      ])];
      effective.warnings = [...new Set([
        ...(effective.warnings ?? []),
        ...(discoveredWorkspace?.warnings ?? []),
      ])];
    }
    Object.defineProperty(effective, "canUse", {
      value: (effective.conflicts ?? []).length === 0,
      enumerable: false,
    });
  }
  return effective;
}

import { runCommandCapture } from "../process-utils.js";
import { toPosixPath } from "../fs-utils.js";
import { transitiveDependents } from "./graph.js";

export function owningModules(workspace, changedPaths) {
  const modules = [...workspace.modules].sort((a, b) => b.path.length - a.path.length);
  const owners = new Set();
  for (const raw of changedPaths) {
    const changed = toPosixPath(raw).replace(/^\.\//, "");
    const owner = modules.find((module) => module.path === "." || changed === module.path || changed.startsWith(`${module.path}/`));
    if (owner) owners.add(owner.id);
    else for (const module of workspace.modules) owners.add(module.id);
  }
  return owners;
}

export function includeDependents(workspace, selected) {
  return transitiveDependents(workspace.modules, selected);
}

export function changedPathsFromGit(root, ref) {
  const args = ref ? ["diff", "--name-only", `${ref}...HEAD`] : ["status", "--porcelain", "--untracked-files=all"];
  const result = runCommandCapture("git", args, { cwd: root });
  if (result.status !== 0) throw new Error(`Unable to determine changed paths: ${result.stderr || result.stdout}`);
  if (ref) return result.stdout.split(/\r?\n/).filter(Boolean);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).map((value) => value.includes(" -> ") ? value.split(" -> ").at(-1) : value);
}

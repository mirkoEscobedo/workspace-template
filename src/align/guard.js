import { readFile } from "node:fs/promises";
import path from "node:path";
import { exists, hashFile, listFiles, toPosixPath } from "../fs-utils.js";

const EXCLUDED = [
  ".git/",
  ".agentic/transactions/",
  ".agentic/migrations/",
  ".agentic/reports/",
  ".agentic/plans/",
  "node_modules/",
  "target/",
  "build/",
  "dist/",
];

export async function snapshotTree(root) {
  const files = {};
  for (const file of await listFiles(root)) {
    const relative = toPosixPath(path.relative(root, file));
    if (EXCLUDED.some((prefix) => relative.startsWith(prefix))) continue;
    files[relative] = { hash: await hashFile(file), size: (await readFile(file)).length };
  }
  return files;
}

function lineCount(buffer) {
  if (!buffer) return 0;
  return buffer.toString("utf8").split(/\r?\n/).length;
}

export async function diffTree(root, before) {
  const after = await snapshotTree(root);
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changed = [];
  let diffLines = 0;
  for (const relative of paths) {
    if (before[relative]?.hash === after[relative]?.hash) continue;
    const absolute = path.resolve(root, relative);
    const current = await exists(absolute) ? await readFile(absolute) : null;
    diffLines += (before[relative] ? Math.max(1, Math.round(before[relative].size / 80)) : 0) + lineCount(current);
    changed.push({ path: relative, before: before[relative] ?? null, after: after[relative] ?? null });
  }
  return { changed, diffLines };
}

function pathAllowed(relative, allowedPaths) {
  return allowedPaths.some((allowed) => relative === allowed || relative.startsWith(`${allowed.replace(/\/$/, "")}/`) || allowed.endsWith("/**") && relative.startsWith(allowed.slice(0, -3)));
}

export function validateAlignmentDiff(diff, plan) {
  const errors = [];
  const changedPaths = diff.changed.map((item) => item.path);
  const disallowed = changedPaths.filter((relative) => !pathAllowed(relative, plan.alignment.allowedPaths));
  if (disallowed.length > 0) errors.push(`Executor changed paths outside the approved scope: ${disallowed.join(", ")}`);
  if (changedPaths.length > plan.alignment.changeBudget.maxFiles) errors.push(`Executor changed ${changedPaths.length} files; budget is ${plan.alignment.changeBudget.maxFiles}`);
  if (diff.diffLines > plan.alignment.changeBudget.maxDiffLines) errors.push(`Executor changed approximately ${diff.diffLines} lines; budget is ${plan.alignment.changeBudget.maxDiffLines}`);
  const manifestChanges = changedPaths.filter((relative) => /(^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.toml|Cargo\.lock|pubspec\.yaml|pubspec\.lock)$/.test(relative));
  if (manifestChanges.length > 0) errors.push(`Executor changed dependency manifests or lockfiles without an approved nested tooling plan: ${manifestChanges.join(", ")}`);
  return { ok: errors.length === 0, errors, changedPaths, diffLines: diff.diffLines };
}

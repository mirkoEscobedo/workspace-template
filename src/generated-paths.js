import { access, lstat } from "node:fs/promises";
import path from "node:path";

export const GENERATED_CACHE_DIRECTORY_NAMES = Object.freeze([
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

const ALWAYS_GENERATED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".dart_tool",
  ".pub",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  ...GENERATED_CACHE_DIRECTORY_NAMES,
]);

const MODULE_OUTPUT_MARKERS = new Map([
  ["target", ["Cargo.toml"]],
  ["build", ["package.json", "pyproject.toml", "pubspec.yaml"]],
  ["coverage", ["package.json"]],
  ["dist", ["package.json", "pyproject.toml"]],
  [".next", ["package.json"]],
  [".nuxt", ["package.json"]],
  [".turbo", ["package.json"]],
]);

export const GENERATED_DIRECTORY_POLICY_NAMES = Object.freeze([
  ...new Set([
    ...ALWAYS_GENERATED_DIRECTORY_NAMES,
    ...MODULE_OUTPUT_MARKERS.keys(),
  ]),
]);

async function containsMarker(directory, markers) {
  for (const marker of markers) {
    try {
      await access(path.join(directory, marker));
      return true;
    } catch {
      // Try the next supported module marker.
    }
  }
  return false;
}

export async function isGeneratedDirectory(directory) {
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) return false;
  const name = path.basename(directory);
  if (ALWAYS_GENERATED_DIRECTORY_NAMES.has(name)) return true;
  const markers = MODULE_OUTPUT_MARKERS.get(name);
  return markers ? containsMarker(path.dirname(directory), markers) : false;
}

export function isGeneratedCachePath(value) {
  const components = String(value).split(/[\\/]+/u);
  return components.some((component) => GENERATED_CACHE_DIRECTORY_NAMES.includes(component))
    || /\.py[co]$/iu.test(components.at(-1) ?? "");
}

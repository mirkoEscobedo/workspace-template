import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { exists, hashFile, toPosixPath } from "../fs-utils.js";

const EXCLUDED = new Set([".git", ".agentic", "node_modules", "target", "build", "dist", "coverage", ".dart_tool"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".rs", ".dart"]);
const TEST_PATTERN = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;
const GENERATED_PATTERN = /(?:\.g\.dart|\.freezed\.dart|\.generated\.|generated\/|gen\/)/i;

function classifyRole(relative) {
  const lower = relative.toLowerCase();
  if (/(?:controller|route|handler|screen|widget|view|page|delivery|ui)/.test(lower)) return "delivery";
  if (/(?:repository|adapter|gateway|client|database|db|http|filesystem|queue|infra)/.test(lower)) return "adapters";
  if (/(?:use[-_]?case|application|command|query|service)/.test(lower)) return "application";
  if (/(?:domain|entity|value[-_]?object|policy|rules?|model)/.test(lower)) return "domain";
  return "feature";
}

export async function inventoryModule(root, module) {
  const moduleRoot = path.resolve(root, module.path === "." ? "" : module.path);
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relativeRoot = toPosixPath(path.relative(root, absolute));
        const relativeModule = toPosixPath(path.relative(moduleRoot, absolute));
        const extension = path.extname(entry.name).toLowerCase();
        const generated = GENERATED_PATTERN.test(relativeModule);
        const test = TEST_PATTERN.test(relativeModule);
        const source = SOURCE_EXTENSIONS.has(extension);
        files.push({
          path: relativeRoot,
          modulePath: relativeModule,
          extension,
          source,
          test,
          generated,
          role: classifyRole(relativeModule),
          hash: await hashFile(absolute),
          size: (await readFile(absolute)).length,
        });
      }
    }
  }
  await walk(moduleRoot);
  return {
    moduleId: module.id,
    modulePath: module.path,
    project: module.project,
    packageName: module.name,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function inferLayoutMoves(inventory, options = {}) {
  const moves = [];
  const organization = options.organization ?? "preserve";
  if (organization === "preserve") return moves;
  for (const file of inventory.files) {
    if (!file.source || file.generated) continue;
    const segments = file.modulePath.split("/");
    const sourceRootIndex = segments.findIndex((segment) => ["src", "lib", "app"].includes(segment));
    if (sourceRootIndex === -1) continue;
    const sourceRoot = segments.slice(0, sourceRootIndex + 1).join("/");
    const after = segments.slice(sourceRootIndex + 1);
    if (after.length === 0) continue;
    const recognized = new Set(["domain", "application", "adapters", "delivery", "features", "feature"]);
    if (recognized.has(after[0])) continue;
    const role = file.role === "feature" ? "features" : file.role;
    const targetModule = `${sourceRoot}/${role}/${after.join("/")}`;
    const rootPrefix = inventory.modulePath === "." ? "" : `${inventory.modulePath}/`;
    const target = `${rootPrefix}${targetModule}`;
    if (target !== file.path) moves.push({ from: file.path, to: target, reason: `${organization} role inference: ${role}` });
  }
  return moves.sort((left, right) => left.from.localeCompare(right.from));
}

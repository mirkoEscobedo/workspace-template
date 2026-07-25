import path from "node:path";
import { applyTextRewrites, scanStringLiterals, toRelativeSpecifier } from "./shared.js";

function modulePath(relative) {
  const normalized = relative.replace(/^src\//, "").replace(/\.rs$/, "").replace(/\/mod$/, "");
  return normalized.split("/").filter(Boolean).join("::");
}

export function parseRustReferences(text) {
  const scan = scanStringLiterals(text);
  const references = [];
  for (const literal of scan.literals) {
    const prefix = text.slice(Math.max(0, literal.start - 100), literal.start);
    if (/#\s*\[\s*path\s*=\s*$/.test(prefix)) references.push({ ...literal, kind: "path-attribute", specifier: literal.value });
    else if (/\b(?:include|include_str|include_bytes)!\s*\(\s*$/.test(prefix)) references.push({ ...literal, kind: "include", specifier: literal.value });
  }
  const usePaths = [...text.matchAll(/\b(?:pub\s+)?use\s+crate::([A-Za-z0-9_:]+)\s*(?:;|\{)/g)].map((match) => ({ start: match.index + match[0].indexOf("crate::"), end: match.index + match[0].indexOf("crate::") + `crate::${match[1]}`.length, value: `crate::${match[1]}` }));
  return { references, usePaths, unsupported: scan.unsupported };
}

export async function planRustRewrites({ root, file, newFile, text, moveMap, moduleRoot }) {
  const parsed = parseRustReferences(text);
  const rewrites = [];
  for (const reference of parsed.references) {
    if (!reference.specifier.startsWith(".")) continue;
    const oldTarget = path.relative(root, path.resolve(path.dirname(path.resolve(root, file)), reference.specifier)).split(path.sep).join("/");
    const mappedTarget = moveMap.get(oldTarget) ?? oldTarget;
    const mappedSource = newFile ?? file;
    if (mappedTarget === oldTarget && mappedSource === file) continue;
    const next = toRelativeSpecifier(path.resolve(root, mappedSource), path.resolve(root, mappedTarget));
    rewrites.push({ start: reference.contentStart, end: reference.contentEnd, text: next, from: reference.specifier, to: next, target: mappedTarget });
  }
  const relativeMoveMap = new Map();
  for (const [from, to] of moveMap) {
    const prefix = moduleRoot === "." ? "" : `${moduleRoot}/`;
    if (!from.startsWith(`${prefix}src/`) || !to.startsWith(`${prefix}src/`)) continue;
    relativeMoveMap.set(modulePath(from.slice(prefix.length)), modulePath(to.slice(prefix.length)));
  }
  for (const usePath of parsed.usePaths) {
    for (const [fromModule, toModule] of relativeMoveMap) {
      const prefix = `crate::${fromModule}`;
      if (usePath.value === prefix || usePath.value.startsWith(`${prefix}::`)) {
        const next = `crate::${toModule}${usePath.value.slice(prefix.length)}`;
        rewrites.push({ start: usePath.start, end: usePath.end, text: next, from: usePath.value, to: next });
        break;
      }
    }
  }
  return { content: applyTextRewrites(text, rewrites), rewrites, unsupported: parsed.unsupported };
}

import path from "node:path";
import { applyTextRewrites, resolveRelativeReference, scanStringLiterals, toRelativeSpecifier } from "./shared.js";

const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];

function classifyLiteral(text, literal) {
  const prefix = text.slice(Math.max(0, literal.start - 180), literal.start).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*$/g, " ");
  if (/\b(?:from|import|export)\s*$/.test(prefix)) return "module";
  if (/\brequire\s*\(\s*$/.test(prefix)) return "require";
  if (/\bimport\s*\(\s*$/.test(prefix)) return "dynamic-import-literal";
  if (/\bnew\s+URL\s*\(\s*$/.test(prefix)) return "asset-url";
  return undefined;
}

export function parseJavaScriptReferences(text) {
  const scan = scanStringLiterals(text, { javascript: true });
  const references = [];
  for (const literal of scan.literals) {
    const kind = classifyLiteral(text, literal);
    if (kind) references.push({ ...literal, kind, specifier: literal.value, static: true });
  }
  const sanitized = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const unsupported = scan.unsupported.filter((item) => {
    if (item.kind !== "template-expression") return true;
    const prefix = sanitized.slice(Math.max(0, item.start - 80), item.start);
    return /(?:\bimport|\brequire|\bnew\s+URL)\s*\(\s*$/.test(prefix);
  });
  for (const match of sanitized.matchAll(/\b(?:import|require)\s*\(\s*(?!["'])/g)) {
    unsupported.push({ kind: "computed-module-reference", start: match.index, end: match.index + match[0].length });
  }
  return { references, unsupported };
}

export async function planJavaScriptRewrites({ root, file, newFile, text, moveMap }) {
  const parsed = parseJavaScriptReferences(text);
  const rewrites = [];
  for (const reference of parsed.references) {
    if (!reference.specifier.startsWith(".")) continue;
    const resolved = await resolveRelativeReference(path.resolve(root, file), reference.specifier, JS_EXTENSIONS);
    if (!resolved) continue;
    const oldTarget = path.relative(root, resolved).split(path.sep).join("/");
    const mappedTarget = moveMap.get(oldTarget) ?? oldTarget;
    const mappedSource = newFile ?? file;
    if (mappedTarget === oldTarget && mappedSource === file) continue;
    const hadExtension = /\.[a-z0-9]+$/i.test(reference.specifier);
    const next = toRelativeSpecifier(path.resolve(root, mappedSource), path.resolve(root, mappedTarget), {
      omitExtension: !hadExtension,
      preserveIndex: /\/index(?:\.[a-z0-9]+)?$/i.test(oldTarget) && !/\/index/.test(reference.specifier),
    });
    if (next !== reference.specifier) rewrites.push({ start: reference.contentStart, end: reference.contentEnd, text: next, from: reference.specifier, to: next, target: mappedTarget });
  }
  return { content: applyTextRewrites(text, rewrites), rewrites, unsupported: parsed.unsupported };
}

export function rewriteJsonPathValues(value, moveMap) {
  if (Array.isArray(value)) return value.map((item) => rewriteJsonPathValues(item, moveMap));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteJsonPathValues(item, moveMap)]));
  if (typeof value !== "string") return value;
  const normalized = value.replace(/^\.\//, "");
  const mapped = moveMap.get(normalized);
  if (!mapped) return value;
  return value.startsWith("./") ? `./${mapped}` : mapped;
}

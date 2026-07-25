import path from "node:path";
import { exists } from "../../fs-utils.js";

export function scanStringLiterals(text, options = {}) {
  const literals = [];
  const unsupported = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "/") {
      const end = text.indexOf("\n", index + 2);
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    if (char === "`" && options.javascript) {
      const start = index;
      index += 1;
      let interpolation = false;
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index] === "`" ) { index += 1; break; }
        else {
          if (text[index] === "$" && text[index + 1] === "{") interpolation = true;
          index += 1;
        }
      }
      if (interpolation) unsupported.push({ kind: "template-expression", start, end: index });
      continue;
    }
    if (char !== '"' && char !== "'") {
      index += 1;
      continue;
    }
    const quote = char;
    const start = index;
    index += 1;
    let value = "";
    let raw = "";
    let closed = false;
    while (index < text.length) {
      const current = text[index];
      if (current === "\\") {
        raw += current;
        if (index + 1 < text.length) {
          const escaped = text[index + 1];
          raw += escaped;
          const simple = { n: "\n", r: "\r", t: "\t", "\\": "\\", "\"": '"', "'": "'" };
          value += simple[escaped] ?? escaped;
          index += 2;
        } else index += 1;
      } else if (current === quote) {
        closed = true;
        index += 1;
        break;
      } else {
        raw += current;
        value += current;
        index += 1;
      }
    }
    if (!closed) {
      unsupported.push({ kind: "unterminated-string", start, end: index });
      break;
    }
    literals.push({ start, end: index, contentStart: start + 1, contentEnd: index - 1, quote, value, raw });
  }
  return { literals, unsupported };
}

export function applyTextRewrites(text, rewrites) {
  let output = text;
  for (const rewrite of [...rewrites].sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, rewrite.start)}${rewrite.text}${output.slice(rewrite.end)}`;
  }
  return output;
}

export function toRelativeSpecifier(fromFile, toFile, options = {}) {
  let relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  if (options.omitExtension) relative = relative.replace(/\.(?:[cm]?[jt]sx?|dart)$/i, "");
  if (options.preserveIndex) relative = relative.replace(/\/index$/i, "");
  return relative;
}

export async function resolveRelativeReference(sourceFile, specifier, candidates = []) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(sourceFile), specifier);
  const attempts = [base, ...candidates.map((suffix) => `${base}${suffix}`), ...candidates.map((suffix) => path.join(base, `index${suffix}`))];
  for (const attempt of attempts) if (await exists(attempt)) return attempt;
  return base;
}

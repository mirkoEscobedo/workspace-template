import path from "node:path";
import { applyTextRewrites, resolveRelativeReference, scanStringLiterals, toRelativeSpecifier } from "./shared.js";

function classify(text, literal) {
  const prefix = text.slice(Math.max(0, literal.start - 100), literal.start);
  const match = /\b(import|export|part(?:\s+of)?)\s*$/.exec(prefix);
  return match?.[1];
}

export function parseDartReferences(text) {
  const scan = scanStringLiterals(text);
  const references = [];
  for (const literal of scan.literals) {
    const kind = classify(text, literal);
    if (kind) references.push({ ...literal, kind, specifier: literal.value, static: true });
  }
  return { references, unsupported: scan.unsupported };
}

export async function planDartRewrites({ root, file, newFile, text, moveMap, packageName, moduleRoot }) {
  const parsed = parseDartReferences(text);
  const rewrites = [];
  for (const reference of parsed.references) {
    let oldTarget;
    if (reference.specifier.startsWith("package:") && packageName && reference.specifier.startsWith(`package:${packageName}/`)) {
      oldTarget = path.posix.join(moduleRoot, "lib", reference.specifier.slice(`package:${packageName}/`.length));
    } else if (reference.specifier.startsWith(".")) {
      const resolved = await resolveRelativeReference(path.resolve(root, file), reference.specifier, [".dart"]);
      oldTarget = path.relative(root, resolved).split(path.sep).join("/");
    } else continue;
    const mappedTarget = moveMap.get(oldTarget) ?? oldTarget;
    const mappedSource = newFile ?? file;
    if (mappedTarget === oldTarget && mappedSource === file) continue;
    let next;
    const libPrefix = path.posix.join(moduleRoot, "lib") + "/";
    if (reference.specifier.startsWith("package:") && mappedTarget.startsWith(libPrefix)) {
      next = `package:${packageName}/${mappedTarget.slice(libPrefix.length)}`;
    } else next = toRelativeSpecifier(path.resolve(root, mappedSource), path.resolve(root, mappedTarget));
    if (next !== reference.specifier) rewrites.push({ start: reference.contentStart, end: reference.contentEnd, text: next, from: reference.specifier, to: next, target: mappedTarget });
  }
  return { content: applyTextRewrites(text, rewrites), rewrites, unsupported: parsed.unsupported };
}

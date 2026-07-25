// Small, deliberately conservative readers for the limited manifest fragments used by
// workspace-template. They do not pretend to be general YAML/TOML parsers.

function stripInlineComment(line, marker) {
  let quote;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (!quote && char === marker) return line.slice(0, index);
  }
  return line;
}

export function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function parseYamlListUnderKey(text, targetKey) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const values = [];
  let baseIndent;
  for (const raw of lines) {
    const line = stripInlineComment(raw, "#");
    if (baseIndent === undefined) {
      const match = new RegExp(`^(\\s*)${targetKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*)$`).exec(line);
      if (!match) continue;
      baseIndent = match[1].length;
      const inline = match[2].trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        return inline.slice(1, -1).split(",").map((item) => parseYamlScalar(item)).filter(Boolean);
      }
      continue;
    }
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (item) values.push(parseYamlScalar(item[1]));
  }
  return values;
}

export function parseYamlMappingUnderKey(text, targetKey) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const output = {};
  let baseIndent;
  for (const raw of lines) {
    const line = stripInlineComment(raw, "#");
    if (baseIndent === undefined) {
      const match = new RegExp(`^(\\s*)${targetKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`).exec(line);
      if (match) baseIndent = match[1].length;
      continue;
    }
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    const pair = /^\s*([^:#]+):\s*(.*?)\s*$/.exec(line);
    if (pair) output[pair[1].trim()] = parseYamlScalar(pair[2]);
  }
  return output;
}

export function parseTomlArray(text, section, key) {
  const normalized = text.replaceAll("\r\n", "\n");
  const sectionPattern = new RegExp(`^\\s*\\[${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "m");
  const sectionMatch = sectionPattern.exec(normalized);
  if (!sectionMatch) return [];
  const remainder = normalized.slice(sectionMatch.index + sectionMatch[0].length);
  const nextSection = /^\s*\[[^\]]+\]\s*$/m.exec(remainder);
  const body = nextSection ? remainder.slice(0, nextSection.index) : remainder;
  const keyMatch = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m").exec(body);
  if (!keyMatch) return [];
  return [...keyMatch[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

export function parseTomlPackageName(text) {
  const normalized = text.replaceAll("\r\n", "\n");
  const section = /^\s*\[package\]\s*$/m.exec(normalized);
  if (!section) return undefined;
  const remainder = normalized.slice(section.index + section[0].length);
  const next = /^\s*\[[^\]]+\]\s*$/m.exec(remainder);
  const body = next ? remainder.slice(0, next.index) : remainder;
  return /^\s*name\s*=\s*["']([^"']+)["']/m.exec(body)?.[1];
}

export function parseTomlPathDependencies(text) {
  const output = [];
  const normalized = text.replaceAll("\r\n", "\n");
  const sections = [...normalized.matchAll(/^\s*\[(dependencies|dev-dependencies|build-dependencies)\]\s*$/gm)];
  for (let index = 0; index < sections.length; index += 1) {
    const start = sections[index].index + sections[index][0].length;
    const end = sections[index + 1]?.index ?? normalized.length;
    const body = normalized.slice(start, end);
    for (const match of body.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=\s*\{([^}]+)\}\s*$/gm)) {
      const pathMatch = /\bpath\s*=\s*["']([^"']+)["']/.exec(match[2]);
      if (pathMatch) output.push({ name: match[1], path: pathMatch[1], kind: sections[index][1] });
    }
  }
  return output;
}

export function parsePubspecName(text) {
  return /^name:\s*([^\s#]+)\s*$/m.exec(text)?.[1];
}

export function parsePubspecPathDependencies(text) {
  const output = [];
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  let sectionIndent;
  let current;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = stripInlineComment(lines[index], "#");
    if (/^(dependencies|dev_dependencies):\s*$/.test(raw.trim()) && raw.match(/^\s*/)[0].length === 0) {
      sectionIndent = 0;
      current = undefined;
      continue;
    }
    if (sectionIndent === undefined) continue;
    if (raw.trim() && raw.match(/^\s*/)[0].length <= sectionIndent) {
      sectionIndent = undefined;
      current = undefined;
      index -= 1;
      continue;
    }
    const dep = /^\s{2}([^:#]+):\s*(.*?)\s*$/.exec(raw);
    if (dep) {
      current = dep[1].trim();
      const inline = /\{[^}]*path:\s*([^,}\s]+)[^}]*\}/.exec(dep[2]);
      if (inline) output.push({ name: current, path: String(parseYamlScalar(inline[1])) });
      continue;
    }
    if (current) {
      const pathMatch = /^\s{4,}path:\s*(.+?)\s*$/.exec(raw);
      if (pathMatch) output.push({ name: current, path: String(parseYamlScalar(pathMatch[1])) });
    }
  }
  return output;
}

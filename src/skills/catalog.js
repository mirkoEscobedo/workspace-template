import { readFile } from "node:fs/promises";
import path from "node:path";
import { assetsSkills } from "../workspace-artifacts.js";
import {
  hashBuffer,
  hashDirectory,
  listDirectories,
  listFiles,
  toPosixPath,
} from "../fs-utils.js";

function parseFrontmatter(text) {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return {};
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return {};
  const output = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) output[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return output;
}

function riskFor(relative, content, risk) {
  const text = content.toString("utf8");
  if (/\.(?:js|mjs|cjs|py|sh|ps1|cmd|bat)$/i.test(relative) || relative.startsWith("scripts/")) {
    risk.executableFiles.push(relative);
  }
  if (/\b(?:bash|sh|powershell|cmd|child_process|subprocess|os\.system)\b/i.test(text)) risk.shellFiles.push(relative);
  if (/\b(?:https?:\/\/|curl\b|wget\b|fetch\(|requests\.|urllib)\b/i.test(text)) risk.networkFiles.push(relative);
  if (relative === "SKILL.md") {
    const frontmatter = parseFrontmatter(text);
    risk.description = frontmatter.description;
    const tools = frontmatter["allowed-tools"] ?? frontmatter.tools;
    if (tools) risk.allowedTools.push(...tools.split(/[ ,]+/).filter(Boolean));
  }
}

export async function readSkillTree(skillRoot) {
  const root = path.resolve(skillRoot);
  const files = new Map();
  for (const file of await listFiles(root)) {
    files.set(toPosixPath(path.relative(root, file)), await readFile(file));
  }
  return files;
}

export async function inspectSkillCatalog(catalogRoot = assetsSkills) {
  const root = path.resolve(catalogRoot);
  const skills = {};
  for (const directory of await listDirectories(root)) {
    const name = path.basename(directory);
    const files = {};
    const risk = {
      executableFiles: [],
      shellFiles: [],
      networkFiles: [],
      allowedTools: [],
      description: undefined,
    };
    for (const file of await listFiles(directory)) {
      const relative = toPosixPath(path.relative(directory, file));
      const content = await readFile(file);
      files[relative] = { hash: hashBuffer(content), size: content.length };
      riskFor(relative, content, risk);
    }
    for (const key of ["executableFiles", "shellFiles", "networkFiles", "allowedTools"]) {
      risk[key] = [...new Set(risk[key])].sort();
    }
    skills[name] = {
      name,
      path: directory,
      hash: await hashDirectory(directory),
      files,
      risk,
    };
  }
  return { version: 2, root, skills };
}

export const bundledSkillCatalog = inspectSkillCatalog;

export function skillRiskDiff(baseline, incoming) {
  const previous = baseline?.risk ?? baseline ?? {};
  const next = incoming?.risk ?? incoming ?? {};
  const added = (key) => (next[key] ?? []).filter((item) => !(previous[key] ?? []).includes(item));
  const diff = {
    executableFilesAdded: added("executableFiles"),
    shellFilesAdded: added("shellFiles"),
    networkFilesAdded: added("networkFiles"),
    allowedToolsAdded: added("allowedTools"),
    descriptionChanged: Boolean(previous.description && next.description && previous.description !== next.description),
  };
  diff.risky = diff.executableFilesAdded.length > 0
    || diff.shellFilesAdded.length > 0
    || diff.networkFilesAdded.length > 0
    || diff.allowedToolsAdded.length > 0;
  return diff;
}

export const riskDiff = skillRiskDiff;

import path from "node:path";

export function displayNameFromTarget(target) {
  const base = path.basename(path.resolve(target));
  return base || "workspace-template-project";
}

export function npmName(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || "workspace-template-project";
}

export function rustCrateName(value) {
  const normalized = npmName(value).replace(/[.-]+/g, "_");
  return /^[a-z]/.test(normalized) ? normalized : `app_${normalized}`;
}

export function dartPackageName(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  const safe = normalized || "workspace_template_project";
  return /^[a-z]/.test(safe) ? safe : `app_${safe}`;
}

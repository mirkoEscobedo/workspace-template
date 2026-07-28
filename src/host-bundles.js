import path from "node:path";
import { toPosixPath } from "./fs-utils.js";

const HOST_BUNDLE_PREFIXES = [".agents/", ".codex/", ".opencode/"];

export function isHostBundlePath(relativePath) {
  const normalized = path.posix.normalize(toPosixPath(relativePath)).toLowerCase();
  return normalized === "opencode.json"
    || HOST_BUNDLE_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

export function preservesHostBundleProjection(agent) {
  return agent === "codex" || agent === "opencode";
}

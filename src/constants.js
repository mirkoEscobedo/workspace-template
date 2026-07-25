export const PACKAGE_VERSION = "0.6.0";

export const PROJECTS = [
  "typescript",
  "javascript",
  "react",
  "rust",
  "flutter",
];

export const CREATE_STYLES = ["simple", "functional-core", "clean"];
export const ADOPT_STYLES = ["preserve", ...CREATE_STYLES];
export const CREATE_TDD_MODES = ["strict", "pragmatic", "off"];
export const ADOPT_TDD_MODES = ["preserve", ...CREATE_TDD_MODES];
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];
export const ADOPT_PACKAGE_MANAGERS = ["auto", ...PACKAGE_MANAGERS];
export const CONFLICT_MODES = ["fail", "propose", "managed-block"];
export const CURRENT_TICKET_STATUSES = ["ready", "in_progress", "repair", "review"];

export const AGENT_TARGETS = [
  "claude",
  "codex",
  "copilot",
  "cursor",
  "opencode",
  "gemini",
];

// Frontier Loop defaults. Other projections remain opt-in.
export const DEFAULT_AGENTS = ["codex", "opencode"];

export const MODEL_ROUTING = Object.freeze({
  coordinator: Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "high" }),
  planner: Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "high" }),
  worker: Object.freeze({ model: "gpt-5.3-codex", reasoningEffort: "high" }),
  maxConcurrentSubagents: 3,
});

export const DEPENDENCY_SNAPSHOT = Object.freeze({
  capturedAt: "2026-07-11",
  typescript: "7.0.2",
  vite: "8.1.4",
  react: "19.2.7",
  reactDom: "19.2.7",
  vitest: "4.1.10",
  testingLibraryReact: "16.3.2",
  testingLibraryJestDom: "6.9.1",
  jsdom: "29.1.1",
  viteReact: "6.0.3",
  biome: "2.5.3",
  tsx: "4.23.0",
  typesNode: "20.19.43",
  typesReact: "19.2.17",
  typesReactDom: "19.2.3",
  flutterLints: "6.0.0",
});

export const PROJECT_ALIASES = Object.freeze({
  ts: "typescript",
  js: "javascript",
  node: "javascript",
  nodejs: "javascript",
  reactjs: "react",
  rs: "rust",
  dart: "flutter",
});

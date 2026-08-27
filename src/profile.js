import { DELIVERY_POLICY } from "./delivery.js";

const STYLE_SETTINGS = Object.freeze({
  simple: {
    architecture: "simple-modular",
    organization: "feature-first",
    effects: "explicit-at-call-sites",
    dependencyDirection: "local-and-obvious",
    ports: "only-when-a-second-implementation-or-external-boundary-exists",
  },
  "functional-core": {
    architecture: "functional-core-imperative-shell",
    organization: "feature-first",
    effects: "imperative-shell",
    dependencyDirection: "toward-pure-domain",
    ports: "at-real-database-api-clock-filesystem-queue-and-platform-boundaries",
  },
  clean: {
    architecture: "clean-ports-and-adapters",
    organization: "feature-first-with-explicit-layers",
    effects: "adapters-and-composition-root",
    dependencyDirection: "inward",
    ports: "application-owned-contracts-for-real-external-capabilities",
  },
});

function testStrategy(project) {
  return {
    domain: "fast-behavior-tests-through-public-functions",
    application: "use-case-tests-with-owned-fakes",
    adapters: "contract-or-integration-tests",
    ui: ["react", "flutter", "workspace"].includes(project) ? "component-or-widget-tests-where-applicable" : "not-applicable",
    endToEnd: "few-critical-path-tests",
  };
}

export function createProfile({ project, style, tdd, agents, mode = "generated", presetState }) {
  const selected = style === "preserve" ? undefined : STYLE_SETTINGS[style];
  if (style !== "preserve" && !selected) throw new Error(`Unsupported implementation style: ${style}`);

  const generated = mode === "generated";
  const summary = (role) => ({
    model: role.targets?.codex ?? role.targets?.opencode,
    reasoningEffort: role.reasoningEffort,
  });
  const preferredArchitecture = selected?.architecture ?? null;
  const architecture = generated
    ? {
        current: preferredArchitecture,
        preferredForNewCode: preferredArchitecture,
        migrationPolicy: "not-applicable",
        organization: selected.organization,
        effects: selected.effects,
        dependencyDirection: selected.dependencyDirection,
        ports: selected.ports,
      }
    : {
        current: "existing-or-mixed",
        preferredForNewCode: preferredArchitecture,
        migrationPolicy: "incremental-protected-vertical-slices",
        organization: style === "preserve" ? "preserve-coherent-existing-structure" : selected.organization,
        effects: style === "preserve" ? "make-new-or-touched-effects-explicit" : selected.effects,
        dependencyDirection: style === "preserve" ? "preserve-unless-an-approved-slice-changes-it" : selected.dependencyDirection,
        ports: style === "preserve" ? "only-for-real-volatile-boundaries-or-useful-seams" : selected.ports,
      };

  return {
    $schema: "./profile.schema.json",
    version: 3,
    mode,
    project,
    style,
    architecture,
    // Compatibility summaries for older consumers.
    architectureName: architecture.current,
    organization: architecture.organization,
    effects: architecture.effects,
    dependencyDirection: architecture.dependencyDirection,
    ports: architecture.ports,
    tdd,
    testing: {
      current: mode === "adopted" ? "detected-or-undetermined" : tdd,
      policyForChangedBehavior:
        tdd === "preserve"
          ? "follow-explicit-repository-policy-otherwise-pragmatic-regression-protection"
          : tdd,
      strategy: testStrategy(project),
    },
    immutability: "prefer",
    errorModel: project === "javascript" ? "explicit-errors-and-result-objects" : project === "workspace" ? "module-idiomatic-explicit-errors" : "typed-results-where-idiomatic",
    refactoring: "micro-refactor-after-green-structural-refactor-as-separate-change",
    complexityBudget: "minimum-architecture-that-protects-the-current-change",
    execution: {
      ...DELIVERY_POLICY,
      preset: presetState,
      coordinator: summary(presetState.roles.coordinator),
      planner: summary(presetState.roles.planner),
      workers: summary(presetState.roles.implementer),
      routing: presetState.roles,
      defaultWriters: 1,
      maxConcurrentSubagents: 3,
      landing: "serial",
    },
    agentTargets: agents,
  };
}

export function profileSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:workspace-template:profile:3",
    title: "Agentic implementation profile",
    type: "object",
    additionalProperties: true,
    required: ["version", "mode", "project", "style", "architecture", "tdd", "execution"],
    properties: {
      version: { enum: [1, 2, 3] },
      mode: { enum: ["generated", "adopted"] },
      project: { enum: ["typescript", "javascript", "react", "rust", "flutter", "dart", "workspace"] },
      style: { enum: ["preserve", "simple", "functional-core", "clean"] },
      architecture: {
        oneOf: [
          { type: "string", minLength: 1 },
          {
            type: "object",
            required: ["current", "migrationPolicy"],
            additionalProperties: true,
            properties: {
              current: { type: ["string", "null"] },
              preferredForNewCode: { type: ["string", "null"] },
              migrationPolicy: { type: "string", minLength: 1 },
            },
          },
        ],
      },
      tdd: { enum: ["preserve", "strict", "pragmatic", "off"] },
      agentTargets: {
        type: "array",
        uniqueItems: true,
        items: { enum: ["claude", "codex", "copilot", "cursor", "opencode", "gemini"] },
      },
      execution: {
        type: "object",
        required: ["method", "defaultMode", "limits", "review", "coordinator", "workers", "landing"],
        additionalProperties: true,
        properties: {
          method: { const: "adaptive" },
          defaultMode: { enum: ["direct", "ticketed", "governed"] },
          limits: {
            type: "object",
            required: ["semanticRepairs", "flakyReruns"],
            properties: {
              semanticRepairs: { type: "integer", minimum: 0, maximum: 2 },
              flakyReruns: { type: "integer", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
  };
}

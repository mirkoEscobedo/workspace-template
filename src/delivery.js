export const DELIVERY_MODES = Object.freeze(["direct", "ticketed", "governed"]);

export const DELIVERY_STATES = Object.freeze([
  "INTAKE",
  "ROUTED",
  "PLANNED",
  "IMPLEMENTING",
  "VERIFYING",
  "REVIEWING",
  "DIAGNOSING",
  "INSPECTING",
  "REPAIRING",
  "REPLANNING",
  "ACCEPTED",
  "REDIRECTED",
  "DEFERRED",
  "ABORTED",
]);

export const DELIVERY_POLICY = Object.freeze({
  method: "adaptive",
  defaultMode: "direct",
  modes: Object.freeze({
    direct: Object.freeze({ durableArtifacts: "none" }),
    ticketed: Object.freeze({ durableArtifacts: "compact-plan-and-current-ticket" }),
    governed: Object.freeze({ durableArtifacts: "contract-state-review-and-authority-receipts" }),
  }),
  limits: Object.freeze({ semanticRepairs: 2, flakyReruns: 1 }),
  review: Object.freeze({
    inspection: "adaptive",
    capabilities: Object.freeze(["runtime-debug", "interactive-gui"]),
    sourceMutation: "forbidden",
  }),
  durableHistory: "preserve",
});

const GOVERNED_SIGNALS = Object.freeze([
  "irreversible",
  "credentials",
  "securityBoundary",
  "financialAuthority",
  "destructiveMigration",
  "nativeProcessOwnership",
  "productionExternalSideEffect",
]);

export function selectDeliveryMode(signals = {}) {
  if (GOVERNED_SIGNALS.some((key) => signals[key] === true)) return "governed";
  if (signals.multiSession === true || signals.durableCoordination === true || Number(signals.verticalSlices ?? 1) > 1) {
    return "ticketed";
  }
  return "direct";
}

export function createDeliveryRun({ mode, signals = {} } = {}) {
  const selectedMode = mode ?? selectDeliveryMode(signals);
  if (!DELIVERY_MODES.includes(selectedMode)) throw new Error(`Unsupported delivery mode: ${selectedMode}`);
  return {
    state: "INTAKE",
    mode: selectedMode,
    semanticRepairs: 0,
    flakyReruns: 0,
    hypotheses: [],
    lastFailure: null,
  };
}

function requireState(run, allowed, event) {
  if (!allowed.includes(run.state)) {
    throw new Error(`${event} is not valid from ${run.state}; expected ${allowed.join(" or ")}`);
  }
}

function withState(run, state, extra = {}) {
  return { ...run, ...extra, state };
}

export function transitionDelivery(run, event) {
  if (!run || !DELIVERY_STATES.includes(run.state)) throw new Error("Delivery run has an invalid state");
  if (!event?.type) throw new Error("Delivery transition requires an event type");

  switch (event.type) {
    case "ROUTE":
      requireState(run, ["INTAKE"], event.type);
      return withState(run, "ROUTED");
    case "PLAN":
      requireState(run, ["ROUTED"], event.type);
      return withState(run, "PLANNED");
    case "START_IMPLEMENTATION":
      requireState(run, ["PLANNED"], event.type);
      return withState(run, "IMPLEMENTING");
    case "START_VERIFICATION":
      requireState(run, ["IMPLEMENTING", "REPAIRING"], event.type);
      return withState(run, "VERIFYING");
    case "VERIFY_PASS":
      requireState(run, ["VERIFYING"], event.type);
      return withState(run, "REVIEWING", { lastFailure: null });
    case "VERIFY_FAIL":
    case "REVIEW_FAIL":
      requireState(run, event.type === "VERIFY_FAIL" ? ["VERIFYING"] : ["REVIEWING"], event.type);
      return withState(run, "DIAGNOSING", {
        lastFailure: event.failure ?? { classification: "unknown" },
      });
    case "REVIEW_PASS":
      requireState(run, ["REVIEWING"], event.type);
      return withState(run, "ACCEPTED", { lastFailure: null });
    case "REVIEW_INSUFFICIENT":
      requireState(run, ["REVIEWING"], event.type);
      return withState(run, event.capabilityAvailable === false ? "REPLANNING" : "INSPECTING", {
        lastFailure: { classification: "insufficient-evidence", capability: event.capability ?? null },
      });
    case "INSPECTION_DEFECT":
      requireState(run, ["INSPECTING"], event.type);
      return withState(run, "DIAGNOSING", { lastFailure: event.failure ?? { classification: "runtime" } });
    case "INSPECTION_PASS":
      requireState(run, ["INSPECTING"], event.type);
      return withState(run, "REVIEWING", { lastFailure: null });
    case "INSPECTION_UNAVAILABLE":
      requireState(run, ["INSPECTING"], event.type);
      return withState(run, "REPLANNING", {
        lastFailure: { classification: "inspection-unavailable", capability: event.capability ?? null },
      });
    case "FLAKY_RERUN": {
      requireState(run, ["DIAGNOSING"], event.type);
      if (event.potentiallyFlaky !== true || run.flakyReruns >= DELIVERY_POLICY.limits.flakyReruns) {
        return withState(run, "REPLANNING");
      }
      return withState(run, "VERIFYING", { flakyReruns: run.flakyReruns + 1 });
    }
    case "DIAGNOSIS": {
      requireState(run, ["DIAGNOSING"], event.type);
      if (event.classification === "infrastructure" || event.classification === "external-blocker") {
        return withState(run, "REPLANNING", { lastFailure: { ...run.lastFailure, classification: event.classification } });
      }
      const hypothesis = String(event.hypothesis ?? "").trim();
      const repeated = !hypothesis || run.hypotheses.includes(hypothesis);
      if (repeated || run.semanticRepairs >= DELIVERY_POLICY.limits.semanticRepairs) {
        return withState(run, "REPLANNING");
      }
      return withState(run, "REPAIRING", {
        semanticRepairs: run.semanticRepairs + 1,
        hypotheses: [...run.hypotheses, hypothesis],
      });
    }
    case "REPLAN": {
      requireState(run, ["REPLANNING"], event.type);
      const destinations = {
        alternate_route: "REDIRECTED",
        reduced_scope: "REDIRECTED",
        defer: "DEFERRED",
        abort: "ABORTED",
      };
      const state = destinations[event.decision];
      if (!state) throw new Error("Replanning requires alternate_route, reduced_scope, defer, or abort");
      if (event.decision === "defer" && !String(event.blocker ?? "").trim()) {
        throw new Error("Deferral requires a concrete blocker");
      }
      return withState(run, state, { replanDecision: event.decision, blocker: event.blocker ?? null });
    }
    default:
      throw new Error(`Unknown delivery transition: ${event.type}`);
  }
}

export function validateReviewReport(report) {
  const errors = [];
  const verdictTransitions = {
    PASS: ["ACCEPTED"],
    FAIL: ["DIAGNOSING"],
    INSUFFICIENT_EVIDENCE: ["INSPECTING", "REPLANNING"],
  };
  if (!verdictTransitions[report?.verdict]) errors.push("verdict must be PASS, FAIL, or INSUFFICIENT_EVIDENCE");
  if (!["R0", "R1", "R2", "R3"].includes(report?.evidence_level)) errors.push("evidence_level must be R0, R1, R2, or R3");
  if (!verdictTransitions[report?.verdict]?.includes(report?.next_transition)) {
    errors.push("next_transition is inconsistent with verdict");
  }
  if (!Array.isArray(report?.evidence_checked)) errors.push("evidence_checked must be an array");
  if (!Array.isArray(report?.unresolved_items)) errors.push("unresolved_items must be an array");
  if (report?.inspection_capability != null
    && !["runtime-debug", "interactive-gui"].includes(report.inspection_capability)) {
    errors.push("inspection_capability is not a supported semantic capability");
  }
  return { ok: errors.length === 0, errors };
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DELIVERY_POLICY,
  createDeliveryRun,
  selectDeliveryMode,
  transitionDelivery,
  validateReviewReport,
} from "../src/delivery.js";

function reachVerifying(signals = {}) {
  let run = createDeliveryRun({ signals });
  for (const type of ["ROUTE", "PLAN", "START_IMPLEMENTATION", "START_VERIFICATION"]) {
    run = transitionDelivery(run, { type });
  }
  return run;
}

describe("adaptive delivery routing", () => {
  it("defaults ordinary and ambiguous work to direct", () => {
    assert.equal(selectDeliveryMode({}), "direct");
    assert.equal(selectDeliveryMode({ ambiguous: true }), "direct");
  });

  it("uses ticketed for durable multi-slice work", () => {
    assert.equal(selectDeliveryMode({ multiSession: true }), "ticketed");
    assert.equal(selectDeliveryMode({ verticalSlices: 3 }), "ticketed");
  });

  it("uses governed only for enumerated high-consequence signals", () => {
    assert.equal(selectDeliveryMode({ financialAuthority: true }), "governed");
    assert.equal(selectDeliveryMode({ nativeProcessOwnership: true }), "governed");
    assert.equal(selectDeliveryMode({ destructiveMigration: true }), "governed");
  });
});

describe("adaptive delivery transitions", () => {
  it("accepts a verified and reviewed change", () => {
    let run = reachVerifying();
    run = transitionDelivery(run, { type: "VERIFY_PASS" });
    run = transitionDelivery(run, { type: "REVIEW_PASS" });
    assert.equal(run.state, "ACCEPTED");
  });

  it("escalates insufficient evidence to inspection or replanning", () => {
    let run = transitionDelivery(reachVerifying(), { type: "VERIFY_PASS" });
    run = transitionDelivery(run, { type: "REVIEW_INSUFFICIENT", capability: "runtime-debug" });
    assert.equal(run.state, "INSPECTING");
    assert.equal(transitionDelivery(run, { type: "INSPECTION_UNAVAILABLE", capability: "runtime-debug" }).state, "REPLANNING");

    const unavailable = transitionDelivery(
      transitionDelivery(reachVerifying(), { type: "VERIFY_PASS" }),
      { type: "REVIEW_INSUFFICIENT", capabilityAvailable: false },
    );
    assert.equal(unavailable.state, "REPLANNING");
  });

  it("permits two novel semantic repairs and then forces replanning", () => {
    let run = transitionDelivery(reachVerifying(), { type: "VERIFY_FAIL", failure: { classification: "behavior" } });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "first cause" });
    assert.equal(run.state, "REPAIRING");
    run = transitionDelivery(run, { type: "START_VERIFICATION" });
    run = transitionDelivery(run, { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "second cause" });
    run = transitionDelivery(run, { type: "START_VERIFICATION" });
    run = transitionDelivery(run, { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "third cause" });
    assert.equal(run.state, "REPLANNING");
    assert.equal(run.semanticRepairs, 2);
  });

  it("does not reward a repeated hypothesis with another repair", () => {
    let run = transitionDelivery(reachVerifying(), { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "same cause" });
    run = transitionDelivery(run, { type: "START_VERIFICATION" });
    run = transitionDelivery(run, { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "same cause" });
    assert.equal(run.state, "REPLANNING");
  });

  it("allows one labeled flaky rerun and no more", () => {
    let run = transitionDelivery(reachVerifying(), { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "FLAKY_RERUN", potentiallyFlaky: true });
    assert.equal(run.state, "VERIFYING");
    run = transitionDelivery(run, { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "FLAKY_RERUN", potentiallyFlaky: true });
    assert.equal(run.state, "REPLANNING");
  });

  it("terminates replanning with an explicit route rather than an automatic successor", () => {
    let run = transitionDelivery(reachVerifying(), { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", classification: "infrastructure" });
    assert.equal(transitionDelivery(run, { type: "REPLAN", decision: "alternate_route" }).state, "REDIRECTED");
    assert.equal(transitionDelivery(run, { type: "REPLAN", decision: "defer", blocker: "missing device" }).state, "DEFERRED");
    assert.equal(transitionDelivery(run, { type: "REPLAN", decision: "abort" }).state, "ABORTED");
    assert.throws(() => transitionDelivery(run, { type: "REPLAN", decision: "defer" }), /blocker/i);
  });
});

describe("adaptive review report", () => {
  it("binds verdicts to permitted transitions and semantic capabilities", () => {
    const valid = validateReviewReport({
      verdict: "INSUFFICIENT_EVIDENCE",
      evidence_level: "R1",
      inspection_capability: "runtime-debug",
      next_transition: "INSPECTING",
      evidence_checked: ["targeted tests"],
      unresolved_items: ["runtime state"],
    });
    assert.equal(valid.ok, true);

    const invalid = validateReviewReport({
      verdict: "PASS",
      evidence_level: "R1",
      next_transition: "REPAIRING",
      evidence_checked: [],
      unresolved_items: [],
    });
    assert.equal(invalid.ok, false);
  });
});

describe("methodology-rescue regressions", () => {
  it("redirects workspace-template 002 instead of minting a successor ticket", () => {
    let run = transitionDelivery(reachVerifying({ multiSession: true }), { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "native bootstrap cannot own the required process tree" });
    run = transitionDelivery(run, { type: "START_VERIFICATION" });
    run = transitionDelivery(run, { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "the clean JavaScript baseline is the viable release route" });
    run = transitionDelivery(run, { type: "START_VERIFICATION" });
    run = transitionDelivery(run, { type: "VERIFY_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "a third repair would only reset process state" });
    assert.equal(run.state, "REPLANNING");
    run = transitionDelivery(run, { type: "REPLAN", decision: "alternate_route" });
    assert.equal(run.state, "REDIRECTED");
    assert.equal("successorTicket" in run, false);
  });

  it("classifies Trading validator/inventory failures without self-repairing methodology code", () => {
    let run = transitionDelivery(reachVerifying(), {
      type: "VERIFY_FAIL",
      failure: { classification: "infrastructure", gate: "inventory-validator" },
    });
    run = transitionDelivery(run, { type: "DIAGNOSIS", classification: "infrastructure" });
    assert.equal(run.state, "REPLANNING");
    assert.equal(run.semanticRepairs, 0);
  });

  it("stops Ultima-style repeated review repairs after two novel causes", () => {
    let run = transitionDelivery(reachVerifying(), { type: "VERIFY_PASS" });
    run = transitionDelivery(run, { type: "REVIEW_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "executor response violates the acceptance schema" });
    run = transitionDelivery(run, { type: "START_VERIFICATION" });
    run = transitionDelivery(run, { type: "VERIFY_PASS" });
    run = transitionDelivery(run, { type: "REVIEW_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "backend adapter drops the terminal result" });
    run = transitionDelivery(run, { type: "START_VERIFICATION" });
    run = transitionDelivery(run, { type: "VERIFY_PASS" });
    run = transitionDelivery(run, { type: "REVIEW_FAIL" });
    run = transitionDelivery(run, { type: "DIAGNOSIS", hypothesis: "another attempt" });
    assert.equal(run.state, "REPLANNING");
    assert.equal(run.semanticRepairs, 2);
  });

  it("keeps Health-style ordinary work direct and artifact-free", () => {
    const run = createDeliveryRun({ signals: { ordinaryFeature: true, ambiguous: true } });
    assert.equal(run.mode, "direct");
    assert.equal(DELIVERY_POLICY.modes.direct.durableArtifacts, "none");
  });
});

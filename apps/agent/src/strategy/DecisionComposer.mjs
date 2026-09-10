import { createRequestId } from "../../../../packages/shared/src/index.mjs";
import { assertStrategyDecision } from "./schemas.mjs";

export class RiskAwareDecisionComposer {
  compose({ state }) {
    const evidence = state.evidence;
    const hypothesis = state.hypothesis;
    const risk = assessRisk({ evidence, hypothesis });
    const action = chooseAction({ evidence, hypothesis, risk });
    const confidence = clamp(evidence.evidenceScore / 100, 0, 0.95);

    return assertStrategyDecision({
      decisionId: createRequestId("strategy_decision"),
      agent: "Strategy Agent",
      asset: state.asset,
      action,
      confidence,
      hypothesis,
      evidence,
      payments: state.payments,
      policyChecks: state.policyChecks,
      risk,
      reason: buildReason({ action, evidence, risk }),
      rationale: [
        ...hypothesis.reasoning,
        ...evidence.supportingEvidence.filter((item) => !hypothesis.reasoning.includes(item)),
        ...evidence.contradictingEvidence.map((item) => `Contradiction: ${item}`)
      ],
      nextAction: action.startsWith("SIMULATED_") ? "Send simulation proposal to Execution Agent" : "Do not send order to Execution Agent"
    });
  }
}

function assessRisk({ evidence, hypothesis }) {
  const blockingReasons = [];

  if (evidence.conflictLevel === "high") {
    blockingReasons.push("evidence conflict is high");
  }

  if (hypothesis.uncertainty.level === "high") {
    blockingReasons.push("hypothesis uncertainty is high");
  }

  if (evidence.missingEvidence.includes("adversarial downside review") && evidence.evidenceScore >= 75) {
    blockingReasons.push("strong directional setup requires risk challenge before execution");
  }

  return {
    level: blockingReasons.length > 0 ? "high" : evidence.evidenceScore >= 75 ? "medium" : "low",
    blockingReasons,
    riskRewardRatio: evidence.evidenceScore >= 75 ? 2 : null,
    invalidationCondition: "Do not increase exposure if market confirmation weakens or risk challenge fails."
  };
}

function chooseAction({ evidence, hypothesis, risk }) {
  if (risk.blockingReasons.length > 0) return "NO_TRADE";
  if (evidence.recommendedDecision === "SIMULATED_BUY" && hypothesis.direction === "LONG") return "SIMULATED_BUY";
  if (evidence.recommendedDecision === "HOLD") return "HOLD";
  return "NO_TRADE";
}

function buildReason({ action, evidence, risk }) {
  if (risk.blockingReasons.length > 0) {
    return `Risk guard blocked execution: ${risk.blockingReasons.join("; ")}`;
  }

  if (action === "SIMULATED_BUY") {
    return "Evidence supports a simulation-only long proposal inside policy boundaries.";
  }

  if (action === "HOLD") {
    return "Evidence is mixed; holding preserves optionality without spending execution risk.";
  }

  return "Evidence is not strong enough for a directional trade.";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

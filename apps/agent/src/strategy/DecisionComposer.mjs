import { createRequestId } from "../../../../packages/shared/src/index.mjs";
import { assertStrategyDecision } from "./schemas.mjs";

export class RiskAwareDecisionComposer {
  compose({ state, locale = "zh-CN" }) {
    const evidence = state.evidence;
    const hypothesis = state.hypothesis;
    const risk = assessRisk({ evidence, hypothesis, locale });
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
      reason: buildReason({ action, evidence, risk, locale }),
      rationale: [
        ...hypothesis.reasoning,
        ...evidence.supportingEvidence.filter((item) => !hypothesis.reasoning.includes(item)),
        ...evidence.contradictingEvidence.map((item) => locale === "zh-CN" ? `反证：${item}` : `Contradiction: ${item}`)
      ],
      nextAction: action.startsWith("SIMULATED_")
        ? locale === "zh-CN" ? "发送模拟执行提案给 Execution Agent" : "Send simulation proposal to Execution Agent"
        : locale === "zh-CN" ? "不向 Execution Agent 发送订单" : "Do not send order to Execution Agent"
    });
  }
}

function assessRisk({ evidence, hypothesis, locale = "zh-CN" }) {
  const isZh = locale === "zh-CN";
  const blockingReasons = [];

  if (evidence.conflictLevel === "high") {
    blockingReasons.push(isZh ? "证据冲突较高" : "evidence conflict is high");
  }

  if (hypothesis.uncertainty.level === "high") {
    blockingReasons.push(isZh ? "策略假设不确定性较高" : "hypothesis uncertainty is high");
  }

  if (evidence.missingEvidence.includes("adversarial downside review") && evidence.evidenceScore >= 75) {
    blockingReasons.push(isZh ? "强方向性设置在执行前需要风险挑战复核" : "strong directional setup requires risk challenge before execution");
  }

  if (evidence.riskChallenge?.verdict === "block") {
    blockingReasons.push(...evidence.riskChallenge.blockingReasons);
  }

  return {
    level: blockingReasons.length > 0 ? "high" : evidence.evidenceScore >= 75 ? "medium" : "low",
    blockingReasons,
    riskRewardRatio: evidence.evidenceScore >= 75 ? 2 : null,
    invalidationCondition: isZh
      ? "如果市场确认转弱或风险挑战失败，不增加敞口。"
      : "Do not increase exposure if market confirmation weakens or risk challenge fails."
  };
}

function chooseAction({ evidence, hypothesis, risk }) {
  if (risk.blockingReasons.length > 0) return "NO_TRADE";
  if (evidence.recommendedDecision === "SIMULATED_BUY" && hypothesis.direction === "LONG") return "SIMULATED_BUY";
  if (evidence.recommendedDecision === "HOLD") return "HOLD";
  return "NO_TRADE";
}

function buildReason({ action, evidence, risk, locale = "zh-CN" }) {
  const isZh = locale === "zh-CN";
  if (risk.blockingReasons.length > 0) {
    return isZh
      ? `风险边界阻止执行：${risk.blockingReasons.join("；")}`
      : `Risk guard blocked execution: ${risk.blockingReasons.join("; ")}`;
  }

  if (action === "SIMULATED_BUY") {
    return isZh ? "证据支持在 policy 边界内生成仅模拟的做多提案。" : "Evidence supports a simulation-only long proposal inside policy boundaries.";
  }

  if (action === "HOLD") {
    return isZh ? "证据仍然混合，继续观察可以保留选择权并避免执行风险。" : "Evidence is mixed; holding preserves optionality without spending execution risk.";
  }

  return isZh ? "证据强度不足，不支持方向性交易。" : "Evidence is not strong enough for a directional trade.";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

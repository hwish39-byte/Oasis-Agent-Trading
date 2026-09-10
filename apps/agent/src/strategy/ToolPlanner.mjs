import { assertToolPlan } from "./schemas.mjs";

export class ToolPlanner {
  plan({ policy, hypothesis, marketContext, memory }) {
    const toolCalls = [];
    const remainingTinybar = policy.dailyBudgetTinybar;

    if (hypothesis.initialConfidence < 0.45) {
      return assertToolPlan({
        mode: "skip_paid_research",
        reason: "Initial confidence is too low for paid research to be economically justified.",
        toolCalls
      });
    }

    if (policy.allowedServices.includes("market-signal") && shouldBuyMarketSignal(hypothesis, marketContext)) {
      toolCalls.push({
        service: "market-signal",
        priority: "high",
        reason: "Market confirmation can materially change the trade decision.",
        maxWillingToPayTinybar: Math.min(3_000_000, policy.maxPaymentPerCallTinybar, remainingTinybar),
        required: true
      });
    }

    if (policy.allowedServices.includes("risk-challenge") && shouldRequestRiskChallenge(hypothesis, memory)) {
      toolCalls.push({
        service: "risk-challenge",
        priority: "high",
        reason: "A stronger directional setup needs adversarial downside review before execution.",
        maxWillingToPayTinybar: Math.min(2_000_000, policy.maxPaymentPerCallTinybar, remainingTinybar),
        required: true
      });
    }

    return assertToolPlan({
      mode: toolCalls.length > 0 ? "paid_research_planned" : "no_paid_research_needed",
      reason: toolCalls.length > 0
        ? "The hypothesis has enough promise to justify bounded information purchases."
        : "Available evidence is sufficient for a conservative decision.",
      toolCalls
    });
  }
}

function shouldBuyMarketSignal(hypothesis, marketContext) {
  return hypothesis.uncertainty.missingEvidence.includes("independent market confirmation")
    || marketContext.snapshot.volumeConfirmation === "weak"
    || hypothesis.initialConfidence < 0.8;
}

function shouldRequestRiskChallenge(hypothesis, memory) {
  return hypothesis.initialConfidence >= 0.7
    || hypothesis.uncertainty.missingEvidence.includes("adversarial downside review")
    || memory.performanceSummary?.recentFalsePositiveRate > 0.35;
}

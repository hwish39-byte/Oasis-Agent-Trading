export class Observability {
  summarize({ state, startedAt, endedAt = Date.now() }) {
    const paymentSpendTinybar = state.payments.reduce((sum, payment) => sum + Number(payment.amountTinybar ?? 0), 0);

    return {
      runId: state.runId,
      durationMs: endedAt - startedAt,
      stepsCompleted: state.timeline.length,
      llmProvider: state.hypothesis?.generatedBy ?? "unknown",
      toolCallsPlanned: state.toolPlan?.toolCalls.length ?? 0,
      paymentsSettled: state.payments.filter((item) => item.status === "settled").length,
      paymentSpendTinybar,
      finalAction: state.decision?.action,
      evidenceScore: state.evidence?.evidenceScore,
      riskLevel: state.decision?.risk.level
    };
  }
}

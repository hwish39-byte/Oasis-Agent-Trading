export class RiskAgent {
  constructor({ paidToolClient } = {}) {
    this.paidToolClient = paidToolClient;
  }

  async challenge({ state, serviceBaseUrl, policy, ledger, plannedCall }) {
    const request = {
      agent: "Risk Agent",
      action: "quote_risk_reasoning",
      service: "risk-challenge",
      paidAgent: "Risk Agent",
      reasoningTier: plannedCall.reasoningTier,
      quotedTinybar: plannedCall.quotedTinybar,
      usage: plannedCall.usage,
      pricingModel: plannedCall.pricingModel,
      maxFeeTinybar: plannedCall.maxWillingToPayTinybar,
      reason: plannedCall.reason
    };

    const result = await this.paidToolClient.callRiskChallenge({
      serviceBaseUrl,
      asset: state.asset,
      hypothesis: state.hypothesis,
      locale: state.locale,
      policy,
      ledger,
      plannedCall
    });

    return {
      result,
      transcript: [
        request,
        {
          agent: "Risk Agent",
          action: result.status === "settled" ? "deliver_risk_challenge" : "risk_agent_charge_blocked",
          service: "risk-challenge",
          paidAgent: "Risk Agent",
          reasoningTier: result.quote?.reasoningTier,
          quotedTinybar: result.quote?.quotedTinybar,
          usage: result.quote?.usage,
          pricingModel: result.quote?.pricingModel,
          status: result.status,
          transactionId: result.payment?.transactionId,
          verdict: result.result?.challenge?.verdict,
          summary: result.result?.challenge?.counterArgument ?? result.policyCheck?.reasons?.join("; ")
        }
      ]
    };
  }
}

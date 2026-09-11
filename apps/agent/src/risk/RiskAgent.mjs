export class RiskAgent {
  constructor({ paidToolClient } = {}) {
    this.paidToolClient = paidToolClient;
  }

  async challenge({ state, serviceBaseUrl, policy, ledger, plannedCall }) {
    const request = {
      agent: "Risk Agent",
      action: "request_paid_challenge",
      service: "risk-challenge",
      maxFeeTinybar: plannedCall.maxWillingToPayTinybar,
      reason: plannedCall.reason
    };

    const result = await this.paidToolClient.callRiskChallenge({
      serviceBaseUrl,
      asset: state.asset,
      hypothesis: state.hypothesis,
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
          action: result.status === "settled" ? "deliver_risk_challenge" : "risk_challenge_blocked",
          service: "risk-challenge",
          status: result.status,
          transactionId: result.payment?.transactionId,
          verdict: result.result?.challenge?.verdict,
          summary: result.result?.challenge?.counterArgument ?? result.policyCheck?.reasons?.join("; ")
        }
      ]
    };
  }
}

export class MarketResearchAgent {
  constructor({ paidToolClient } = {}) {
    this.paidToolClient = paidToolClient;
  }

  async research({ state, serviceBaseUrl, policy, ledger, plannedCall }) {
    const request = {
      agent: "Market Research Agent",
      action: "request_market_signal",
      service: "market-signal",
      maxFeeTinybar: plannedCall.maxWillingToPayTinybar,
      reason: plannedCall.reason
    };

    const result = await this.paidToolClient.callMarketSignal({
      serviceBaseUrl,
      asset: state.asset,
      policy,
      ledger,
      plannedCall
    });

    return {
      result,
      transcript: [
        request,
        {
          agent: "Market Research Agent",
          action: result.status === "settled" ? "deliver_market_signal" : "market_signal_blocked",
          service: "market-signal",
          status: result.status,
          transactionId: result.payment?.transactionId,
          summary: result.result?.signal?.summary ?? result.policyCheck?.reasons?.join("; ")
        }
      ]
    };
  }
}

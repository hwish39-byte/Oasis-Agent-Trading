export class MarketResearchAgent {
  constructor({ paidToolClient } = {}) {
    this.paidToolClient = paidToolClient;
  }

  async research({ state, serviceBaseUrl, policy, ledger, plannedCall }) {
    const request = {
      agent: "Market Agent",
      action: "quote_market_reasoning",
      service: "market-signal",
      paidAgent: "Market Agent",
      reasoningTier: plannedCall.reasoningTier,
      quotedTinybar: plannedCall.quotedTinybar,
      usage: plannedCall.usage,
      pricingModel: plannedCall.pricingModel,
      maxFeeTinybar: plannedCall.maxWillingToPayTinybar,
      reason: plannedCall.reason
    };

    const result = await this.paidToolClient.callMarketSignal({
      serviceBaseUrl,
      asset: state.asset,
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
          agent: "Market Agent",
          action: result.status === "settled" ? "deliver_market_signal" : "market_agent_charge_blocked",
          service: "market-signal",
          paidAgent: "Market Agent",
          reasoningTier: result.quote?.reasoningTier,
          quotedTinybar: result.quote?.quotedTinybar,
          usage: result.quote?.usage,
          pricingModel: result.quote?.pricingModel,
          status: result.status,
          transactionId: result.payment?.transactionId,
          summary: result.result?.signal?.summary ?? result.policyCheck?.reasons?.join("; ")
        }
      ]
    };
  }
}

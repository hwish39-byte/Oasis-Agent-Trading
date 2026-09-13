import { createAgentPaymentPayload, getHederaConfig } from "../../../../packages/hedera/src/index.mjs";
import { recordAgentCharge } from "../../../../packages/policy/src/index.mjs";
import { buildX402PaymentRequired, createRequestId, encodePaymentHeader, tinybarToHbar } from "../../../../packages/shared/src/index.mjs";
import { quotePaidAgentCall } from "../../../../packages/shared/src/pricing.mjs";

export class X402PaidToolClient {
  constructor({ guard, fetchImpl = fetch } = {}) {
    this.guard = guard;
    this.fetch = fetchImpl;
  }

  async callMarketSignal({ serviceBaseUrl, asset, locale, policy, ledger, plannedCall }) {
    const params = new URLSearchParams({
      asset,
      timeframe: policy.strategyIntent?.timeframe ?? "4h",
      strategy: policy.strategyIntent?.strategyType ?? "breakout",
      tier: plannedCall.reasoningTier,
      locale: locale ?? "en-US"
    });
    appendUsageParams(params, plannedCall.usage, ["candles", "indicators", "timeframes"]);

    return this.callPaidAgent({
      service: "market-signal",
      serviceBaseUrl,
      resourcePath: `/signal?${params.toString()}`,
      policy,
      ledger,
      plannedCall,
      extractResult: (paidResult) => ({
        signal: paidResult.signal,
        result: paidResult
      })
    });
  }

  async callRiskChallenge({ serviceBaseUrl, asset, hypothesis, locale, policy, ledger, plannedCall }) {
    const params = new URLSearchParams({
      asset,
      setup: hypothesis.setup,
      confidence: String(hypothesis.initialConfidence),
      tier: plannedCall.reasoningTier,
      locale: locale ?? "en-US"
    });
    appendUsageParams(params, plannedCall.usage, ["stressScenarios", "checks", "riskFactors"]);

    return this.callPaidAgent({
      service: "risk-challenge",
      serviceBaseUrl,
      resourcePath: `/challenge?${params.toString()}`,
      policy,
      ledger,
      plannedCall,
      extractResult: (paidResult) => ({
        challenge: paidResult.challenge,
        result: paidResult
      })
    });
  }

  async callPaidAgent({ service, serviceBaseUrl, resourcePath, policy, ledger, plannedCall, extractResult }) {
    const endpoint = `${serviceBaseUrl}${resourcePath}`;
    const quote = createAgentQuote({ service, plannedCall });
    const paymentRequired = buildPaymentRequiredFromQuote({ quote });
    const requirement = paymentRequired.accepts[0];
    const policyCheck = this.guard.checkBeforeAgentCharge({
      policy,
      ledger,
      agentQuote: quote,
      service,
      plannedCall
    });

    if (!policyCheck.allowed) {
      return {
        status: "blocked",
        service,
        paidAgent: paidAgentName(service),
        quote,
        requirement,
        paymentRequired,
        policyCheck,
        result: null,
        payment: null
      };
    }

    const paymentPayload = await createAgentPaymentPayload({
      requestId: requirement.extra.requestId,
      paymentRequirement: requirement,
      policyId: policy.id,
      payerAccountId: policy.allowance?.ownerAccountId,
      spenderAccountId: policy.allowance?.spenderAccountId
    });

    const paidResponse = await this.fetch(endpoint, {
      headers: {
        "X-PAYMENT": encodePaymentHeader(paymentPayload)
      }
    });
    const paidResult = await paidResponse.json();

    if (!paidResponse.ok) {
      throw new Error(`Paid service call failed: ${paidResponse.status} ${JSON.stringify(paidResult)}`);
    }

    const charge = recordAgentCharge({
      ledger,
      quoteId: quote.quoteId,
      service,
      agent: quote.agent,
      reasoningTier: quote.reasoningTier,
      amountTinybar: quote.quotedTinybar,
      usage: quote.usage,
      pricingModel: quote.pricingModel,
      transactionId: paidResult.payment.transactionId
    });

    const extracted = extractResult(paidResult);

    return {
      status: "settled",
      service,
      paidAgent: paidAgentName(service),
      quote,
      requirement,
      paymentRequired,
      policyCheck,
      paymentPayload,
      payment: paidResult.payment,
      charge,
      ...extracted,
      result: extracted.result,
      priceHbar: tinybarToHbar(requirement.amount)
    };
  }
}

function createAgentQuote({ service, plannedCall }) {
  const usageQuote = quotePaidAgentCall({
    service,
    reasoningTier: plannedCall.reasoningTier,
    usage: plannedCall.usage
  });

  return {
    quoteId: createRequestId(service.replace(/-/g, "_")),
    service,
    agent: plannedCall.agent ?? paidAgentName(service),
    reasoningTier: plannedCall.reasoningTier,
    quotedTinybar: usageQuote.quotedTinybar,
    usage: usageQuote.usage,
    pricingModel: usageQuote.pricingModel,
    network: usageQuote.network,
    asset: usageQuote.asset,
    reason: plannedCall.reason
  };
}

function buildPaymentRequiredFromQuote({ quote }) {
  const config = getHederaConfig();
  if (!config.serviceAccountId) {
    throw new Error("Missing required Hedera service receiver account: HEDERA_OASIS_MERCHANT_ACCOUNT_ID");
  }

  return buildX402PaymentRequired({
    requestId: quote.quoteId,
    service: quote.service,
    receiverAccountId: config.serviceAccountId,
    priceTinybar: quote.quotedTinybar,
    network: quote.network
  });
}

function paidAgentName(service) {
  if (service === "market-signal") return "Market Agent";
  if (service === "risk-challenge") return "Risk Agent";
  return service;
}

function appendUsageParams(params, usage, keys) {
  for (const key of keys) {
    if (usage?.[key] !== undefined) {
      params.set(key, String(usage[key]));
    }
  }
}

import { createAgentPaymentPayload } from "../../../../packages/hedera/src/index.mjs";
import { recordSpend } from "../../../../packages/policy/src/index.mjs";
import { encodePaymentHeader, tinybarToHbar } from "../../../../packages/shared/src/index.mjs";

export class X402PaidToolClient {
  constructor({ guard, fetchImpl = fetch } = {}) {
    this.guard = guard;
    this.fetch = fetchImpl;
  }

  async callMarketSignal({ serviceBaseUrl, asset, policy, ledger, plannedCall }) {
    const params = new URLSearchParams({
      asset,
      timeframe: policy.strategyIntent?.timeframe ?? "4h",
      strategy: policy.strategyIntent?.strategyType ?? "breakout"
    });

    return this.callPaidResource({
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

  async callRiskChallenge({ serviceBaseUrl, asset, hypothesis, policy, ledger, plannedCall }) {
    const params = new URLSearchParams({
      asset,
      setup: hypothesis.setup,
      confidence: String(hypothesis.initialConfidence)
    });

    return this.callPaidResource({
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

  async callPaidResource({ service, serviceBaseUrl, resourcePath, policy, ledger, plannedCall, extractResult }) {
    const endpoint = `${serviceBaseUrl}${resourcePath}`;
    const firstResponse = await this.fetch(endpoint);
    const paymentRequired = await firstResponse.json();

    if (firstResponse.status !== 402) {
      throw new Error(`Expected HTTP 402 from gated service, received ${firstResponse.status}`);
    }

    const requirement = paymentRequired.accepts[0];
    const policyCheck = this.guard.checkBeforePayment({
      policy,
      ledger,
      paymentRequirement: requirement,
      service,
      plannedCall
    });

    if (!policyCheck.allowed) {
      return {
        status: "blocked",
        service,
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
      policyId: policy.id
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

    recordSpend({
      ledger,
      requestId: requirement.extra.requestId,
      service,
      amountTinybar: Number(requirement.amount),
      transactionId: paidResult.payment.transactionId
    });

    const extracted = extractResult(paidResult);

    return {
      status: "settled",
      service,
      requirement,
      paymentRequired,
      policyCheck,
      paymentPayload,
      payment: paidResult.payment,
      ...extracted,
      result: extracted.result,
      priceHbar: tinybarToHbar(requirement.amount)
    };
  }
}

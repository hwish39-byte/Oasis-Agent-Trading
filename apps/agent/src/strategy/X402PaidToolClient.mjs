import { createAgentPaymentPayload } from "../../../../packages/hedera/src/index.mjs";
import { recordSpend } from "../../../../packages/policy/src/index.mjs";
import { encodePaymentHeader, tinybarToHbar } from "../../../../packages/shared/src/index.mjs";

export class X402PaidToolClient {
  constructor({ guard, fetchImpl = fetch } = {}) {
    this.guard = guard;
    this.fetch = fetchImpl;
  }

  async callMarketSignal({ serviceBaseUrl, asset, policy, ledger, plannedCall }) {
    const firstResponse = await this.fetch(`${serviceBaseUrl}/signal?asset=${asset}`);
    const paymentRequired = await firstResponse.json();

    if (firstResponse.status !== 402) {
      throw new Error(`Expected HTTP 402 from gated service, received ${firstResponse.status}`);
    }

    const requirement = paymentRequired.accepts[0];
    const policyCheck = this.guard.checkBeforePayment({
      policy,
      ledger,
      paymentRequirement: requirement,
      service: "market-signal",
      plannedCall
    });

    if (!policyCheck.allowed) {
      return {
        status: "blocked",
        service: "market-signal",
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

    const paidResponse = await this.fetch(`${serviceBaseUrl}/signal?asset=${asset}`, {
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
      service: "market-signal",
      amountTinybar: Number(requirement.amount),
      transactionId: paidResult.payment.transactionId
    });

    return {
      status: "settled",
      service: "market-signal",
      requirement,
      paymentRequired,
      policyCheck,
      paymentPayload,
      payment: paidResult.payment,
      result: paidResult,
      priceHbar: tinybarToHbar(requirement.amount)
    };
  }
}

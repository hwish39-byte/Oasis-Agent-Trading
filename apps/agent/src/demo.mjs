import {
  closeMarketSignalServer,
  createMarketSignalServer
} from "../../market-signal-api/src/server.mjs";
import { createAgentPaymentPayload, writeAuditRecord } from "../../../packages/hedera/src/index.mjs";
import {
  checkPaymentAllowed,
  createBudgetLedger,
  defaultUserPolicy,
  recordSpend
} from "../../../packages/policy/src/index.mjs";
import { encodePaymentHeader, tinybarToHbar } from "../../../packages/shared/src/index.mjs";

export async function runSingleAgentDemo({ startLocalService = true, serviceBaseUrl } = {}) {
  let ownedServer;

  if (startLocalService) {
    const started = await createMarketSignalServer({ port: 0 });
    ownedServer = started.server;
    serviceBaseUrl = started.baseUrl;
  }

  const policy = defaultUserPolicy;
  const ledger = createBudgetLedger(policy);
  const timeline = [];

  try {
    timeline.push({
      step: "strategy_candidate",
      agent: "Strategy Agent",
      message: `Detected possible ${policy.targetAsset} breakout. Buying one market signal if policy allows.`
    });

    const firstResponse = await fetch(`${serviceBaseUrl}/signal?asset=${policy.targetAsset}`);
    const paymentRequired = await firstResponse.json();

    if (firstResponse.status !== 402) {
      throw new Error(`Expected HTTP 402 from gated service, received ${firstResponse.status}`);
    }

    const requirement = paymentRequired.accepts[0];
    timeline.push({
      step: "payment_required",
      service: "market-signal",
      price: `${tinybarToHbar(requirement.amount)} HBAR`,
      network: requirement.network,
      receiver: requirement.payTo,
      asset: requirement.asset,
      scheme: requirement.scheme,
      x402Version: paymentRequired.x402Version
    });

    const policyDecision = checkPaymentAllowed({
      policy,
      ledger,
      paymentRequirement: requirement,
      service: "market-signal"
    });

    timeline.push({
      step: "policy_check",
      allowed: policyDecision.allowed,
      remainingBudget: `${tinybarToHbar(policyDecision.remainingTinybar)} HBAR`,
      reasons: policyDecision.reasons
    });

    if (!policyDecision.allowed) {
      return {
        finalDecision: "NO_TRADE",
        reason: "Paid research was blocked by user policy.",
        timeline
      };
    }

    const paymentPayload = await createAgentPaymentPayload({
      requestId: requirement.extra.requestId,
      paymentRequirement: requirement,
      policyId: policy.id
    });

    timeline.push({
      step: "payment_signed",
      payer: paymentPayload.payer,
      facilitator: paymentPayload.facilitatorUrl,
      mode: paymentPayload.mode,
      x402Version: paymentPayload.x402Version
    });

    const paidResponse = await fetch(`${serviceBaseUrl}/signal?asset=${policy.targetAsset}`, {
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

    timeline.push({
      step: "payment_settled",
      transactionId: paidResult.payment.transactionId,
      settledAt: paidResult.payment.settledAt
    });

    timeline.push({
      step: "signal_delivered",
      signal: paidResult.signal
    });

    const decision = makeStrategyDecision(paidResult.signal);
    const audit = await writeAuditRecord({
      requestId: requirement.extra.requestId,
      decision,
      payment: paidResult.payment
    });

    timeline.push({
      step: "audit_recorded",
      audit
    });

    return {
      finalDecision: decision.action,
      reason: decision.reason,
      policy,
      budget: {
        spentTinybar: ledger.spentTinybar,
        spentHbar: tinybarToHbar(ledger.spentTinybar),
        remainingHbar: tinybarToHbar(policy.dailyBudgetTinybar - ledger.spentTinybar)
      },
      payment: paidResult.payment,
      audit,
      timeline
    };
  } finally {
    if (ownedServer) {
      await closeMarketSignalServer(ownedServer);
    }
  }
}

function makeStrategyDecision(signal) {
  if (signal.recommendation === "buy" && signal.confidence >= 0.7 && signal.breakoutScore >= 75) {
    return {
      action: "SIMULATED_BUY",
      reason: "Paid market signal confirms breakout strength inside policy budget."
    };
  }

  return {
    action: "NO_TRADE",
    reason: "Paid market signal is not strong enough; agent preserves budgeted simulation-only policy."
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runSingleAgentDemo();

  console.log("\nOasis minimal x402 + Hedera demo");
  console.log("=================================\n");

  for (const event of result.timeline) {
    console.log(JSON.stringify(event, null, 2));
  }

  console.log("\nFinal result");
  console.log(JSON.stringify(
    {
      finalDecision: result.finalDecision,
      reason: result.reason,
      budget: result.budget,
      payment: result.payment,
      audit: result.audit
    },
    null,
    2
  ));
}

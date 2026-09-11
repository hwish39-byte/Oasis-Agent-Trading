export const defaultUserPolicy = Object.freeze({
  id: "policy_demo_v1",
  targetAsset: "ETH",
  dailyBudgetTinybar: 20_000_000,
  maxPaymentPerCallTinybar: 5_000_000,
  allowedServices: ["market-signal", "risk-challenge"],
  serviceBudgetsTinybar: {
    "market-signal": 12_000_000,
    "risk-challenge": 6_000_000
  },
  executionMode: "simulation",
  riskRules: ["paid_research_must_stay_within_budget"]
});

export function createBudgetLedger(policy) {
  return {
    policyId: policy.id,
    spentTinybar: 0,
    reservations: []
  };
}

export function checkPaymentAllowed({ policy, ledger, paymentRequirement, service }) {
  const requestedTinybar = Number(paymentRequirement.amount);
  const remainingTinybar = policy.dailyBudgetTinybar - ledger.spentTinybar;
  const reasons = [];

  if (!policy.allowedServices.includes(service)) {
    reasons.push(`service ${service} is not allowed`);
  }

  if (requestedTinybar > policy.maxPaymentPerCallTinybar) {
    reasons.push(`price ${requestedTinybar} tinybar exceeds per-call limit ${policy.maxPaymentPerCallTinybar}`);
  }

  if (requestedTinybar > remainingTinybar) {
    reasons.push(`price ${requestedTinybar} tinybar exceeds remaining budget ${remainingTinybar}`);
  }

  const serviceBudgetTinybar = policy.serviceBudgetsTinybar?.[service];
  if (Number.isInteger(serviceBudgetTinybar)) {
    const serviceSpentTinybar = ledger.reservations
      .filter((reservation) => reservation.service === service)
      .reduce((sum, reservation) => sum + Number(reservation.amountTinybar), 0);
    const serviceRemainingTinybar = serviceBudgetTinybar - serviceSpentTinybar;

    if (requestedTinybar > serviceRemainingTinybar) {
      reasons.push(`price ${requestedTinybar} tinybar exceeds ${service} budget remaining ${serviceRemainingTinybar}`);
    }
  }

  if (paymentRequirement.network !== "hedera:testnet") {
    reasons.push(`network ${paymentRequirement.network} is not allowed for this MVP`);
  }

  if (paymentRequirement.asset !== "0.0.0") {
    reasons.push(`asset ${paymentRequirement.asset} is not allowed for this MVP`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    requestedTinybar,
    remainingTinybar
  };
}

export function recordSpend({ ledger, requestId, service, amountTinybar, transactionId }) {
  ledger.spentTinybar += amountTinybar;
  ledger.reservations.push({
    requestId,
    service,
    amountTinybar,
    transactionId
  });
}

export const defaultUserPolicy = Object.freeze({
  id: "policy_demo_v1",
  targetAsset: "ETH",
  sessionBudgetTinybar: 20_000_000,
  maxPaidAgentCallTinybar: 5_000_000,
  allowedPaidAgents: ["market-signal", "risk-challenge"],
  paidAgentBudgetsTinybar: {
    "market-signal": 12_000_000,
    "risk-challenge": 6_000_000
  },
  autoPayEnabled: true,
  allowance: {
    ownerAccountId: "0.0.1001",
    spenderAccountId: "0.0.3003",
    merchantAccountId: "0.0.2002",
    allowanceTinybar: 20_000_000,
    spentTinybar: 0
  },
  sessionEscrow: {
    status: "authorized",
    sessionId: "demo_session_policy_demo_v1",
    payerAccountId: "0.0.1001",
    authorizedBudgetTinybar: 20_000_000,
    availableBalanceTinybar: 20_000_000,
    spentTinybar: 0,
    fundingReference: "local://session-budget",
    authorizedAt: null
  },
  dailyBudgetTinybar: 20_000_000,
  maxPaymentPerCallTinybar: 5_000_000,
  allowedServices: ["market-signal", "risk-challenge"],
  serviceBudgetsTinybar: {
    "market-signal": 12_000_000,
    "risk-challenge": 6_000_000
  },
  executionMode: "simulation",
  riskRules: ["paid_agent_calls_must_stay_within_user_policy"]
});

export function createBudgetLedger(policy) {
  const normalized = normalizeUserPolicy(policy);

  return {
    policyId: normalized.id,
    spentTinybar: 0,
    reservations: [],
    charges: [],
    allowanceSpentTinybar: normalized.allowance.spentTinybar,
    escrowSpentTinybar: 0,
    escrowCharges: [],
    accounts: {
      ownerAccountId: normalized.allowance.ownerAccountId,
      spenderAccountId: normalized.allowance.spenderAccountId,
      merchantAccountId: normalized.allowance.merchantAccountId
    }
  };
}

export function checkAgentQuoteAllowed({ policy, ledger, agentQuote, service }) {
  const normalized = normalizeUserPolicy(policy);
  const requestedTinybar = Number(agentQuote.quotedTinybar ?? agentQuote.amount);
  const remainingTinybar = normalized.sessionBudgetTinybar - ledger.spentTinybar;
  const reasons = [];

  if (!normalized.autoPayEnabled) {
    reasons.push("automatic paid agent billing is disabled by user policy");
  }

  if (!normalized.allowedPaidAgents.includes(service)) {
    reasons.push(`paid agent ${service} is not allowed`);
  }

  if (requestedTinybar > normalized.maxPaidAgentCallTinybar) {
    reasons.push(`quote ${requestedTinybar} tinybar exceeds per-agent call limit ${normalized.maxPaidAgentCallTinybar}`);
  }

  if (requestedTinybar > remainingTinybar) {
    reasons.push(`quote ${requestedTinybar} tinybar exceeds remaining budget ${remainingTinybar}`);
  }

  const paidAgentBudgetTinybar = normalized.paidAgentBudgetsTinybar?.[service];
  if (Number.isInteger(paidAgentBudgetTinybar)) {
    const serviceSpentTinybar = ledger.reservations
      .filter((reservation) => reservation.service === service)
      .reduce((sum, reservation) => sum + Number(reservation.amountTinybar), 0);
    const serviceRemainingTinybar = paidAgentBudgetTinybar - serviceSpentTinybar;

    if (requestedTinybar > serviceRemainingTinybar) {
      reasons.push(`quote ${requestedTinybar} tinybar exceeds ${service} paid agent budget remaining ${serviceRemainingTinybar}`);
    }
  }

  if (agentQuote.network && agentQuote.network !== "hedera:testnet") {
    reasons.push(`network ${agentQuote.network} is not allowed for this MVP`);
  }

  if (agentQuote.asset && agentQuote.asset !== "0.0.0") {
    reasons.push(`asset ${agentQuote.asset} is not allowed for this MVP`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    service,
    agent: agentQuote.agent,
    reasoningTier: agentQuote.reasoningTier,
    quoteId: agentQuote.quoteId,
    requestedTinybar,
    remainingTinybar,
    budgetBoundary: {
      sessionBudgetTinybar: normalized.sessionBudgetTinybar,
      maxPaidAgentCallTinybar: normalized.maxPaidAgentCallTinybar,
      paidAgentBudgetTinybar: paidAgentBudgetTinybar ?? null,
      allowedPaidAgents: normalized.allowedPaidAgents
    }
  };
}

export function checkPaymentAllowed({ policy, ledger, paymentRequirement, service }) {
  const normalized = normalizeUserPolicy(policy);
  const quoteDecision = checkAgentQuoteAllowed({
    policy,
    ledger,
    service,
    agentQuote: {
      agent: service,
      service,
      quotedTinybar: Number(paymentRequirement.amount),
      network: paymentRequirement.network,
      asset: paymentRequirement.asset,
      quoteId: paymentRequirement.extra?.requestId
    }
  });
  const requestedTinybar = quoteDecision.requestedTinybar;
  const allowanceRemainingTinybar = normalized.allowance.allowanceTinybar
    - Number(normalized.allowance.spentTinybar ?? 0)
    - Number(ledger.allowanceSpentTinybar ?? 0);
  const escrowRemainingTinybar = Number(normalized.sessionEscrow.availableBalanceTinybar ?? 0)
    - Number(ledger.escrowSpentTinybar ?? 0);
  if (normalized.sessionEscrow.status !== "authorized") {
    quoteDecision.reasons.push("session budget escrow is not authorized");
  }

  if (requestedTinybar > escrowRemainingTinybar) {
    quoteDecision.reasons.push(`price ${requestedTinybar} tinybar exceeds remaining session escrow balance ${escrowRemainingTinybar}`);
  }

  if (normalized.allowance.merchantAccountId && paymentRequirement.payTo !== normalized.allowance.merchantAccountId) {
    quoteDecision.reasons.push(`payTo ${paymentRequirement.payTo} does not match Oasis merchant account ${normalized.allowance.merchantAccountId}`);
  }

  return {
    ...quoteDecision,
    allowed: quoteDecision.reasons.length === 0,
    requestedTinybar,
    allowanceRemainingTinybar,
    escrowRemainingTinybar,
    sessionId: normalized.sessionEscrow.sessionId,
    accounts: {
      ownerAccountId: normalized.allowance.ownerAccountId,
      spenderAccountId: normalized.allowance.spenderAccountId,
      merchantAccountId: normalized.allowance.merchantAccountId
    }
  };
}

export function recordAgentCharge({ ledger, quoteId, service, agent, reasoningTier, amountTinybar, transactionId, usage, pricingModel }) {
  ledger.spentTinybar += amountTinybar;
  ledger.allowanceSpentTinybar = Number(ledger.allowanceSpentTinybar ?? 0) + amountTinybar;
  ledger.escrowSpentTinybar = Number(ledger.escrowSpentTinybar ?? 0) + amountTinybar;
  const charge = {
    quoteId,
    service,
    agent,
    reasoningTier,
    amountTinybar,
    usage,
    pricingModel,
    transactionId,
    chargedAt: new Date().toISOString()
  };
  ledger.charges.push(charge);
  ledger.escrowCharges.push(charge);
  ledger.reservations.push({
    requestId: quoteId,
    service,
    amountTinybar,
    transactionId
  });
  return charge;
}

export function recordSpend({ ledger, requestId, service, amountTinybar, transactionId }) {
  return recordAgentCharge({
    ledger,
    quoteId: requestId,
    requestId,
    service,
    agent: service,
    reasoningTier: "standard",
    amountTinybar,
    transactionId
  });
}

export function normalizeUserPolicy(policy = defaultUserPolicy) {
  const sessionBudgetTinybar = policy.sessionBudgetTinybar ?? policy.dailyBudgetTinybar ?? defaultUserPolicy.sessionBudgetTinybar;
  const maxPaidAgentCallTinybar = policy.maxPaidAgentCallTinybar
    ?? policy.maxPaymentPerCallTinybar
    ?? defaultUserPolicy.maxPaidAgentCallTinybar;
  const allowedPaidAgents = policy.allowedPaidAgents ?? policy.allowedServices ?? defaultUserPolicy.allowedPaidAgents;
  const paidAgentBudgetsTinybar = policy.paidAgentBudgetsTinybar
    ?? policy.serviceBudgetsTinybar
    ?? defaultUserPolicy.paidAgentBudgetsTinybar;
  const allowance = {
    ...defaultUserPolicy.allowance,
    ...(policy.allowance ?? {})
  };
  const sessionEscrow = {
    ...defaultUserPolicy.sessionEscrow,
    ...(policy.sessionEscrow ?? {}),
    payerAccountId: policy.sessionEscrow?.payerAccountId
      ?? allowance.ownerAccountId
      ?? defaultUserPolicy.sessionEscrow.payerAccountId,
    authorizedBudgetTinybar: policy.sessionEscrow?.authorizedBudgetTinybar
      ?? sessionBudgetTinybar,
    availableBalanceTinybar: policy.sessionEscrow?.availableBalanceTinybar
      ?? policy.sessionEscrow?.authorizedBudgetTinybar
      ?? sessionBudgetTinybar
  };

  return {
    ...policy,
    sessionBudgetTinybar,
    maxPaidAgentCallTinybar,
    allowedPaidAgents,
    paidAgentBudgetsTinybar,
    autoPayEnabled: policy.autoPayEnabled ?? true,
    allowance,
    sessionEscrow,
    dailyBudgetTinybar: sessionBudgetTinybar,
    maxPaymentPerCallTinybar: maxPaidAgentCallTinybar,
    allowedServices: allowedPaidAgents,
    serviceBudgetsTinybar: paidAgentBudgetsTinybar
  };
}

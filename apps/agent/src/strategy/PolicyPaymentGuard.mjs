import { checkAgentQuoteAllowed, checkPaymentAllowed } from "../../../../packages/policy/src/index.mjs";

export class PolicyPaymentGuard {
  checkBeforeAgentCharge({ policy, ledger, agentQuote, service, plannedCall }) {
    const policyDecision = checkAgentQuoteAllowed({
      policy,
      ledger,
      agentQuote,
      service
    });
    const reasons = [...policyDecision.reasons];
    const requestedTinybar = Number(agentQuote.quotedTinybar);

    if (!plannedCall) {
      reasons.push(`service ${service} was not planned by Strategy Agent`);
    } else {
      if (plannedCall.service !== service) {
        reasons.push(`planned service ${plannedCall.service} does not match quote service ${service}`);
      }
      if (plannedCall.reasoningTier !== agentQuote.reasoningTier) {
        reasons.push(`quoted reasoning tier ${agentQuote.reasoningTier} does not match Strategy Agent plan ${plannedCall.reasoningTier}`);
      }
      if (requestedTinybar !== plannedCall.quotedTinybar) {
        reasons.push(`quote ${requestedTinybar} tinybar does not match Strategy Agent planned quote ${plannedCall.quotedTinybar}`);
      }
      if (requestedTinybar > plannedCall.maxWillingToPayTinybar) {
        reasons.push(`quote ${requestedTinybar} tinybar exceeds Strategy Agent willingness ${plannedCall.maxWillingToPayTinybar}`);
      }
    }

    return {
      ...policyDecision,
      allowed: reasons.length === 0,
      reasons,
      service,
      quoteId: agentQuote.quoteId
    };
  }

  checkBeforePayment({ policy, ledger, paymentRequirement, service, plannedCall }) {
    const policyDecision = checkPaymentAllowed({
      policy,
      ledger,
      paymentRequirement,
      service
    });
    const reasons = [...policyDecision.reasons];
    const requestedTinybar = Number(paymentRequirement.amount);

    if (!plannedCall) {
      reasons.push(`service ${service} was not planned by Strategy Agent`);
    } else if (requestedTinybar > plannedCall.maxWillingToPayTinybar) {
      reasons.push(`price ${requestedTinybar} tinybar exceeds Strategy Agent willingness ${plannedCall.maxWillingToPayTinybar}`);
    }

    return {
      ...policyDecision,
      allowed: reasons.length === 0,
      reasons,
      service,
      requestId: paymentRequirement.extra?.requestId
    };
  }

  finalCheck({ decision, policy, evidence }) {
    const blockingReasons = [];

    if (policy.executionMode !== "simulation" && decision.action.startsWith("SIMULATED_")) {
      blockingReasons.push(`executionMode ${policy.executionMode} cannot return a simulated action`);
    }

    if (decision.action === "PROPOSE_TRADE" && policy.executionMode === "simulation") {
      blockingReasons.push("live trade proposal is blocked because policy executionMode is simulation");
    }

    if (evidence.conflictLevel === "high" && decision.action !== "NO_TRADE" && decision.action !== "HOLD") {
      blockingReasons.push("high evidence conflict blocks directional execution");
    }

    if (decision.risk.blockingReasons.length > 0 && decision.action !== "NO_TRADE") {
      blockingReasons.push(...decision.risk.blockingReasons);
    }

    if (blockingReasons.length === 0) {
      return {
        allowed: true,
        decision,
        blockingReasons
      };
    }

    return {
      allowed: false,
      blockingReasons,
      decision: {
        ...decision,
        action: "NO_TRADE",
        confidence: Math.min(decision.confidence, 0.4),
        reason: `Final policy/risk check blocked execution: ${blockingReasons.join("; ")}`,
        risk: {
          ...decision.risk,
          level: "high",
          blockingReasons
        }
      }
    };
  }
}

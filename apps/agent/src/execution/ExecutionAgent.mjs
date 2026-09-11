import { createRequestId, nowIso } from "../../../../packages/shared/src/index.mjs";

export class ExecutionAgent {
  reviewAndSimulate({ state }) {
    const proposal = state.executionProposal;
    const blockingReasons = [];

    if (state.policy.executionMode !== "simulation") {
      blockingReasons.push("Execution Agent only supports simulation mode in this MVP");
    }

    if (!proposal.riskApproved) {
      blockingReasons.push("risk checks did not approve execution");
    }

    if (!proposal.policyApproved) {
      blockingReasons.push("one or more payment policy checks failed");
    }

    if (!["SIMULATED_BUY", "SIMULATED_SELL"].includes(proposal.action)) {
      blockingReasons.push(`action ${proposal.action} does not require a simulated order`);
    }

    if (blockingReasons.length > 0) {
      return {
        agent: "Execution Agent",
        status: "blocked",
        simulatedOrder: null,
        blockingReasons,
        reviewedAt: nowIso()
      };
    }

    return {
      agent: "Execution Agent",
      status: "simulated",
      blockingReasons,
      simulatedOrder: {
        orderId: createRequestId("sim_order"),
        asset: state.asset,
        side: proposal.action === "SIMULATED_BUY" ? "BUY" : "SELL",
        mode: "simulation",
        referencePriceUsd: state.evidence.marketSignal?.spotPriceUsd ?? state.marketContext.snapshot.spotPriceUsd,
        confidence: proposal.confidence,
        reason: state.decision.reason,
        createdAt: nowIso()
      },
      reviewedAt: nowIso()
    };
  }
}

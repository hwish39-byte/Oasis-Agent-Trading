import { createRequestId, nowIso } from "../../../../packages/shared/src/index.mjs";

export class ExecutionAgent {
  reviewAndSimulate({ state }) {
    const proposal = state.executionProposal;
    const isZh = state.locale === "zh-CN";
    const blockingReasons = [];

    if (state.policy.executionMode !== "simulation") {
      blockingReasons.push(isZh ? "当前 MVP 中 Execution Agent 只支持模拟模式" : "Execution Agent only supports simulation mode in this MVP");
    }

    if (!proposal.riskApproved) {
      blockingReasons.push(isZh ? "风险检查未批准执行" : "risk checks did not approve execution");
    }

    if (!proposal.policyApproved) {
      blockingReasons.push(isZh ? "一个或多个支付 policy 检查未通过" : "one or more payment policy checks failed");
    }

    if (!["SIMULATED_BUY", "SIMULATED_SELL"].includes(proposal.action)) {
      blockingReasons.push(isZh ? `动作 ${proposal.action} 不需要创建模拟订单` : `action ${proposal.action} does not require a simulated order`);
    }

    if (blockingReasons.length > 0) {
      return {
        agent: "Execution Agent",
        status: "blocked",
        simulatedOrder: null,
        simulationReport: {
          mode: "simulation",
          outcome: "not_executed",
          explanation: blockingReasons.join(isZh ? "；" : "; ")
        },
        blockingReasons,
        reviewedAt: nowIso()
      };
    }
    const side = proposal.action === "SIMULATED_BUY" ? "BUY" : "SELL";
    const referencePriceUsd = Number(state.evidence.marketSignal?.spotPriceUsd ?? state.marketContext.snapshot.spotPriceUsd ?? 0);
    const confidence = Number(proposal.confidence ?? state.decision.confidence ?? 0.5);
    const notionalUsd = estimateNotionalUsd({ confidence, policy: state.policy });
    const quantity = referencePriceUsd > 0 ? round(notionalUsd / referencePriceUsd, 6) : 0;
    const slippageBps = confidence >= 0.75 ? 8 : 15;
    const feeBps = 5;
    const fillAdjustment = side === "BUY" ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
    const fillPriceUsd = round(referencePriceUsd * fillAdjustment, 2);
    const stopLossPct = side === "BUY" ? -0.025 : 0.025;
    const takeProfitPct = side === "BUY" ? 0.045 : -0.045;
    const stopLossUsd = round(fillPriceUsd * (1 + stopLossPct), 2);
    const takeProfitUsd = round(fillPriceUsd * (1 + takeProfitPct), 2);
    const estimatedFeesUsd = round(notionalUsd * feeBps / 10_000, 4);
    const projectedMovePct = estimateProjectedMovePct({ state, side });
    const projectedExitPriceUsd = round(fillPriceUsd * (1 + projectedMovePct), 2);
    const grossPnlUsd = side === "BUY"
      ? (projectedExitPriceUsd - fillPriceUsd) * quantity
      : (fillPriceUsd - projectedExitPriceUsd) * quantity;
    const simulatedPnlUsd = round(grossPnlUsd - estimatedFeesUsd, 4);

    return {
      agent: "Execution Agent",
      status: "simulated",
      blockingReasons,
      simulatedOrder: {
        orderId: createRequestId("sim_order"),
        asset: state.asset,
        side,
        mode: "simulation",
        referencePriceUsd,
        fillPriceUsd,
        quantity,
        notionalUsd,
        stopLossUsd,
        takeProfitUsd,
        confidence: proposal.confidence,
        reason: state.decision.reason,
        createdAt: nowIso()
      },
      simulationReport: {
        mode: "simulation",
        outcome: "filled",
        projectedExitPriceUsd,
        simulatedPnlUsd,
        estimatedFeesUsd,
        slippageBps,
        feeBps,
        riskReward: round(Math.abs(takeProfitUsd - fillPriceUsd) / Math.max(0.01, Math.abs(fillPriceUsd - stopLossUsd)), 2),
        maxDrawdownPct: side === "BUY" ? -2.5 : -2.5,
        explanation: isZh
          ? "Execution Agent 根据最终策略生成了仅模拟成交；没有调用交易所 API，也没有真实下单。"
          : "Execution Agent generated a simulation-only fill from the final strategy; no exchange API or live order was used."
      },
      reviewedAt: nowIso()
    };
  }
}

function estimateNotionalUsd({ confidence, policy }) {
  const base = policy.riskRules?.some((rule) => String(rule).includes("conservative")) ? 750 : 1_000;
  return round(base * Math.min(1, Math.max(0.35, confidence)), 2);
}

function estimateProjectedMovePct({ state, side }) {
  const score = Number(state.evidence?.evidenceScore ?? 0.5);
  const direction = side === "BUY" ? 1 : -1;
  const magnitude = 0.01 + Math.max(0, score - 0.5) * 0.04;
  return direction * magnitude;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

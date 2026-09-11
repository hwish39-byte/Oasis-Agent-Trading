import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class MemoryManager {
  constructor({
    decisionMemoryPath = resolve(process.cwd(), "data/decisions/strategy-decisions.jsonl"),
    performanceMemoryPath = resolve(process.cwd(), "data/decisions/strategy-performance.jsonl")
  } = {}) {
    this.decisionMemoryPath = decisionMemoryPath;
    this.performanceMemoryPath = performanceMemoryPath;
  }

  async retrieve({ asset, limit = 5 } = {}) {
    const decisions = await readJsonl(this.decisionMemoryPath);
    const similarDecisions = decisions
      .filter((item) => !asset || item.asset === asset)
      .slice(-limit)
      .reverse();
    const performance = await readJsonl(this.performanceMemoryPath);

    return {
      similarDecisions,
      performanceSummary: summarizePerformance(performance)
    };
  }

  async storeDecision({ state }) {
    const decision = state.decision;
    const entry = {
      timestamp: new Date().toISOString(),
      runId: state.runId,
      decisionId: decision.decisionId,
      asset: state.asset,
      marketRegime: state.marketContext.regime,
      action: decision.action,
      confidence: decision.confidence,
      evidenceScore: state.evidence.evidenceScore,
      conflictLevel: state.evidence.conflictLevel,
      paidServices: state.payments.map((payment) => payment.service),
      totalCostTinybar: state.payments.reduce((sum, payment) => sum + Number(payment.amountTinybar ?? 0), 0),
      executionStatus: state.executionResult?.status,
      simulatedOrderId: state.executionResult?.simulatedOrder?.orderId,
      reason: decision.reason,
      auditHash: state.audit?.messageHash
    };

    await appendJsonl(this.decisionMemoryPath, entry);
    return entry;
  }

  async storePerformanceReview(review) {
    await appendJsonl(this.performanceMemoryPath, {
      timestamp: new Date().toISOString(),
      ...review
    });
  }
}

export class ReviewScheduler {
  createReviewPlan({ decisionId }) {
    return [
      { decisionId, reviewAfter: "1h" },
      { decisionId, reviewAfter: "4h" },
      { decisionId, reviewAfter: "24h" },
      { decisionId, reviewAfter: "7d" }
    ];
  }
}

async function appendJsonl(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonl(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function summarizePerformance(reviews) {
  if (reviews.length === 0) {
    return {
      reviewCount: 0,
      recentFalsePositiveRate: 0,
      serviceValue: {}
    };
  }

  const recent = reviews.slice(-20);
  const falsePositives = recent.filter((item) => item.outcome === "false_positive").length;

  return {
    reviewCount: reviews.length,
    recentFalsePositiveRate: falsePositives / recent.length,
    serviceValue: summarizeServiceValue(recent)
  };
}

function summarizeServiceValue(reviews) {
  const serviceValue = {};
  for (const review of reviews) {
    for (const service of review.paidServices ?? []) {
      serviceValue[service] ??= { uses: 0, useful: 0 };
      serviceValue[service].uses += 1;
      if (review.informationWasUseful) serviceValue[service].useful += 1;
    }
  }
  return serviceValue;
}

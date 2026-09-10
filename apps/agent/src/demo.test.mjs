import test from "node:test";
import assert from "node:assert/strict";
import { runSingleAgentDemo } from "./demo.mjs";
import { StrategyAgent } from "./strategy/StrategyAgent.mjs";
import { MemoryManager } from "./strategy/MemoryManager.mjs";

test("single agent demo completes x402 payment loop and returns a strategy decision", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  const memoryManager = new MemoryManager({
    decisionMemoryPath: `${testTempDir()}/strategy-decisions.jsonl`,
    performanceMemoryPath: `${testTempDir()}/strategy-performance.jsonl`
  });

  try {
    const result = await runSingleAgentDemo({
      strategyAgent: new StrategyAgent({ memoryManager })
    });

    assert.equal(result.finalDecision, "NO_TRADE");
    assert.equal(result.budget.spentTinybar, 3_000_000);
    assert.equal(result.payment.network, "hedera:testnet");
    assert.equal(result.payment.asset, "0.0.0");
    assert.match(result.payment.transactionId, /^0\.0\.1001@/);
    assert.equal(result.audit.mode, "mock");
    assert.equal(result.hypothesis.generatedBy, "rule_based_fallback");
    assert.equal(result.evidence.evidenceQuality, "low");
    assert.equal(result.decision.action, "NO_TRADE");
    assert.equal(result.coordination.some((message) => message.type === "ResearchRequest"), true);
    assert.equal(result.executionProposal.toAgent, "Execution Agent");
    assert.equal(result.metrics.paymentsSettled, 1);
    assert.equal(result.timeline.some((event) => event.step === "payment_required"), true);
    assert.equal(result.timeline.some((event) => event.step === "payment_settled"), true);
    assert.equal(result.timeline.some((event) => event.step === "signal_delivered"), true);
    assert.equal(result.timeline.some((event) => event.stateStep === "generate_hypothesis"), true);
  } finally {
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
  }
});

function testTempDir() {
  return new URL(`../../../.tmp-tests/${process.pid}`, import.meta.url).pathname;
}

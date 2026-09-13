import test from "node:test";
import assert from "node:assert/strict";
import { runSingleAgentDemo } from "./demo.mjs";
import { StrategyAgent } from "./strategy/StrategyAgent.mjs";
import { MemoryManager } from "./strategy/MemoryManager.mjs";
import { AuditLogger } from "./strategy/AuditLogger.mjs";

test("single agent demo charges quoted paid agents inside the user budget boundary", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousMarketMode = process.env.OASIS_MARKET_DATA_MODE;
  const previousLlmMode = process.env.OASIS_LLM_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  process.env.OASIS_MARKET_DATA_MODE = "fixture";
  process.env.OASIS_LLM_MODE = "rule";
  const memoryManager = new MemoryManager({
    decisionMemoryPath: `${testTempDir()}/strategy-decisions.jsonl`,
    performanceMemoryPath: `${testTempDir()}/strategy-performance.jsonl`
  });

  try {
    const result = await runSingleAgentDemo({
      strategyAgent: new StrategyAgent({ memoryManager })
    });

    assert.equal(result.finalDecision, "NO_TRADE");
    assert.equal(
      result.budget.spentTinybar,
      result.budget.charges.reduce((sum, charge) => sum + Number(charge.amountTinybar), 0)
    );
    assert.equal(result.budget.spentTinybar > 2_000_000, true);
    assert.equal(result.payment.network, "hedera:testnet");
    assert.equal(result.payment.asset, "0.0.0");
    assert.match(result.payment.transactionId, /^0\.0\.1001@/);
    assert.equal(result.audit.mode, "mock");
    assert.equal(result.hypothesis.generatedBy, "rule_based_fallback");
    assert.equal(result.evidence.evidenceQuality, "low");
    assert.equal(result.evidence.riskChallenge.verdict, "block");
    assert.equal(result.decision.action, "NO_TRADE");
    assert.equal(result.coordination.some((message) => message.type === "RiskChallengeRequest"), true);
    assert.equal(result.coordination.every((message) => Number.isInteger(message.quotedTinybar)), true);
    assert.equal(result.executionProposal.toAgent, "Execution Agent");
    assert.equal(result.executionResult.status, "blocked");
    assert.equal(result.metrics.paymentsSettled, result.budget.charges.length);
    assert.equal(result.metrics.paymentsSettled >= 1, true);
    assert.equal(result.committeeTranscript.some((event) => event.agent === "Risk Agent"), true);
    assert.equal(result.committeeTranscript.some((event) => event.pricingModel === "usage_based_risk_workload"), true);
    assert.equal(result.timeline.some((event) => event.step === "agent_quote" && event.usage), true);
    assert.equal(result.committeeTranscript.some((event) => event.action === "approve_agent_charge"), true);
    assert.equal(result.timeline.some((event) => event.step === "agent_quote"), true);
    assert.equal(result.timeline.some((event) => event.step === "budget_check"), true);
    assert.equal(result.timeline.some((event) => event.step === "agent_charge_settled"), true);
    assert.equal(result.timeline.some((event) => event.step === "signal_delivered"), true);
    assert.equal(result.timeline.some((event) => event.stateStep === "generate_hypothesis"), true);
  } finally {
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
    if (previousMarketMode === undefined) delete process.env.OASIS_MARKET_DATA_MODE;
    else process.env.OASIS_MARKET_DATA_MODE = previousMarketMode;
    if (previousLlmMode === undefined) delete process.env.OASIS_LLM_MODE;
    else process.env.OASIS_LLM_MODE = previousLlmMode;
  }
});

test("audit logger reports HCS failures without blocking a completed decision", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousTopic = process.env.HCS_TOPIC_ID;
  process.env.HEDERA_PAYMENT_MODE = "real";
  process.env.HCS_TOPIC_ID = "mock-topic";

  const audit = await new AuditLogger().write({
    state: {
      runId: "strategy_run_test",
      marketContext: { snapshot: { asset: "ETH" } },
      hypothesis: { generatedBy: "rule_based_fallback", reasoning: ["测试假设"] },
      decision: { action: "HOLD", reason: "测试完成" },
      payments: [],
      policy: { id: "policy_test" }
    }
  });

  assert.equal(audit.status, "failed");
  assert.equal(audit.mode, "failed");
  assert.match(audit.error, /hcsTopicId/);

  if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
  else process.env.HEDERA_PAYMENT_MODE = previousMode;
  if (previousTopic === undefined) delete process.env.HCS_TOPIC_ID;
  else process.env.HCS_TOPIC_ID = previousTopic;
});

test("strategy agent returns Simplified Chinese fallback copy when locale is zh-CN", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousMarketMode = process.env.OASIS_MARKET_DATA_MODE;
  const previousLlmMode = process.env.OASIS_LLM_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  process.env.OASIS_MARKET_DATA_MODE = "fixture";
  process.env.OASIS_LLM_MODE = "rule";

  try {
    const agent = new StrategyAgent({ locale: "zh-CN" });
    const intent = await agent.parseIntent({
      message: "我想做 ETH 4h 突破策略，预算 0.2 HBAR，风险保守。",
      modelConfig: { provider: "rule" },
      locale: "zh-CN"
    });
    const policy = agent.draftPolicy({ intent });
    const draft = await agent.draftStrategy({
      intent,
      policy,
      modelConfig: { provider: "rule" },
      locale: "zh-CN"
    });
    const plan = await agent.planEvidence({
      intent,
      policy,
      modelConfig: { provider: "rule" },
      locale: "zh-CN"
    });

    assert.match(draft.thesis, /只有当/);
    assert.equal(plan.hypothesis.reasoning.some((item) => /当前市场状态|市场数据来源/.test(item)), true);
    assert.match(plan.agentPlan.reason, /Strategy Agent 发现证据缺口|现有证据足够/);
  } finally {
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
    if (previousMarketMode === undefined) delete process.env.OASIS_MARKET_DATA_MODE;
    else process.env.OASIS_MARKET_DATA_MODE = previousMarketMode;
    if (previousLlmMode === undefined) delete process.env.OASIS_LLM_MODE;
    else process.env.OASIS_LLM_MODE = previousLlmMode;
  }
});

function testTempDir() {
  return new URL(`../../../.tmp-tests/${process.pid}`, import.meta.url).pathname;
}

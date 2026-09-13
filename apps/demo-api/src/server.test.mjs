import test from "node:test";
import assert from "node:assert/strict";
import { closeDemoApiServer, createDemoApiServer } from "./server.mjs";

test("demo API serves frontend and runs the local agent loop in mock mode", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousMarketMode = process.env.OASIS_MARKET_DATA_MODE;
  const previousLlmMode = process.env.OASIS_LLM_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  process.env.OASIS_MARKET_DATA_MODE = "fixture";
  process.env.OASIS_LLM_MODE = "rule";
  const { server, baseUrl } = await createDemoApiServer({ port: 0 });

  try {
    const pageResponse = await fetch(`${baseUrl}/`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /Oasis Strategy Workspace/);

    const runResponse = await fetch(`${baseUrl}/demo/run`, { method: "POST" });
    const result = await runResponse.json();

    assert.equal(runResponse.status, 200);
    assert.equal(result.finalDecision, "NO_TRADE");
    assert.equal(
      result.budget.spentTinybar,
      result.budget.charges.reduce((sum, charge) => sum + Number(charge.amountTinybar), 0)
    );
    assert.equal(result.budget.spentTinybar > 2_000_000, true);
    assert.equal(result.metrics.paymentsSettled, result.budget.charges.length);
    assert.equal(result.metrics.paymentsSettled >= 1, true);
    assert.equal(result.timeline.some((event) => event.step === "agent_quote"), true);
    assert.equal(result.timeline.some((event) => event.step === "agent_charge_settled"), true);
    assert.equal(result.committeeTranscript.some((event) => event.agent === "Execution Agent"), true);
  } finally {
    await closeDemoApiServer(server);
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
    if (previousMarketMode === undefined) delete process.env.OASIS_MARKET_DATA_MODE;
    else process.env.OASIS_MARKET_DATA_MODE = previousMarketMode;
    if (previousLlmMode === undefined) delete process.env.OASIS_LLM_MODE;
    else process.env.OASIS_LLM_MODE = previousLlmMode;
  }
});

test("strategy product APIs build intent policy draft strategy draft and plan", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousMarketMode = process.env.OASIS_MARKET_DATA_MODE;
  const previousLlmMode = process.env.OASIS_LLM_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  process.env.OASIS_MARKET_DATA_MODE = "fixture";
  process.env.OASIS_LLM_MODE = "rule";
  const { server, baseUrl } = await createDemoApiServer({ port: 0 });

  try {
    const intentResponse = await fetch(`${baseUrl}/strategy/intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "我想做 ETH 4h 突破策略，最多花 0.2 HBAR，单次服务别超过 0.05 HBAR，只做模拟交易，风险保守。"
      })
    });
    const intent = await intentResponse.json();
    assert.equal(intentResponse.status, 200);
    assert.equal(intent.status, "ready");
    assert.equal(intent.asset, "ETH");
    assert.equal(intent.dailyResearchBudgetTinybar, 20_000_000);

    const policyResponse = await fetch(`${baseUrl}/strategy/policy/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent })
    });
    const { policyDraft } = await policyResponse.json();
    assert.equal(policyDraft.targetAsset, "ETH");
    assert.equal(policyDraft.sessionBudgetTinybar, 20_000_000);
    assert.equal(policyDraft.allowedPaidAgents.includes("market-signal"), true);
    assert.equal(policyDraft.autoPayEnabled, true);

    const strategyResponse = await fetch(`${baseUrl}/strategy/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, policy: policyDraft })
    });
    const { strategyDraft } = await strategyResponse.json();
    assert.match(strategyDraft.name, /ETH/);
    assert.equal(strategyDraft.requiredEvidence.includes("Market Agent"), true);

    const planResponse = await fetch(`${baseUrl}/strategy/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, policy: policyDraft })
    });
    const plan = await planResponse.json();
    assert.equal(plan.hypothesis.asset, "ETH");
    assert.equal(plan.agentPlan.plannedToolCalls.some((call) => call.service === "market-signal"), true);
    assert.equal(plan.agentPlan.plannedToolCalls.some((call) => call.agent === "Market Agent"), true);
    assert.equal(plan.agentPlan.plannedToolCalls.every((call) => Number.isInteger(call.quotedTinybar)), true);
    assert.equal(plan.agentPlan.plannedToolCalls.every((call) => typeof call.reasoningTier === "string"), true);

    const unapprovedRunResponse = await fetch(`${baseUrl}/strategy/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: intent.message,
        intent,
        policy: {
          ...policyDraft,
          sessionEscrow: {
            status: "not_authorized",
            authorizedBudgetTinybar: 0,
            availableBalanceTinybar: 0
          }
        },
        strategyDraft,
        modelConfig: { provider: "rule" }
      })
    });
    assert.equal(unapprovedRunResponse.status, 403);
    const unapprovedRun = await unapprovedRunResponse.json();
    assert.equal(unapprovedRun.error, "budget_authorization_required");

    const authorizeResponse = await fetch(`${baseUrl}/billing/session/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionBudgetTinybar: policyDraft.sessionBudgetTinybar
      })
    });
    const sessionEscrow = await authorizeResponse.json();
    assert.equal(authorizeResponse.status, 200);
    assert.equal(sessionEscrow.status, "authorized");
    const authorizedPolicy = {
      ...policyDraft,
      sessionEscrow
    };

    const runResponse = await fetch(`${baseUrl}/strategy/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: intent.message,
        intent,
        policy: authorizedPolicy,
        strategyDraft,
        modelConfig: { provider: "rule" }
      })
    });
    const run = await runResponse.json();
    assert.equal(runResponse.status, 200);
    assert.equal(run.timeline.some((event) => event.step === "agent_charge_authorized"), true);
  } finally {
    await closeDemoApiServer(server);
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
    if (previousMarketMode === undefined) delete process.env.OASIS_MARKET_DATA_MODE;
    else process.env.OASIS_MARKET_DATA_MODE = previousMarketMode;
    if (previousLlmMode === undefined) delete process.env.OASIS_LLM_MODE;
    else process.env.OASIS_LLM_MODE = previousLlmMode;
  }
});

test("audit messages API returns an empty mock timeline without a real HCS topic", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousTopic = process.env.HCS_TOPIC_ID;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  process.env.HCS_TOPIC_ID = "mock-topic";
  const { server, baseUrl } = await createDemoApiServer({ port: 0 });

  try {
    const auditResponse = await fetch(`${baseUrl}/audit/messages`);
    const audit = await auditResponse.json();

    assert.equal(auditResponse.status, 200);
    assert.equal(audit.mode, "mock");
    assert.equal(audit.hcsTopicId, "mock-topic");
    assert.deepEqual(audit.messages, []);
  } finally {
    await closeDemoApiServer(server);
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
    if (previousTopic === undefined) delete process.env.HCS_TOPIC_ID;
    else process.env.HCS_TOPIC_ID = previousTopic;
  }
});

test("Hedera status API exposes mock account and readiness state", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousTopic = process.env.HCS_TOPIC_ID;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  process.env.HCS_TOPIC_ID = "mock-topic";
  const { server, baseUrl } = await createDemoApiServer({ port: 0 });

  try {
    const statusResponse = await fetch(`${baseUrl}/hedera/status`);
    const status = await statusResponse.json();

    assert.equal(statusResponse.status, 200);
    assert.equal(status.mode, "mock");
    assert.equal(status.network, "testnet");
    assert.equal(status.hcs.ready, false);
    assert.equal(status.accounts.some((account) => account.role === "payer"), true);
  } finally {
    await closeDemoApiServer(server);
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
    if (previousTopic === undefined) delete process.env.HCS_TOPIC_ID;
    else process.env.HCS_TOPIC_ID = previousTopic;
  }
});

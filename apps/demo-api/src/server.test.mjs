import test from "node:test";
import assert from "node:assert/strict";
import { closeDemoApiServer, createDemoApiServer } from "./server.mjs";

test("demo API serves frontend and runs the local agent loop in mock mode", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";
  const { server, baseUrl } = await createDemoApiServer({ port: 0 });

  try {
    const pageResponse = await fetch(`${baseUrl}/`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /Oasis Strategy Workspace/);

    const runResponse = await fetch(`${baseUrl}/demo/run`, { method: "POST" });
    const result = await runResponse.json();

    assert.equal(runResponse.status, 200);
    assert.equal(result.finalDecision, "NO_TRADE");
    assert.equal(result.budget.spentTinybar, 3_000_000);
    assert.equal(result.timeline.some((event) => event.step === "payment_required"), true);
    assert.equal(result.timeline.some((event) => event.step === "payment_settled"), true);
  } finally {
    await closeDemoApiServer(server);
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
  }
});

test("strategy product APIs build intent policy draft strategy draft and plan", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";
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
    assert.equal(policyDraft.allowedServices.includes("market-signal"), true);

    const strategyResponse = await fetch(`${baseUrl}/strategy/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, policy: policyDraft })
    });
    const { strategyDraft } = await strategyResponse.json();
    assert.match(strategyDraft.name, /ETH/);
    assert.equal(strategyDraft.requiredEvidence.includes("market-signal"), true);

    const planResponse = await fetch(`${baseUrl}/strategy/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, policy: policyDraft })
    });
    const plan = await planResponse.json();
    assert.equal(plan.hypothesis.asset, "ETH");
    assert.equal(plan.agentPlan.plannedToolCalls.some((call) => call.service === "market-signal"), true);
  } finally {
    await closeDemoApiServer(server);
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
  }
});

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
    assert.match(await pageResponse.text(), /Oasis Agent Trading Demo/);

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

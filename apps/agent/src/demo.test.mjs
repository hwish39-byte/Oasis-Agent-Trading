import test from "node:test";
import assert from "node:assert/strict";
import { runSingleAgentDemo } from "./demo.mjs";

test("single agent demo completes x402 payment loop and returns a strategy decision", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  process.env.HEDERA_PAYMENT_MODE = "mock";

  try {
    const result = await runSingleAgentDemo();

    assert.equal(result.finalDecision, "NO_TRADE");
    assert.equal(result.budget.spentTinybar, 3_000_000);
    assert.equal(result.payment.network, "hedera:testnet");
    assert.equal(result.payment.asset, "0.0.0");
    assert.match(result.payment.transactionId, /^0\.0\.1001@/);
    assert.equal(result.audit.mode, "mock");
    assert.equal(result.timeline.some((event) => event.step === "payment_required"), true);
    assert.equal(result.timeline.some((event) => event.step === "payment_settled"), true);
    assert.equal(result.timeline.some((event) => event.step === "signal_delivered"), true);
  } finally {
    if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
    else process.env.HEDERA_PAYMENT_MODE = previousMode;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createAgentPaymentPayload } from "./index.mjs";

test("real Hedera x402 mode fails fast when credentials are missing", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousPrivateKey = process.env.HEDERA_AGENT_PRIVATE_KEY;

  process.env.HEDERA_PAYMENT_MODE = "real";
  delete process.env.HEDERA_AGENT_PRIVATE_KEY;

  await assert.rejects(
    createAgentPaymentPayload({
      requestId: "market_test",
      policyId: "policy_demo_v1",
      paymentRequirement: {
        scheme: "exact",
        network: "hedera:testnet",
        asset: "0.0.0",
        amount: "3000000",
        payTo: "0.0.2002",
        extra: {
          feePayer: "0.0.7162784",
          requestId: "market_test"
        }
      }
    }),
    /Missing required real Hedera x402 configuration/
  );

  if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
  else process.env.HEDERA_PAYMENT_MODE = previousMode;

  if (previousPrivateKey === undefined) delete process.env.HEDERA_AGENT_PRIVATE_KEY;
  else process.env.HEDERA_AGENT_PRIVATE_KEY = previousPrivateKey;
});

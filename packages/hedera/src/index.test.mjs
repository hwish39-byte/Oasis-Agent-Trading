import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createAgentPaymentPayload,
  formatTinybarAmount,
  hashscanAccountUrl,
  hashscanTopicUrl,
  hashscanTransactionUrl,
  hederaNativeAccountToEvmAddress,
  writeAuditRecord
} from "./index.mjs";

const execFileAsync = promisify(execFile);

test("formats Hedera amounts, addresses, and HashScan links for demo output", async () => {
  assert.equal(formatTinybarAmount(3_000_000), "0.03 HBAR (3,000,000 tinybar)");
  assert.equal(await hederaNativeAccountToEvmAddress("0.0.12345"), "0x0000000000000000000000000000000000003039");
  assert.equal(hashscanAccountUrl("0.0.12345", "hedera:testnet"), "https://hashscan.io/testnet/account/0.0.12345");
  assert.equal(hashscanTopicUrl("0.0.67890", "testnet"), "https://hashscan.io/testnet/topic/0.0.67890");
  assert.equal(hashscanTransactionUrl("0.0.12345@1.2", "hedera:testnet"), "https://hashscan.io/testnet/transaction/0.0.12345@1.2");
});

test("mock audit records keep a hash and topic link shape", async () => {
  const previousMode = process.env.HEDERA_PAYMENT_MODE;
  const previousTopic = process.env.HCS_TOPIC_ID;
  const previousNetwork = process.env.HEDERA_NETWORK;

  process.env.HEDERA_PAYMENT_MODE = "mock";
  process.env.HEDERA_NETWORK = "testnet";
  process.env.HCS_TOPIC_ID = "0.0.67890";

  const audit = await writeAuditRecord({
    requestId: "run_1",
    decision: { action: "HOLD", reason: "risk rejected" },
    payment: { transactionId: "0.0.12345@1.2" }
  });

  assert.equal(audit.mode, "mock");
  assert.equal(audit.hcsTopicId, "0.0.67890");
  assert.match(audit.messageHash, /^[a-f0-9]{64}$/);
  assert.equal(audit.hashscanUrl, "https://hashscan.io/testnet/topic/0.0.67890");

  if (previousMode === undefined) delete process.env.HEDERA_PAYMENT_MODE;
  else process.env.HEDERA_PAYMENT_MODE = previousMode;

  if (previousTopic === undefined) delete process.env.HCS_TOPIC_ID;
  else process.env.HCS_TOPIC_ID = previousTopic;

  if (previousNetwork === undefined) delete process.env.HEDERA_NETWORK;
  else process.env.HEDERA_NETWORK = previousNetwork;
});

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

test("real payment smoke script refuses to run outside real mode", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["apps/agent/src/real-payment-smoke.mjs"], {
      cwd: new URL("../../../", import.meta.url).pathname,
      env: {
        ...process.env,
        HEDERA_PAYMENT_MODE: "mock",
        BLOCKY402_FACILITATOR_URL: "mock://blocky402"
      }
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Real Hedera x402 payment is not configured/);
      assert.match(error.stderr, /HEDERA_PAYMENT_MODE=real/);
      return true;
    }
  );
});

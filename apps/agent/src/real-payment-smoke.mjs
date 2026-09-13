import { createMarketSignalServer, closeMarketSignalServer } from "../../market-signal-api/src/server.mjs";
import { PolicyPaymentGuard } from "./strategy/PolicyPaymentGuard.mjs";
import { X402PaidToolClient } from "./strategy/X402PaidToolClient.mjs";
import { createBudgetLedger, defaultUserPolicy, normalizeUserPolicy } from "../../../packages/policy/src/index.mjs";
import { getHederaConfig, getRealConfigStatus, hashscanAccountUrl } from "../../../packages/hedera/src/index.mjs";
import { tinybarToHbar } from "../../../packages/shared/src/index.mjs";
import { quotePaidAgentCall } from "../../../packages/shared/src/pricing.mjs";

const SERVICE_QUOTE = quotePaidAgentCall({ service: "market-signal", reasoningTier: "standard" });
const SERVICE_PRICE_TINYBAR = SERVICE_QUOTE.quotedTinybar;

const status = getRealConfigStatus();

if (!status.ready) {
  console.error("Real Hedera x402 payment is not configured.");
  console.error(`Missing: ${status.missing.join(", ")}`);
  console.error("Set HEDERA_PAYMENT_MODE=real and fill the Hedera testnet / Blocky402 env vars first.");
  process.exit(1);
}

const config = getHederaConfig();
const policy = normalizeUserPolicy({
  ...defaultUserPolicy,
  id: "policy_real_testnet_smoke_v1",
  targetAsset: "ETH",
  sessionBudgetTinybar: 20_000_000,
  maxPaidAgentCallTinybar: 5_000_000,
  allowedPaidAgents: ["market-signal"],
  paidAgentBudgetsTinybar: {
    "market-signal": 12_000_000
  },
  autoPayEnabled: true,
  allowance: {
    ownerAccountId: config.userPayerAccountId,
    spenderAccountId: config.spenderAccountId,
    merchantAccountId: config.merchantAccountId,
    allowanceTinybar: 20_000_000,
    spentTinybar: 0
  },
  sessionEscrow: {
    status: "authorized",
    sessionId: "real_testnet_smoke_session",
    payerAccountId: config.userPayerAccountId,
    authorizedBudgetTinybar: 20_000_000,
    availableBalanceTinybar: 20_000_000,
    spentTinybar: 0,
    fundingReference: "hedera:testnet://manual-smoke-test",
    authorizedAt: new Date().toISOString()
  },
  strategyIntent: {
    asset: "ETH",
    timeframe: "4h",
    strategyType: "breakout"
  },
  executionMode: "simulation"
});

const ledger = createBudgetLedger(policy);
const client = new X402PaidToolClient({
  guard: new PolicyPaymentGuard()
});

let marketServer;

try {
  const market = await createMarketSignalServer({
    port: 0,
    signalProvider: {
      async getSignal({ asset, timeframe, strategyType }) {
        return {
          asset,
          timeframe,
          strategyType,
          summary: "Static smoke-test signal returned after real x402 Hedera settlement.",
          confidence: 0.61,
          source: "real-payment-smoke"
        };
      }
    }
  });
  marketServer = market.server;

  console.log("Oasis real Hedera x402 payment smoke test");
  console.log("=========================================");
  console.log(`network: hedera:${config.network}`);
  console.log(`asset: HBAR / 0.0.0`);
  console.log(`payer: ${config.userPayerAccountId} ${hashscanAccountUrl(config.userPayerAccountId, config.network)}`);
  console.log(`spender: ${config.spenderAccountId} ${hashscanAccountUrl(config.spenderAccountId, config.network)}`);
  console.log(`merchant: ${config.merchantAccountId} ${hashscanAccountUrl(config.merchantAccountId, config.network)}`);
  console.log(`facilitator: ${config.facilitatorUrl}`);
  console.log(`service: market-signal`);
  console.log(`price: ${tinybarToHbar(SERVICE_PRICE_TINYBAR)} HBAR`);

  const result = await client.callMarketSignal({
    serviceBaseUrl: market.baseUrl,
    asset: "ETH",
    policy,
    ledger,
    plannedCall: {
      service: "market-signal",
      agent: "Market Agent",
      reasoningTier: "standard",
      quotedTinybar: SERVICE_PRICE_TINYBAR,
      usage: SERVICE_QUOTE.usage,
      pricingModel: SERVICE_QUOTE.pricingModel,
      reason: "Verify one real Hedera testnet x402 payment before the full agent run.",
      maxWillingToPayTinybar: SERVICE_PRICE_TINYBAR
    }
  });

  if (result.status !== "settled") {
    console.error("Payment was not settled.");
    console.error(JSON.stringify(result.policyCheck, null, 2));
    process.exitCode = 1;
  } else {
    console.log("\nPayment settled");
    console.log(JSON.stringify({
      transactionId: result.payment.transactionId,
      hashscanUrl: result.payment.hashscanUrl,
      mode: result.payment.mode,
      network: result.payment.network,
      asset: result.payment.asset,
      facilitator: result.payment.facilitator,
      spentHbar: tinybarToHbar(ledger.spentTinybar),
      remainingHbar: tinybarToHbar(policy.sessionBudgetTinybar - ledger.spentTinybar)
    }, null, 2));
  }
} finally {
  if (marketServer) {
    await closeMarketSignalServer(marketServer);
  }
}

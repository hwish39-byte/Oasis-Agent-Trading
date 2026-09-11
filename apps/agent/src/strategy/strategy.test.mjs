import test from "node:test";
import assert from "node:assert/strict";
import { createBudgetLedger, defaultUserPolicy } from "../../../../packages/policy/src/index.mjs";
import {
  BinanceMarketDataProvider,
  CoinGeckoMarketDataProvider,
  CompositeMarketDataProvider,
  MarketContextBuilder
} from "./MarketContextBuilder.mjs";
import {
  ClaudeJsonModelClient,
  OpenAICompatibleJsonModelClient,
  OpenAIResponsesJsonModelClient
} from "./ModelProviders.mjs";
import { PolicyPaymentGuard } from "./PolicyPaymentGuard.mjs";
import { assertStrategyDecision } from "./schemas.mjs";

test("schema validation rejects malformed strategy decisions", () => {
  assert.throws(
    () => assertStrategyDecision({
      decisionId: "decision_bad",
      action: "BUY_NOW",
      asset: "ETH",
      confidence: 1.2,
      reason: "",
      rationale: [],
      risk: {
        level: "low",
        blockingReasons: []
      }
    }),
    /decision.action/
  );
});

test("payment guard blocks unplanned or overpriced paid research", () => {
  const guard = new PolicyPaymentGuard();
  const ledger = createBudgetLedger(defaultUserPolicy);
  const paymentRequirement = {
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    amount: "3000000",
    payTo: "0.0.2002",
    extra: {
      requestId: "market_test"
    }
  };

  const unplanned = guard.checkBeforePayment({
    policy: defaultUserPolicy,
    ledger,
    paymentRequirement,
    service: "market-signal"
  });
  assert.equal(unplanned.allowed, false);
  assert.match(unplanned.reasons.join(";"), /not planned/);

  const overpriced = guard.checkBeforePayment({
    policy: defaultUserPolicy,
    ledger,
    paymentRequirement,
    service: "market-signal",
    plannedCall: {
      service: "market-signal",
      maxWillingToPayTinybar: 1_000_000
    }
  });
  assert.equal(overpriced.allowed, false);
  assert.match(overpriced.reasons.join(";"), /exceeds Strategy Agent willingness/);
});

test("market context builder uses requested asset and timeframe from live provider", async () => {
  const provider = new BinanceMarketDataProvider({
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => {
        if (url.includes("/ticker/24hr")) {
          assert.match(url, /BTCUSDT/);
          return { priceChangePercent: "2.4" };
        }

        assert.match(url, /interval=1h/);
        return Array.from({ length: 80 }, (_, index) => {
          const close = 60000 + index * 20;
          return [
            index,
            String(close - 10),
            String(close + 30),
            String(close - 40),
            String(close),
            String(100 + index)
          ];
        });
      }
    })
  });
  const builder = new MarketContextBuilder({ marketDataProvider: provider });
  const context = await builder.build({
    asset: "BTC",
    intent: {
      asset: "BTC",
      timeframe: "1h",
      strategyType: "breakout"
    }
  });

  assert.equal(context.asset, "BTC");
  assert.equal(context.source, "binance_public_api");
  assert.equal(context.snapshot.asset, "BTC");
  assert.equal(context.snapshot.timeframe, "1h");
  assert.equal(context.snapshot.symbol, "BTCUSDT");
});

test("composite market provider falls back to another live source", async () => {
  const provider = new CompositeMarketDataProvider({
    providers: [
      { getSignal: async () => { throw new Error("primary unavailable"); } },
      new CoinGeckoMarketDataProvider({
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            prices: Array.from({ length: 40 }, (_, index) => [index, 100 + index]),
            total_volumes: Array.from({ length: 40 }, (_, index) => [index, 1000 + index * 10])
          })
        })
      })
    ]
  });

  const signal = await provider.getSignal({
    asset: "SOL",
    timeframe: "1d",
    strategyType: "momentum"
  });

  assert.equal(signal.asset, "SOL");
  assert.equal(signal.source, "coingecko_public_api");
  assert.equal(signal.timeframe, "1d");
});

test("model providers route JSON requests to provider-specific APIs", async () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" }
    },
    required: ["ok"]
  };

  const openai = new OpenAIResponsesJsonModelClient({
    provider: "openai",
    model: "gpt-5",
    apiKey: "test",
    fetchImpl: async (url, options) => {
      assert.match(url, /\/responses$/);
      assert.match(options.headers.authorization, /Bearer test/);
      return {
        ok: true,
        json: async () => ({ output_text: "{\"ok\":true}" })
      };
    }
  });
  assert.deepEqual(await openai.generateJson({ name: "check", system: "s", user: {}, schema }), { ok: true });

  const compatible = new OpenAICompatibleJsonModelClient({
    provider: "deepseek",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    apiKey: "test",
    fetchImpl: async (url, options) => {
      assert.match(url, /\/chat\/completions$/);
      assert.equal(JSON.parse(options.body).response_format.type, "json_object");
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{\"ok\":true}" } }] })
      };
    }
  });
  assert.deepEqual(await compatible.generateJson({ name: "check", system: "s", user: {}, schema }), { ok: true });

  const claude = new ClaudeJsonModelClient({
    provider: "claude",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test",
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v1\/messages$/);
      assert.equal(options.headers["x-api-key"], "test");
      return {
        ok: true,
        json: async () => ({ content: [{ type: "text", text: "{\"ok\":true}" }] })
      };
    }
  });
  assert.deepEqual(await claude.generateJson({ name: "check", system: "s", user: {}, schema }), { ok: true });
});

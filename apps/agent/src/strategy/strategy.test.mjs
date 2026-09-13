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
import {
  FallbackStrategyReasoner,
  OpenAIResponsesStrategyReasoner
} from "./LLMReasoner.mjs";
import { PolicyPaymentGuard } from "./PolicyPaymentGuard.mjs";
import { assertStrategyDecision } from "./schemas.mjs";
import { ToolPlanner } from "./ToolPlanner.mjs";

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

test("payment guard blocks unplanned or overpriced paid agent calls", () => {
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

test("tool planner follows user paid-agent policy switches", () => {
  const planner = new ToolPlanner();
  const baseHypothesis = {
    initialConfidence: 0.32,
    uncertainty: {
      level: "low",
      missingEvidence: []
    }
  };
  const marketContext = {
    snapshot: {
      volumeConfirmation: "strong"
    }
  };
  const memory = {
    performanceSummary: {
      recentFalsePositiveRate: 0
    }
  };

  const conservativePlan = planner.plan({
    policy: {
      ...defaultUserPolicy,
      allowedPaidAgents: ["market-signal", "risk-challenge"],
      strategyIntent: {
        riskPreference: "conservative"
      }
    },
    hypothesis: baseHypothesis,
    marketContext,
    memory,
    locale: "en-US"
  });

  assert.equal(conservativePlan.toolCalls.some((call) => call.service === "market-signal"), true);
  assert.equal(conservativePlan.toolCalls.some((call) => call.service === "risk-challenge"), true);

  const aggressivePlan = planner.plan({
    policy: {
      ...defaultUserPolicy,
      allowedPaidAgents: ["market-signal", "risk-challenge"],
      strategyIntent: {
        riskPreference: "aggressive"
      }
    },
    hypothesis: baseHypothesis,
    marketContext,
    memory,
    locale: "en-US"
  });

  assert.equal(aggressivePlan.toolCalls.some((call) => call.service === "market-signal"), true);
  assert.equal(aggressivePlan.toolCalls.some((call) => call.service === "risk-challenge"), false);
});

test("tool planner prices paid agents by requested workload", () => {
  const planner = new ToolPlanner();
  const hypothesis = {
    initialConfidence: 0.74,
    uncertainty: {
      level: "low",
      missingEvidence: []
    }
  };
  const marketContext = {
    snapshot: {
      volumeConfirmation: "strong"
    }
  };
  const memory = {
    performanceSummary: {
      recentFalsePositiveRate: 0
    }
  };
  const basePolicy = {
    ...defaultUserPolicy,
    allowedPaidAgents: ["market-signal", "risk-challenge"],
    strategyIntent: {
      riskPreference: "conservative"
    }
  };

  const simplePlan = planner.plan({
    policy: basePolicy,
    hypothesis,
    marketContext,
    memory,
    intent: {
      message: "ETH 4h 突破做多，简单确认即可。",
      riskPreference: "conservative"
    },
    locale: "zh-CN"
  });
  const complexPlan = planner.plan({
    policy: basePolicy,
    hypothesis,
    marketContext,
    memory,
    intent: {
      message: "ETH 做多，需要多周期确认、多指标、链上数据、波动率、回撤、极端行情压力测试、高杠杆止损检查。",
      riskPreference: "conservative"
    },
    locale: "zh-CN"
  });

  const simpleMarket = simplePlan.toolCalls.find((call) => call.service === "market-signal");
  const complexMarket = complexPlan.toolCalls.find((call) => call.service === "market-signal");
  const simpleRisk = simplePlan.toolCalls.find((call) => call.service === "risk-challenge");
  const complexRisk = complexPlan.toolCalls.find((call) => call.service === "risk-challenge");

  assert.equal(simpleMarket.reasoningTier, "basic");
  assert.equal(simpleRisk.reasoningTier, "standard");
  assert.equal(complexMarket.quotedTinybar > simpleMarket.quotedTinybar, true);
  assert.equal(complexMarket.usage.timeframes > simpleMarket.usage.timeframes, true);
  assert.equal(complexRisk.reasoningTier, "deep");
  assert.equal(complexRisk.quotedTinybar > simpleRisk.quotedTinybar, true);
  assert.equal(complexRisk.usage.stressScenarios > simpleRisk.usage.stressScenarios, true);
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

test("composite market provider uses local snapshot when every live source fails", async () => {
  const provider = new CompositeMarketDataProvider({
    providers: [
      { getSignal: async () => { throw new Error("binance unavailable"); } },
      { getSignal: async () => { throw new Error("coingecko unavailable"); } }
    ]
  });

  const signal = await provider.getSignal({
    asset: "ETH",
    timeframe: "4h",
    strategyType: "breakout"
  });

  assert.equal(signal.asset, "ETH");
  assert.equal(signal.source, "local_snapshot_live_fallback");
  assert.equal(signal.isFresh, false);
  assert.equal(signal.warnings.some((warning) => warning.includes("live market data fallback used")), true);
  assert.equal(signal.warnings.some((warning) => warning.includes("binance unavailable")), true);
  assert.equal(signal.warnings.some((warning) => warning.includes("coingecko unavailable")), true);
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

test("strategy reasoner continues with rule fallback when DeepSeek generation fails", async () => {
  const reasoner = new FallbackStrategyReasoner({
    primary: new OpenAIResponsesStrategyReasoner({
      modelClient: {
        provider: "deepseek",
        model: "deepseek-chat",
        id: "deepseek:deepseek-chat",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        available: true,
        generateJson: async () => {
          throw new Error("deepseek:deepseek-chat strategy_hypothesis failed with 401");
        }
      }
    })
  });

  const hypothesis = await reasoner.generateHypothesis({
    policy: {
      ...defaultUserPolicy,
      targetAsset: "ETH"
    },
    marketContext: {
      source: "local_snapshot_live_fallback",
      regime: "constructive_but_unconfirmed",
      snapshot: {
        asset: "ETH",
        timeframe: "4h",
        momentum: "positive",
        volumeConfirmation: "weak",
        confidence: 0.42,
        recommendation: "hold",
        breakoutScore: 44
      }
    },
    memory: {
      similarDecisions: [],
      performanceSummary: {}
    },
    intent: {
      timeframe: "4h",
      strategyType: "breakout"
    },
    locale: "zh-CN"
  });

  assert.equal(hypothesis.generatedBy, "deepseek:deepseek-chat->rule_based_fallback");
  assert.equal(hypothesis.llmFallback.provider, "deepseek:deepseek-chat");
  assert.match(hypothesis.llmFallback.reason, /401/);
});

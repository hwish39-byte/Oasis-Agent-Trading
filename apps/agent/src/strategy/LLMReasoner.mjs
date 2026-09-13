import { assertStrategyHypothesis } from "./schemas.mjs";
import { createJsonModelClient } from "./ModelProviders.mjs";

export class StrategyReasoner {
  async generateHypothesis() {
    throw new Error("StrategyReasoner.generateHypothesis must be implemented");
  }
}

export class RuleBasedStrategyReasoner extends StrategyReasoner {
  async generateHypothesis({ policy, marketContext, memory, intent, strategyDraft, locale } = {}) {
    const snapshot = marketContext.snapshot;
    const initialConfidence = clamp(Number(snapshot.confidence ?? 0.5), 0, 1);
    const direction = snapshot.momentum === "negative" ? "SHORT" : snapshot.momentum === "positive" ? "LONG" : "NEUTRAL";
    const setup = inferSetup({ intent, strategyDraft, snapshot });
    const isZh = locale === "zh-CN";
    const missingEvidence = [];

    if (snapshot.volumeConfirmation === "weak") {
      missingEvidence.push(isZh ? "独立市场确认" : "independent market confirmation");
    }

    if (initialConfidence >= 0.55) {
      missingEvidence.push(isZh ? "对抗式下行风险复核" : "adversarial downside review");
    }

    return assertStrategyHypothesis({
      asset: policy.targetAsset,
      direction,
      setup,
      initialConfidence,
      reasoning: isZh
        ? [
            `${policy.targetAsset} ${intent?.timeframe ?? snapshot.timeframe ?? "market"} ${translateStrategyType(intent?.strategyType ?? strategyDraft?.strategyType)}想法`,
            `当前市场状态：${translateMarketRegime(marketContext.regime)}`,
            `市场数据来源：${marketContext.source}`,
            `市场信号建议：${translateRecommendation(snapshot.recommendation)}`,
            `突破评分：${snapshot.breakoutScore}`
          ]
        : [
            `${policy.targetAsset} ${intent?.timeframe ?? snapshot.timeframe ?? "market"} ${intent?.strategyType ?? strategyDraft?.strategyType ?? "strategy"} idea`,
            `live market regime is ${marketContext.regime}`,
            `market source is ${marketContext.source}`,
            `market signal recommendation is ${snapshot.recommendation}`,
            `breakout score is ${snapshot.breakoutScore}`
          ],
      uncertainty: {
        level: missingEvidence.length > 1 ? "medium" : "low",
        missingEvidence
      },
      memoryContext: {
        similarDecisionCount: memory.similarDecisions.length
      },
      generatedBy: "rule_based_fallback"
    });
  }
}

export class OpenAIResponsesStrategyReasoner extends StrategyReasoner {
  constructor({
    provider,
    model,
    modelClient = createJsonModelClient({ provider, model })
  } = {}) {
    super();
    this.modelClient = modelClient;
  }

  get available() {
    return this.modelClient.available;
  }

  async generateHypothesis({ userMessage, intent, strategyDraft, policy, marketContext, memory, locale } = {}) {
    if (!this.available) {
      throw new Error(`${this.modelClient.apiKeyEnv} is required for ${this.modelClient.id}`);
    }

    const hypothesis = await this.modelClient.generateJson({
      name: "strategy_hypothesis",
      system: [
        "You are a Strategy Agent for a budget-constrained trading committee. Return only JSON that matches the requested schema. You may suggest evidence to buy, but you may not authorize payment or execution.",
        locale === "zh-CN" ? "Write all free-text fields in Simplified Chinese. Keep enum values such as LONG, SHORT, BREAKOUT, HOLD, and SIMULATED_BUY unchanged." : "Write all free-text fields in English."
      ].join(" "),
      user: {
        task: "Generate a trading hypothesis and identify missing evidence.",
        locale: locale ?? "en-US",
        userMessage,
        intent,
        strategyDraft,
        policy,
        marketContext,
        memorySummary: memory.performanceSummary,
        instructions: [
          "Honor the user's natural-language trading idea when choosing asset, timeframe, setup, and direction.",
          "Use live marketContext as evidence, but do not invent prices or payment outcomes.",
          "Identify missing evidence that could justify paid tool calls.",
          "You may propose research needs, but deterministic policy guards authorize payments and execution."
        ]
      },
      schema: strategyHypothesisSchema()
    });
    return assertStrategyHypothesis({
      ...hypothesis,
      generatedBy: this.modelClient.id
    });
  }
}

export class FallbackStrategyReasoner extends StrategyReasoner {
  constructor({
    primary,
    fallback = new RuleBasedStrategyReasoner()
  } = {}) {
    super();
    this.primary = primary;
    this.fallback = fallback;
  }

  async generateHypothesis(params = {}) {
    try {
      return await this.primary.generateHypothesis(params);
    } catch (error) {
      const hypothesis = await this.fallback.generateHypothesis(params);
      return assertStrategyHypothesis({
        ...hypothesis,
        generatedBy: `${this.primary.modelClient.id}->rule_based_fallback`,
        llmFallback: {
          provider: this.primary.modelClient.id,
          reason: error.message
        }
      });
    }
  }
}

function translateStrategyType(value) {
  if (value === "mean_reversion") return "均值回归";
  if (value === "momentum") return "趋势动量";
  if (value === "range") return "区间交易";
  if (value === "event_driven") return "事件驱动";
  if (value === "scalping") return "短线";
  return "突破";
}

function translateMarketRegime(value) {
  if (value === "bullish") return "偏多";
  if (value === "bearish") return "偏空";
  if (value === "volatile") return "高波动";
  if (value === "range") return "区间震荡";
  return value ?? "未知";
}

function translateRecommendation(value) {
  if (value === "buy" || value === "long") return "偏多";
  if (value === "sell" || value === "short") return "偏空";
  if (value === "hold") return "观望";
  return value ?? "未知";
}

export function createDefaultReasoner({
  provider,
  model,
  requireLlm = process.env.OASIS_LLM_MODE === "required"
} = {}) {
  if (provider === "rule" || process.env.OASIS_LLM_MODE === "rule") {
    return new RuleBasedStrategyReasoner();
  }

  const llm = new OpenAIResponsesStrategyReasoner({ provider, model });
  if (requireLlm) return llm;
  return new FallbackStrategyReasoner({ primary: llm });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferSetup({ intent, strategyDraft, snapshot }) {
  const strategyType = intent?.strategyType ?? strategyDraft?.strategyType;
  if (strategyType === "mean_reversion") return "MEAN_REVERSION";
  if (strategyType === "momentum") return "MOMENTUM_CONTINUATION";
  if (strategyType === "range") return "RANGE";
  if (strategyType === "breakout") return "BREAKOUT";
  return snapshot.breakoutScore >= 55 ? "BREAKOUT" : "UNKNOWN";
}

function strategyHypothesisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      asset: { type: "string" },
      direction: { type: "string", enum: ["LONG", "SHORT", "NEUTRAL"] },
      setup: { type: "string", enum: ["BREAKOUT", "MEAN_REVERSION", "MOMENTUM_CONTINUATION", "RANGE", "UNKNOWN"] },
      initialConfidence: { type: "number", minimum: 0, maximum: 1 },
      reasoning: { type: "array", items: { type: "string" } },
      uncertainty: {
        type: "object",
        additionalProperties: false,
        properties: {
          level: { type: "string", enum: ["low", "medium", "high"] },
          missingEvidence: { type: "array", items: { type: "string" } }
        },
        required: ["level", "missingEvidence"]
      }
    },
    required: ["asset", "direction", "setup", "initialConfidence", "reasoning", "uncertainty"]
  };
}

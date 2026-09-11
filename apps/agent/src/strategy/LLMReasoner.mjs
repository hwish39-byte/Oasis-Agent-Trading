import { assertStrategyHypothesis } from "./schemas.mjs";
import { createJsonModelClient } from "./ModelProviders.mjs";

export class StrategyReasoner {
  async generateHypothesis() {
    throw new Error("StrategyReasoner.generateHypothesis must be implemented");
  }
}

export class RuleBasedStrategyReasoner extends StrategyReasoner {
  async generateHypothesis({ policy, marketContext, memory, intent, strategyDraft }) {
    const snapshot = marketContext.snapshot;
    const initialConfidence = clamp(Number(snapshot.confidence ?? 0.5), 0, 1);
    const direction = snapshot.momentum === "negative" ? "SHORT" : snapshot.momentum === "positive" ? "LONG" : "NEUTRAL";
    const setup = inferSetup({ intent, strategyDraft, snapshot });
    const missingEvidence = [];

    if (snapshot.volumeConfirmation === "weak") {
      missingEvidence.push("independent market confirmation");
    }

    if (initialConfidence >= 0.55) {
      missingEvidence.push("adversarial downside review");
    }

    return assertStrategyHypothesis({
      asset: policy.targetAsset,
      direction,
      setup,
      initialConfidence,
      reasoning: [
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

  async generateHypothesis({ userMessage, intent, strategyDraft, policy, marketContext, memory }) {
    if (!this.available) {
      throw new Error(`${this.modelClient.apiKeyEnv} is required for ${this.modelClient.id}`);
    }

    const hypothesis = await this.modelClient.generateJson({
      name: "strategy_hypothesis",
      system: "You are a Strategy Agent for a budget-constrained trading committee. Return only JSON that matches the requested schema. You may suggest evidence to buy, but you may not authorize payment or execution.",
      user: {
        task: "Generate a trading hypothesis and identify missing evidence.",
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
  return llm.available ? llm : new RuleBasedStrategyReasoner();
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

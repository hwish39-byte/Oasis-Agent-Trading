import { assertStrategyHypothesis, coerceLlmJson } from "./schemas.mjs";

export class StrategyReasoner {
  async generateHypothesis() {
    throw new Error("StrategyReasoner.generateHypothesis must be implemented");
  }
}

export class RuleBasedStrategyReasoner extends StrategyReasoner {
  async generateHypothesis({ policy, marketContext, memory }) {
    const snapshot = marketContext.snapshot;
    const initialConfidence = clamp(Number(snapshot.confidence ?? 0.5), 0, 1);
    const direction = snapshot.momentum === "negative" ? "SHORT" : snapshot.momentum === "positive" ? "LONG" : "NEUTRAL";
    const setup = snapshot.breakoutScore >= 55 ? "BREAKOUT" : "UNKNOWN";
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
        `${policy.targetAsset} ${marketContext.regime}`,
        `snapshot recommendation is ${snapshot.recommendation}`,
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
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.STRATEGY_AGENT_MODEL ?? "gpt-5",
    endpoint = "https://api.openai.com/v1/responses"
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
  }

  get available() {
    return Boolean(this.apiKey);
  }

  async generateHypothesis({ policy, marketContext, memory }) {
    if (!this.available) {
      throw new Error("OPENAI_API_KEY is required for OpenAIResponsesStrategyReasoner");
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: "system",
            content: "You are a Strategy Agent for a budget-constrained trading committee. Return only JSON that matches the requested schema. You may suggest evidence to buy, but you may not authorize payment or execution."
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Generate a trading hypothesis and identify missing evidence.",
              policy,
              marketContext,
              memorySummary: memory.performanceSummary
            })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "strategy_hypothesis",
            strict: true,
            schema: {
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
            }
          }
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`OpenAI reasoning failed with ${response.status}: ${JSON.stringify(payload)}`);
    }

    const outputText = payload.output_text ?? extractOutputText(payload);
    return assertStrategyHypothesis(coerceLlmJson(outputText, "OpenAI strategy hypothesis"));
  }
}

export function createDefaultReasoner() {
  const openai = new OpenAIResponsesStrategyReasoner();
  return openai.available ? openai : new RuleBasedStrategyReasoner();
}

function extractOutputText(payload) {
  const output = payload.output ?? [];
  const message = output.find((item) => item.type === "message");
  const text = message?.content?.find((item) => item.type === "output_text")?.text;

  if (!text) {
    throw new Error("OpenAI response did not include output_text");
  }

  return text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

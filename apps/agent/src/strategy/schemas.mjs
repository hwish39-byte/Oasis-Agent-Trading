const ACTIONS = ["NO_TRADE", "HOLD", "PROPOSE_TRADE", "SIMULATED_BUY", "SIMULATED_SELL", "REQUEST_MORE_DATA"];
const DIRECTIONS = ["LONG", "SHORT", "NEUTRAL"];
const SETUPS = ["BREAKOUT", "MEAN_REVERSION", "MOMENTUM_CONTINUATION", "RANGE", "UNKNOWN"];
const RISK_LEVELS = ["low", "medium", "high"];

export const STRATEGY_STEPS = Object.freeze([
  "load_user_policy",
  "build_market_context",
  "retrieve_memory",
  "generate_hypothesis",
  "plan_evidence_needed",
  "plan_tool_calls",
  "pre_payment_policy_check",
  "execute_paid_research",
  "synthesize_evidence",
  "compose_strategy_decision",
  "final_policy_risk_check",
  "execution_agent_review",
  "persist_memory",
  "write_audit",
  "emit_observability"
]);

export function createStrategyState({ runId, policy, asset }) {
  return {
    runId,
    asset,
    userMessage: null,
    intent: null,
    strategyDraft: null,
    policy,
    ledger: null,
    marketContext: null,
    memory: {
      similarDecisions: [],
      performanceSummary: null
    },
    hypothesis: null,
    toolPlan: null,
    policyChecks: [],
    payments: [],
    committeeTranscript: [],
    evidence: null,
    decision: null,
    executionResult: null,
    audit: null,
    metrics: null,
    timeline: []
  };
}

export function assertStrategyHypothesis(value) {
  assertObject(value, "StrategyHypothesis");
  assertString(value.asset, "hypothesis.asset");
  assertEnum(value.direction, DIRECTIONS, "hypothesis.direction");
  assertEnum(value.setup, SETUPS, "hypothesis.setup");
  assertNumberRange(value.initialConfidence, 0, 1, "hypothesis.initialConfidence");
  assertStringArray(value.reasoning, "hypothesis.reasoning");
  assertObject(value.uncertainty, "hypothesis.uncertainty");
  assertEnum(value.uncertainty.level, RISK_LEVELS, "hypothesis.uncertainty.level");
  assertStringArray(value.uncertainty.missingEvidence, "hypothesis.uncertainty.missingEvidence");
  return value;
}

export function assertToolPlan(value) {
  assertObject(value, "ToolCallPlan");
  if (!Array.isArray(value.toolCalls)) {
    throw new Error("ToolCallPlan.toolCalls must be an array");
  }

  for (const [index, call] of value.toolCalls.entries()) {
    assertObject(call, `ToolCallPlan.toolCalls[${index}]`);
    assertString(call.service, `toolCalls[${index}].service`);
    assertString(call.reason, `toolCalls[${index}].reason`);
    assertInteger(call.maxWillingToPayTinybar, `toolCalls[${index}].maxWillingToPayTinybar`);
    if (call.maxWillingToPayTinybar < 0) {
      throw new Error(`toolCalls[${index}].maxWillingToPayTinybar must be >= 0`);
    }
    if (typeof call.required !== "boolean") {
      throw new Error(`toolCalls[${index}].required must be a boolean`);
    }
  }

  return value;
}

export function assertEvidenceBundle(value) {
  assertObject(value, "EvidenceBundle");
  assertStringArray(value.supportingEvidence, "evidence.supportingEvidence");
  assertStringArray(value.contradictingEvidence, "evidence.contradictingEvidence");
  assertStringArray(value.missingEvidence, "evidence.missingEvidence");
  assertNumberRange(value.evidenceScore, 0, 100, "evidence.evidenceScore");
  assertEnum(value.evidenceQuality, RISK_LEVELS, "evidence.evidenceQuality");
  assertEnum(value.conflictLevel, RISK_LEVELS, "evidence.conflictLevel");
  return value;
}

export function assertStrategyDecision(value) {
  assertObject(value, "StrategyDecision");
  assertString(value.decisionId, "decision.decisionId");
  assertEnum(value.action, ACTIONS, "decision.action");
  assertString(value.asset, "decision.asset");
  assertNumberRange(value.confidence, 0, 1, "decision.confidence");
  assertString(value.reason, "decision.reason");
  assertStringArray(value.rationale, "decision.rationale");
  assertObject(value.risk, "decision.risk");
  assertEnum(value.risk.level, RISK_LEVELS, "decision.risk.level");
  assertStringArray(value.risk.blockingReasons, "decision.risk.blockingReasons");
  return value;
}

export function assertMarketContext(value) {
  assertObject(value, "MarketContext");
  assertString(value.asset, "marketContext.asset");
  assertString(value.source, "marketContext.source");
  assertObject(value.snapshot, "marketContext.snapshot");
  assertObject(value.quality, "marketContext.quality");
  if (typeof value.quality.isFresh !== "boolean") {
    throw new Error("marketContext.quality.isFresh must be a boolean");
  }
  assertStringArray(value.quality.warnings, "marketContext.quality.warnings");
  return value;
}

export function coerceLlmJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
}

function assertInteger(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
}

function assertNumberRange(value, min, max, label) {
  if (typeof value !== "number" || Number.isNaN(value) || value < min || value > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}`);
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
}

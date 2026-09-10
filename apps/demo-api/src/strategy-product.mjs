import { defaultUserPolicy } from "../../../packages/policy/src/index.mjs";
import { hbarToTinybar, tinybarToHbar } from "../../../packages/shared/src/index.mjs";
import { MarketContextBuilder } from "../../agent/src/strategy/MarketContextBuilder.mjs";
import { createDefaultReasoner } from "../../agent/src/strategy/LLMReasoner.mjs";
import { ToolPlanner } from "../../agent/src/strategy/ToolPlanner.mjs";

const SERVICE_QUOTES = Object.freeze({
  "market-signal": [
    { tier: "basic", priceTinybar: 1_000_000, depth: "fast confirmation" },
    { tier: "standard", priceTinybar: 3_000_000, depth: "breakout and volume confirmation" },
    { tier: "deep", priceTinybar: 7_000_000, depth: "multi-timeframe confirmation" }
  ],
  "risk-challenge": [
    { tier: "standard", priceTinybar: 2_000_000, depth: "adversarial downside review" },
    { tier: "deep", priceTinybar: 6_000_000, depth: "stress scenarios and invalidation checks" }
  ]
});

export function parseStrategyIntent(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    return {
      status: "needs_clarification",
      missingFields: ["message"],
      questions: ["请描述你想交易的资产、周期、预算和风险偏好。"]
    };
  }

  const upper = text.toUpperCase();
  const asset = upper.match(/\b(BTC|ETH|SOL|HBAR|LINK|AVAX|BNB|XRP)\b/)?.[1] ?? null;
  const timeframe = upper.match(/\b(15M|30M|1H|4H|1D|1W)\b/)?.[1]?.toLowerCase() ?? inferTimeframe(text);
  const strategyType = inferStrategyType(text);
  const riskPreference = inferRiskPreference(text);
  const budgetHbar = extractBudgetHbar(text, ["总预算", "预算", "最多花", "daily", "budget"]) ?? 0.2;
  const maxPaymentHbar = extractBudgetHbar(text, ["单次", "单项", "每次", "per call"]) ?? Math.min(0.05, budgetHbar);
  const executionMode = /真实|live|mainnet|实盘/i.test(text) ? "requires_manual_approval" : "simulation";
  const missingFields = [];

  if (!asset) missingFields.push("asset");
  if (!timeframe) missingFields.push("timeframe");

  return {
    status: missingFields.length > 0 ? "needs_clarification" : "ready",
    message: text,
    asset: asset ?? "ETH",
    timeframe: timeframe ?? "4h",
    strategyType,
    riskPreference,
    dailyResearchBudgetTinybar: hbarToTinybar(budgetHbar),
    maxPaymentPerCallTinybar: hbarToTinybar(maxPaymentHbar),
    executionMode,
    missingFields,
    questions: buildClarifyingQuestions(missingFields)
  };
}

export function buildPolicyDraft(intent) {
  const allowedServices = ["market-signal"];
  if (intent.riskPreference !== "aggressive") {
    allowedServices.push("risk-challenge");
  }

  return {
    ...defaultUserPolicy,
    id: `policy_${intent.asset.toLowerCase()}_${intent.timeframe}_${intent.strategyType}`,
    targetAsset: intent.asset,
    dailyBudgetTinybar: intent.dailyResearchBudgetTinybar,
    maxPaymentPerCallTinybar: intent.maxPaymentPerCallTinybar,
    allowedServices,
    executionMode: intent.executionMode === "simulation" ? "simulation" : "simulation",
    riskRules: [
      `${intent.riskPreference}_risk_profile`,
      "policy_guard_required_before_payment",
      "risk_guard_required_before_execution",
      "execution_agent_simulation_only"
    ],
    strategyIntent: intent
  };
}

export function buildStrategyDraft({ intent, policy }) {
  const setupName = `${intent.asset} ${intent.timeframe.toUpperCase()} ${titleCase(intent.strategyType)} Strategy`;

  return {
    name: setupName,
    asset: intent.asset,
    timeframe: intent.timeframe,
    strategyType: intent.strategyType,
    thesis: `Only consider ${intent.asset} exposure when ${intent.strategyType} evidence survives paid market confirmation and policy checks.`,
    entryConditions: [
      `${intent.timeframe} market structure supports the ${intent.strategyType} thesis`,
      "paid market signal does not contradict the thesis",
      "evidence score is above the execution threshold"
    ],
    exitConditions: [
      "market confirmation weakens",
      "risk challenge blocks the setup",
      "policy budget or risk boundary is exceeded"
    ],
    riskControls: [
      `daily research budget ${tinybarToHbar(policy.dailyBudgetTinybar)} HBAR`,
      `single service limit ${tinybarToHbar(policy.maxPaymentPerCallTinybar)} HBAR`,
      "simulation-only execution boundary"
    ],
    requiredEvidence: intent.riskPreference === "conservative"
      ? ["market-signal", "risk-challenge when signal is bullish"]
      : ["market-signal"],
    status: "draft"
  };
}

export async function buildAgentPlan({ intent, policy }) {
  const marketContextBuilder = new MarketContextBuilder();
  const reasoner = createDefaultReasoner();
  const toolPlanner = new ToolPlanner();
  const marketContext = await marketContextBuilder.build({ asset: policy.targetAsset });
  const memory = {
    similarDecisions: [],
    performanceSummary: { reviewCount: 0, recentFalsePositiveRate: 0, serviceValue: {} }
  };
  const hypothesis = await reasoner.generateHypothesis({ policy, marketContext, memory });
  const toolPlan = toolPlanner.plan({ policy, hypothesis, marketContext, memory });

  return {
    intent,
    marketContext,
    hypothesis,
    agentPlan: {
      mode: toolPlan.mode,
      reason: toolPlan.reason,
      plannedToolCalls: toolPlan.toolCalls.map((call) => ({
        ...call,
        quotedPriceTinybar: quoteFor(call.service, call.maxWillingToPayTinybar)?.priceTinybar ?? call.maxWillingToPayTinybar,
        expectedDecisionImpact: estimateDecisionImpact(hypothesis, call.service),
        recommended: call.required ? true : "optional"
      }))
    },
    quotes: SERVICE_QUOTES
  };
}

export function getServiceQuotes({ service, asset, depth } = {}) {
  const services = service ? { [service]: SERVICE_QUOTES[service] ?? [] } : SERVICE_QUOTES;
  return {
    asset: asset ?? "ETH",
    depth: depth ?? "standard",
    services
  };
}

function quoteFor(service, maxTinybar) {
  const quotes = SERVICE_QUOTES[service] ?? [];
  return quotes.find((quote) => quote.priceTinybar <= maxTinybar) ?? quotes[0];
}

function estimateDecisionImpact(hypothesis, service) {
  const base = service === "risk-challenge" ? 0.64 : 0.72;
  return Math.min(0.95, Number((base + hypothesis.initialConfidence * 0.1).toFixed(2)));
}

function inferTimeframe(text) {
  if (/四小时|4小时/.test(text)) return "4h";
  if (/一小时|1小时/.test(text)) return "1h";
  if (/日线|一天|1天/.test(text)) return "1d";
  if (/15分钟/.test(text)) return "15m";
  return null;
}

function inferStrategyType(text) {
  if (/突破|breakout/i.test(text)) return "breakout";
  if (/回归|mean|reversion/i.test(text)) return "mean_reversion";
  if (/趋势|momentum|动量/i.test(text)) return "momentum";
  return "breakout";
}

function inferRiskPreference(text) {
  if (/保守|conservative|低风险/i.test(text)) return "conservative";
  if (/激进|aggressive|高风险/i.test(text)) return "aggressive";
  return "balanced";
}

function extractBudgetHbar(text, keywords) {
  for (const keyword of keywords) {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index < 0) continue;
    const nearby = text.slice(index, index + 48);
    const amount = nearby.match(/(\d+(?:\.\d+)?)\s*HBAR/i)?.[1] ?? nearby.match(/(\d+(?:\.\d+)?)/)?.[1];
    if (amount) return Number(amount);
  }

  const generic = text.match(/(\d+(?:\.\d+)?)\s*HBAR/i)?.[1];
  return generic ? Number(generic) : null;
}

function buildClarifyingQuestions(missingFields) {
  const questions = [];
  if (missingFields.includes("asset")) questions.push("你想分析哪个资产？例如 ETH、BTC 或 HBAR。");
  if (missingFields.includes("timeframe")) questions.push("你希望使用哪个交易周期？例如 1h、4h 或 1d。");
  return questions;
}

function titleCase(value) {
  return value
    .split("_")
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

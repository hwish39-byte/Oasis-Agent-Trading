import { assertToolPlan } from "./schemas.mjs";
import { normalizeUserPolicy } from "../../../../packages/policy/src/index.mjs";
import { quotePaidAgentCall } from "../../../../packages/shared/src/pricing.mjs";

export class ToolPlanner {
  plan({ policy, hypothesis, marketContext, memory, intent, userMessage, locale = "zh-CN" }) {
    const isZh = locale === "zh-CN";
    const normalizedPolicy = normalizeUserPolicy(policy);
    const demand = analyzeDemand({ intent: intent ?? normalizedPolicy.strategyIntent, userMessage });
    const toolCalls = [];
    const remainingTinybar = normalizedPolicy.sessionBudgetTinybar;

    if (normalizedPolicy.allowedPaidAgents.includes("market-signal")) {
      const reasoningTier = selectMarketReasoningTier({ hypothesis, marketContext, demand });
      const quote = quotePaidAgentCall({
        service: "market-signal",
        reasoningTier,
        usage: estimateMarketUsage({ reasoningTier, marketContext, demand })
      });
      toolCalls.push({
        service: "market-signal",
        agent: "Market Agent",
        reasoningTier,
        quotedTinybar: quote.quotedTinybar,
        usage: quote.usage,
        pricingModel: quote.pricingModel,
        priority: "high",
        reason: isZh
          ? `Market Agent 会在最终决策前验证价格行为、成交量和波动率。用量：${quote.usage.candles} 根K线、${quote.usage.indicators} 个指标、${quote.usage.timeframes} 个周期。`
          : `Market Agent can validate price action, volume, and volatility before a final decision. Usage: ${quote.usage.candles} candles, ${quote.usage.indicators} indicators, ${quote.usage.timeframes} timeframe(s).`,
        maxWillingToPayTinybar: Math.min(quote.quotedTinybar, normalizedPolicy.maxPaidAgentCallTinybar, remainingTinybar),
        required: true
      });
    }

    if (normalizedPolicy.allowedPaidAgents.includes("risk-challenge") && normalizedPolicy.strategyIntent?.riskPreference !== "aggressive") {
      const reasoningTier = selectRiskReasoningTier({ hypothesis, memory, demand });
      const quote = quotePaidAgentCall({
        service: "risk-challenge",
        reasoningTier,
        usage: estimateRiskUsage({ reasoningTier, hypothesis, memory, demand })
      });
      toolCalls.push({
        service: "risk-challenge",
        agent: "Risk Agent",
        reasoningTier,
        quotedTinybar: quote.quotedTinybar,
        usage: quote.usage,
        pricingModel: quote.pricingModel,
        priority: "high",
        reason: isZh
          ? `Risk Agent 会在模拟执行前进行对抗式下行风险复核。用量：${quote.usage.stressScenarios} 个压力场景、${quote.usage.checks} 项检查、${quote.usage.riskFactors} 个风险因子。`
          : `Risk Agent should run an adversarial downside review before simulated execution. Usage: ${quote.usage.stressScenarios} stress scenarios, ${quote.usage.checks} checks, ${quote.usage.riskFactors} risk factors.`,
        maxWillingToPayTinybar: Math.min(quote.quotedTinybar, normalizedPolicy.maxPaidAgentCallTinybar, remainingTinybar),
        required: true
      });
    }

    return assertToolPlan({
      mode: toolCalls.length > 0 ? "paid_agents_planned" : "no_paid_agent_needed",
      reason: toolCalls.length > 0
        ? isZh ? "Strategy Agent 发现证据缺口，值得在预算边界内调用付费平台 Agent。" : "Strategy Agent found evidence gaps that justify bounded paid platform agent calls."
        : isZh ? "现有证据足够支持保守决策，不需要额外付费调用。" : "Available evidence is sufficient for a conservative decision.",
      toolCalls
    });
  }
}

function selectMarketReasoningTier({ hypothesis, marketContext, demand }) {
  if (demand.marketIntensity >= 4) return "deep";
  if (demand.marketIntensity >= 2) return "standard";
  if (demand.simpleGoal && hypothesis.uncertainty.level !== "high" && marketContext.snapshot.volumeConfirmation !== "weak") return "basic";
  if (hypothesis.uncertainty.level === "high" || marketContext.snapshot.volumeConfirmation === "weak") return "deep";
  if (hypothesis.initialConfidence < 0.7) return "standard";
  return "basic";
}

function selectRiskReasoningTier({ hypothesis, memory, demand }) {
  if (demand.riskIntensity >= 4) return "deep";
  if (memory.performanceSummary?.recentFalsePositiveRate > 0.35) return "deep";
  if (hypothesis.initialConfidence >= 0.78 || hypothesis.uncertainty.level === "high") return "deep";
  return "standard";
}

function estimateMarketUsage({ reasoningTier, marketContext, demand }) {
  const weakVolume = marketContext.snapshot.volumeConfirmation === "weak";
  if (reasoningTier === "deep") {
    return {
      candles: clampInteger((weakVolume ? 260 : 220) + demand.marketIntensity * 20, 220, 500),
      indicators: clampInteger((weakVolume ? 7 : 6) + demand.indicatorDemand, 6, 12),
      timeframes: clampInteger(3 + demand.timeframeDemand, 3, 5)
    };
  }

  if (reasoningTier === "basic") {
    return {
      candles: clampInteger(40 + demand.marketIntensity * 10, 40, 80),
      indicators: clampInteger(2 + demand.indicatorDemand, 2, 4),
      timeframes: clampInteger(1 + demand.timeframeDemand, 1, 2)
    };
  }

  return {
    candles: clampInteger((weakVolume ? 140 : 120) + demand.marketIntensity * 15, 120, 220),
    indicators: clampInteger(4 + demand.indicatorDemand, 4, 8),
    timeframes: clampInteger(1 + demand.timeframeDemand, 1, 3)
  };
}

function estimateRiskUsage({ reasoningTier, hypothesis, memory, demand }) {
  const highUncertainty = hypothesis.uncertainty.level === "high";
  const memoryPenalty = memory.performanceSummary?.recentFalsePositiveRate > 0.35;

  if (reasoningTier === "deep") {
    return {
      stressScenarios: clampInteger((highUncertainty || memoryPenalty ? 7 : 6) + demand.stressDemand, 6, 10),
      checks: clampInteger((highUncertainty ? 8 : 7) + demand.checkDemand, 7, 12),
      riskFactors: clampInteger((memoryPenalty ? 5 : 4) + demand.riskFactorDemand, 4, 8)
    };
  }

  return {
    stressScenarios: clampInteger((highUncertainty ? 4 : 3) + demand.stressDemand, 3, 6),
    checks: clampInteger(4 + demand.checkDemand, 4, 7),
    riskFactors: clampInteger(2 + demand.riskFactorDemand, 2, 4)
  };
}

function analyzeDemand({ intent, userMessage } = {}) {
  const text = [
    userMessage,
    intent?.message,
    intent?.strategyType,
    intent?.timeframe,
    intent?.riskPreference
  ].filter(Boolean).join(" ").toLowerCase();

  const timeframeDemand = countMatches(text, [
    /多周期|多时间|multi[-\s]?timeframe|multiple\s+timeframes/,
    /\b(15m|30m|1h|4h|1d|1w)\b.*\b(15m|30m|1h|4h|1d|1w)\b/
  ]);
  const indicatorDemand = countMatches(text, [
    /多指标|指标|indicator|rsi|macd|均线|ma\b|ema|布林|bollinger|成交量|volume|波动率|volatility|atr/
  ]);
  const confirmationDemand = countMatches(text, [
    /确认|confirmation|confirm|突破确认|二次确认|链上|on[-\s]?chain|资金费率|funding|订单簿|order\s*book/
  ]);
  const stressDemand = countMatches(text, [
    /压力测试|stress|极端行情|黑天鹅|暴跌|崩盘|crash|tail\s*risk/,
    /高杠杆|杠杆|leverage|leveraged|爆仓|liquidation/
  ]);
  const checkDemand = countMatches(text, [
    /止损|stop[-\s]?loss|止盈|take[-\s]?profit|风控|risk\s*control|风险约束|仓位|position/,
    /回撤|drawdown|最大亏损|max\s*loss|亏损/
  ]);
  const riskFactorDemand = countMatches(text, [
    /激进|aggressive|高风险|high\s*risk|波动率|volatility|相关性|correlation/,
    /极端行情|压力测试|stress|链上|on[-\s]?chain/
  ]);

  const marketIntensity = timeframeDemand + indicatorDemand + confirmationDemand;
  const riskIntensity = stressDemand + checkDemand + riskFactorDemand;
  const simpleGoal = marketIntensity === 0 && riskIntensity === 0 && !/复杂|complex|多|multi|several|multiple/.test(text);

  return {
    simpleGoal,
    marketIntensity,
    riskIntensity,
    timeframeDemand,
    indicatorDemand,
    stressDemand,
    checkDemand,
    riskFactorDemand
  };
}

function countMatches(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

import { createBudgetLedger, defaultUserPolicy } from "../../../../packages/policy/src/index.mjs";
import { createRequestId, hbarToTinybar, tinybarToHbar } from "../../../../packages/shared/src/index.mjs";
import { ExecutionAgent } from "../execution/ExecutionAgent.mjs";
import { MarketResearchAgent } from "../market/MarketResearchAgent.mjs";
import { RiskAgent } from "../risk/RiskAgent.mjs";
import { AuditLogger } from "./AuditLogger.mjs";
import { RiskAwareDecisionComposer } from "./DecisionComposer.mjs";
import { EvidenceSynthesizer } from "./EvidenceSynthesizer.mjs";
import { createDefaultReasoner } from "./LLMReasoner.mjs";
import { MarketContextBuilder } from "./MarketContextBuilder.mjs";
import { MemoryManager, ReviewScheduler } from "./MemoryManager.mjs";
import { createJsonModelClient, resolveModelConfig } from "./ModelProviders.mjs";
import { Observability } from "./Observability.mjs";
import { PolicyPaymentGuard } from "./PolicyPaymentGuard.mjs";
import { ToolPlanner } from "./ToolPlanner.mjs";
import { X402PaidToolClient } from "./X402PaidToolClient.mjs";
import { createExecutionProposal, createResearchRequest, createRiskChallengeRequest } from "./protocols.mjs";
import { STRATEGY_STEPS, createStrategyState } from "./schemas.mjs";

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

export class StrategyAgent {
  constructor({
    policy = defaultUserPolicy,
    marketContextBuilder = new MarketContextBuilder(),
    reasoner = createDefaultReasoner(),
    toolPlanner = new ToolPlanner(),
    guard = new PolicyPaymentGuard(),
    paidToolClient,
    marketResearchAgent,
    riskAgent,
    executionAgent = new ExecutionAgent(),
    evidenceSynthesizer = new EvidenceSynthesizer(),
    decisionComposer = new RiskAwareDecisionComposer(),
    memoryManager = new MemoryManager(),
    reviewScheduler = new ReviewScheduler(),
    auditLogger = new AuditLogger(),
    observability = new Observability()
  } = {}) {
    this.policy = policy;
    this.marketContextBuilder = marketContextBuilder;
    this.reasoner = reasoner;
    this.toolPlanner = toolPlanner;
    this.guard = guard;
    this.paidToolClient = paidToolClient ?? new X402PaidToolClient({ guard });
    this.marketResearchAgent = marketResearchAgent ?? new MarketResearchAgent({ paidToolClient: this.paidToolClient });
    this.riskAgent = riskAgent ?? new RiskAgent({ paidToolClient: this.paidToolClient });
    this.executionAgent = executionAgent;
    this.evidenceSynthesizer = evidenceSynthesizer;
    this.decisionComposer = decisionComposer;
    this.memoryManager = memoryManager;
    this.reviewScheduler = reviewScheduler;
    this.auditLogger = auditLogger;
    this.observability = observability;
  }

  async parseIntent({ message, modelConfig } = {}) {
    if (!shouldUseProductLlm(modelConfig)) return parseStrategyIntent(message);
    return parseIntentWithModel(message, { modelConfig });
  }

  draftPolicy({ intent } = {}) {
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
      serviceBudgetsTinybar: {
        "market-signal": Math.floor(intent.dailyResearchBudgetTinybar * 0.6),
        "risk-challenge": Math.floor(intent.dailyResearchBudgetTinybar * 0.3)
      },
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

  async draftStrategy({ intent, policy, modelConfig } = {}) {
    if (!shouldUseProductLlm(modelConfig)) return buildStrategyDraft({ intent, policy });
    return buildStrategyDraftWithModel({ intent, policy, modelConfig });
  }

  async planEvidence({ intent, policy, modelConfig } = {}) {
    const reasoner = createDefaultReasoner({
      provider: modelConfig?.provider,
      model: modelConfig?.model
    });
    const marketContext = await this.marketContextBuilder.build({
      asset: policy.targetAsset,
      intent
    });
    const memory = {
      similarDecisions: [],
      performanceSummary: { reviewCount: 0, recentFalsePositiveRate: 0, serviceValue: {} }
    };
    const hypothesis = await reasoner.generateHypothesis({
      userMessage: intent?.message,
      intent,
      policy,
      marketContext,
      memory
    });
    const toolPlan = this.toolPlanner.plan({ policy, hypothesis, marketContext, memory });

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

  getServiceQuotes({ service, asset, depth } = {}) {
    const services = service ? { [service]: SERVICE_QUOTES[service] ?? [] } : SERVICE_QUOTES;
    return {
      asset: asset ?? "ETH",
      depth: depth ?? "standard",
      services
    };
  }

  async run({
    asset = this.policy.targetAsset,
    userMessage,
    intent = this.policy.strategyIntent,
    strategyDraft,
    serviceBaseUrl,
    marketServiceBaseUrl,
    riskServiceBaseUrl
  } = {}) {
    const startedAt = Date.now();
    const runId = createRequestId("strategy_run");
    const state = createStrategyState({ runId, policy: this.policy, asset });
    state.userMessage = userMessage ?? intent?.message ?? null;
    state.intent = intent ?? null;
    state.strategyDraft = strategyDraft ?? null;
    state.ledger = createBudgetLedger(this.policy);

    await this.step(state, "load_user_policy", () => ({
      policyId: this.policy.id,
      asset,
      executionMode: this.policy.executionMode
    }));

    state.marketContext = await this.step(state, "build_market_context", () => {
      return this.marketContextBuilder.build({
        asset,
        intent: state.intent,
        strategyDraft: state.strategyDraft,
        timeframe: state.intent?.timeframe ?? state.strategyDraft?.timeframe
      });
    });

    state.memory = await this.step(state, "retrieve_memory", () => {
      return this.memoryManager.retrieve({ asset });
    });

    state.hypothesis = await this.step(state, "generate_hypothesis", () => {
      return this.reasoner.generateHypothesis({
        userMessage: state.userMessage,
        intent: state.intent,
        strategyDraft: state.strategyDraft,
        policy: this.policy,
        marketContext: state.marketContext,
        memory: state.memory
      });
    });

    state.timeline.push({
      step: "strategy_candidate",
      agent: "Strategy Agent",
      hypothesis: state.hypothesis,
      message: `${state.hypothesis.asset} ${state.hypothesis.setup} ${state.hypothesis.direction} hypothesis at ${state.hypothesis.initialConfidence} confidence.`
    });
    state.committeeTranscript.push({
      agent: "Strategy Agent",
      action: "propose_candidate",
      asset: state.asset,
      direction: state.hypothesis.direction,
      setup: state.hypothesis.setup,
      confidence: state.hypothesis.initialConfidence,
      message: "Strategy Agent proposes a candidate and asks the committee whether paid evidence is justified."
    });

    await this.step(state, "plan_evidence_needed", () => ({
      missingEvidence: state.hypothesis.uncertainty.missingEvidence,
      uncertainty: state.hypothesis.uncertainty
    }));

    state.toolPlan = await this.step(state, "plan_tool_calls", () => {
      return this.toolPlanner.plan({
        policy: this.policy,
        hypothesis: state.hypothesis,
        marketContext: state.marketContext,
        memory: state.memory
      });
    });

    state.coordination = state.toolPlan.toolCalls.map((toolCall) => {
      if (toolCall.service === "market-signal") return createResearchRequest({ state, toolCall });
      if (toolCall.service === "risk-challenge") return createRiskChallengeRequest({ state, toolCall });
      return null;
    }).filter(Boolean);
    state.committeeTranscript.push(...state.coordination.map((message) => ({
      agent: message.fromAgent,
      action: message.type,
      toAgent: message.toAgent,
      service: message.type === "ResearchRequest" ? "market-signal" : "risk-challenge",
      maxFeeTinybar: message.maxFeeTinybar,
      reason: message.reason
    })));

    const paidResearch = await this.step(state, "execute_paid_research", async () => {
      return this.executePaidResearch({
        state,
        marketServiceBaseUrl: marketServiceBaseUrl ?? serviceBaseUrl,
        riskServiceBaseUrl
      });
    });

    state.evidence = await this.step(state, "synthesize_evidence", () => {
      return this.evidenceSynthesizer.synthesize({
        hypothesis: state.hypothesis,
        marketContext: state.marketContext,
        paidResearch
      });
    });

    state.timeline.push({
      step: "signal_delivered",
      signal: state.evidence.marketSignal ?? state.marketContext.snapshot
    });

    state.decision = await this.step(state, "compose_strategy_decision", () => {
      return this.decisionComposer.compose({ state });
    });

    const finalCheck = await this.step(state, "final_policy_risk_check", () => {
      return this.guard.finalCheck({
        decision: state.decision,
        policy: this.policy,
        evidence: state.evidence
      });
    });
    state.decision = finalCheck.decision;
    state.executionProposal = createExecutionProposal({ state });
    state.executionResult = await this.step(state, "execution_agent_review", () => {
      return this.executionAgent.reviewAndSimulate({ state });
    });
    state.committeeTranscript.push({
      agent: "Execution Agent",
      action: state.executionResult.status,
      orderId: state.executionResult.simulatedOrder?.orderId,
      blockingReasons: state.executionResult.blockingReasons,
      message: state.executionResult.status === "simulated"
        ? "Execution Agent accepted the policy-approved simulation request."
        : "Execution Agent did not create an order because final checks did not authorize execution."
    });

    state.audit = await this.step(state, "write_audit", () => {
      return this.auditLogger.write({ state });
    });
    state.timeline.push({
      step: "audit_recorded",
      audit: state.audit
    });

    const storedMemory = await this.step(state, "persist_memory", () => {
      return this.memoryManager.storeDecision({ state });
    });

    state.reviewPlan = this.reviewScheduler.createReviewPlan({
      decisionId: state.decision.decisionId
    });
    state.metrics = await this.step(state, "emit_observability", () => {
      return this.observability.summarize({ state, startedAt });
    });

    return this.toDemoResult({ state, storedMemory });
  }

  async executePaidResearch({ state, marketServiceBaseUrl, riskServiceBaseUrl }) {
    const results = [];

    for (const plannedCall of state.toolPlan.toolCalls) {
      if (plannedCall.service === "market-signal") {
        const { result, transcript } = await this.marketResearchAgent.research({
          state,
          serviceBaseUrl: marketServiceBaseUrl,
          policy: this.policy,
          ledger: state.ledger,
          plannedCall
        });

        state.committeeTranscript.push(...transcript);
        this.recordPaymentEvents({ state, result });
        results.push(result);
        continue;
      }

      if (plannedCall.service === "risk-challenge") {
        const { result, transcript } = await this.riskAgent.challenge({
          state,
          serviceBaseUrl: riskServiceBaseUrl,
          policy: this.policy,
          ledger: state.ledger,
          plannedCall
        });

        state.committeeTranscript.push(...transcript);
        this.recordPaymentEvents({ state, result });
        results.push(result);
        continue;
      }

      results.push({
        status: "deferred",
        service: plannedCall.service,
        reason: "No committee member is connected for this paid service yet."
      });
    }

    return results;
  }

  recordPaymentEvents({ state, result }) {
    state.timeline.push({
      step: "payment_required",
      service: result.service,
      price: `${tinybarToHbar(result.requirement.amount)} HBAR`,
      network: result.requirement.network,
      receiver: result.requirement.payTo,
      asset: result.requirement.asset,
      scheme: result.requirement.scheme,
      x402Version: result.paymentRequired.x402Version
    });

    state.policyChecks.push(result.policyCheck);
    state.committeeTranscript.push({
      agent: "User Policy",
      action: result.policyCheck.allowed ? "approve_payment" : "reject_payment",
      service: result.service,
      requestId: result.policyCheck.requestId,
      amountTinybar: result.policyCheck.requestedTinybar,
      remainingTinybar: result.policyCheck.remainingTinybar,
      reasons: result.policyCheck.reasons
    });
    state.timeline.push({
      step: "policy_check",
      allowed: result.policyCheck.allowed,
      remainingBudget: `${tinybarToHbar(result.policyCheck.remainingTinybar)} HBAR`,
      reasons: result.policyCheck.reasons
    });

    if (result.status === "blocked") {
      return;
    }

    state.timeline.push({
      step: "payment_signed",
      service: result.service,
      payer: result.paymentPayload.payer,
      facilitator: result.paymentPayload.facilitatorUrl,
      mode: result.paymentPayload.mode,
      x402Version: result.paymentPayload.x402Version
    });

    state.payments.push({
      service: result.service,
      status: result.status,
      requestId: result.requirement.extra.requestId,
      amountTinybar: Number(result.requirement.amount),
      payment: result.payment
    });

    state.timeline.push({
      step: "payment_settled",
      service: result.service,
      transactionId: result.payment.transactionId,
      settledAt: result.payment.settledAt
    });
  }

  async step(state, stepName, fn) {
    if (!STRATEGY_STEPS.includes(stepName)) {
      throw new Error(`Unknown Strategy Agent step: ${stepName}`);
    }

    const output = await fn();
    state.timeline.push({
      step: "strategy_state",
      stateStep: stepName,
      output: sanitizeTimelineOutput(output)
    });
    return output;
  }

  toDemoResult({ state, storedMemory }) {
    return {
      finalDecision: state.decision.action,
      reason: state.decision.reason,
      policy: this.policy,
      budget: {
        spentTinybar: state.ledger.spentTinybar,
        spentHbar: tinybarToHbar(state.ledger.spentTinybar),
        remainingHbar: tinybarToHbar(this.policy.dailyBudgetTinybar - state.ledger.spentTinybar)
      },
      payment: state.payments.at(-1)?.payment ?? null,
      audit: state.audit,
      hypothesis: state.hypothesis,
      marketSource: state.marketContext.source,
      evidence: state.evidence,
      decision: state.decision,
      coordination: state.coordination,
      executionProposal: state.executionProposal,
      executionResult: state.executionResult,
      reviewPlan: state.reviewPlan,
      memory: {
        stored: storedMemory,
        retrieved: state.memory
      },
      metrics: state.metrics,
      committeeTranscript: state.committeeTranscript,
      timeline: state.timeline
    };
  }
}

function parseStrategyIntent(message) {
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
  const maxPaymentHbar = extractBudgetHbar(text, ["单次", "单项", "每次", "per call"], { allowGeneric: false }) ?? Math.min(0.05, budgetHbar);
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

function buildStrategyDraft({ intent, policy }) {
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

function shouldUseProductLlm(modelConfig) {
  const provider = modelConfig?.provider ?? process.env.STRATEGY_AGENT_PROVIDER ?? "openai";
  if (provider === "rule" || process.env.OASIS_LLM_MODE === "rule") return false;
  resolveModelConfig(modelConfig);
  return true;
}

async function parseIntentWithModel(message, { modelConfig } = {}) {
  const text = String(message ?? "").trim();
  if (!text) return parseStrategyIntent(text);
  const modelClient = createJsonModelClient(modelConfig);

  const payload = await modelClient.generateJson({
    name: "strategy_intent",
    system: "You parse natural-language crypto trading goals into safe structured strategy intent. Preserve the user's asset, timeframe, strategy style, budget, and risk preference. Return JSON only.",
    user: {
      message: text,
      defaults: {
        asset: "ETH",
        timeframe: "4h",
        strategyType: "breakout",
        riskPreference: "balanced",
        dailyResearchBudgetTinybar: 20_000_000,
        maxPaymentPerCallTinybar: 5_000_000,
        executionMode: "simulation"
      },
      supportedAssets: ["BTC", "ETH", "SOL", "HBAR", "LINK", "AVAX", "BNB", "XRP"],
      supportedTimeframes: ["15m", "30m", "1h", "4h", "1d", "1w"],
      supportedStrategyTypes: ["breakout", "momentum", "mean_reversion", "range", "event_driven", "scalping"],
      safety: "Live or mainnet trading requests must still map to requires_manual_approval; this MVP executes simulation only."
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["ready", "needs_clarification"] },
        message: { type: "string" },
        asset: { type: "string" },
        timeframe: { type: "string", enum: ["15m", "30m", "1h", "4h", "1d", "1w"] },
        strategyType: { type: "string", enum: ["breakout", "momentum", "mean_reversion", "range", "event_driven", "scalping"] },
        riskPreference: { type: "string", enum: ["conservative", "balanced", "aggressive"] },
        dailyResearchBudgetTinybar: { type: "integer" },
        maxPaymentPerCallTinybar: { type: "integer" },
        executionMode: { type: "string", enum: ["simulation", "requires_manual_approval"] },
        missingFields: { type: "array", items: { type: "string" } },
        questions: { type: "array", items: { type: "string" } }
      },
      required: [
        "status",
        "message",
        "asset",
        "timeframe",
        "strategyType",
        "riskPreference",
        "dailyResearchBudgetTinybar",
        "maxPaymentPerCallTinybar",
        "executionMode",
        "missingFields",
        "questions"
      ]
    }
  });

  return {
    ...payload,
    asset: String(payload.asset).toUpperCase(),
    message: text,
    parsedBy: modelClient.id
  };
}

async function buildStrategyDraftWithModel({ intent, policy, modelConfig }) {
  const modelClient = createJsonModelClient(modelConfig);
  const payload = await modelClient.generateJson({
    name: "strategy_draft",
    system: "You are a Strategy Agent drafting a crypto trading strategy from a user's intent and policy. The strategy must match the user's natural-language idea and remain simulation-only.",
    user: {
      intent,
      policy,
      availablePaidServices: {
        "market-signal": "Paid market and technical confirmation.",
        "risk-challenge": "Paid adversarial downside review and stress test."
      },
      constraints: [
        "Do not invent payment settlement.",
        "Do not authorize live trading.",
        "Use policy limits as hard risk controls.",
        "Explain what evidence is required before a simulated order."
      ]
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        asset: { type: "string" },
        timeframe: { type: "string" },
        strategyType: { type: "string" },
        thesis: { type: "string" },
        entryConditions: { type: "array", items: { type: "string" } },
        exitConditions: { type: "array", items: { type: "string" } },
        riskControls: { type: "array", items: { type: "string" } },
        requiredEvidence: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["draft"] }
      },
      required: [
        "name",
        "asset",
        "timeframe",
        "strategyType",
        "thesis",
        "entryConditions",
        "exitConditions",
        "riskControls",
        "requiredEvidence",
        "status"
      ]
    }
  });

  return {
    ...payload,
    asset: String(payload.asset).toUpperCase(),
    generatedBy: modelClient.id
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

function extractBudgetHbar(text, keywords, { allowGeneric = true } = {}) {
  for (const keyword of keywords) {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index < 0) continue;
    const nearby = text.slice(index, index + 48);
    const amount = nearby.match(/(\d+(?:\.\d+)?)\s*HBAR/i)?.[1] ?? nearby.match(/(\d+(?:\.\d+)?)/)?.[1];
    if (amount) return Number(amount);
  }

  if (!allowGeneric) return null;

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

function sanitizeTimelineOutput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTimelineOutput(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "paymentPayload") {
      sanitized[key] = {
        mode: child?.mode,
        payer: child?.payer,
        requestId: child?.requestId,
        facilitatorUrl: child?.facilitatorUrl,
        x402Version: child?.x402Version,
        signature: child?.signature ? "[redacted]" : undefined
      };
      continue;
    }

    if (key === "signature" || key === "authorization") {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = sanitizeTimelineOutput(child);
  }

  return sanitized;
}

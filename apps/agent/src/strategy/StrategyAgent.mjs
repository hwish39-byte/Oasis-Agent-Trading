import { createBudgetLedger, defaultUserPolicy } from "../../../../packages/policy/src/index.mjs";
import { createRequestId, tinybarToHbar } from "../../../../packages/shared/src/index.mjs";
import { AuditLogger } from "./AuditLogger.mjs";
import { RiskAwareDecisionComposer } from "./DecisionComposer.mjs";
import { EvidenceSynthesizer } from "./EvidenceSynthesizer.mjs";
import { createDefaultReasoner } from "./LLMReasoner.mjs";
import { MarketContextBuilder } from "./MarketContextBuilder.mjs";
import { MemoryManager, ReviewScheduler } from "./MemoryManager.mjs";
import { Observability } from "./Observability.mjs";
import { PolicyPaymentGuard } from "./PolicyPaymentGuard.mjs";
import { ToolPlanner } from "./ToolPlanner.mjs";
import { X402PaidToolClient } from "./X402PaidToolClient.mjs";
import { createExecutionProposal, createResearchRequest, createRiskChallengeRequest } from "./protocols.mjs";
import { STRATEGY_STEPS, createStrategyState } from "./schemas.mjs";

export class StrategyAgent {
  constructor({
    policy = defaultUserPolicy,
    marketContextBuilder = new MarketContextBuilder(),
    reasoner = createDefaultReasoner(),
    toolPlanner = new ToolPlanner(),
    guard = new PolicyPaymentGuard(),
    paidToolClient,
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
    this.evidenceSynthesizer = evidenceSynthesizer;
    this.decisionComposer = decisionComposer;
    this.memoryManager = memoryManager;
    this.reviewScheduler = reviewScheduler;
    this.auditLogger = auditLogger;
    this.observability = observability;
  }

  async run({ asset = this.policy.targetAsset, serviceBaseUrl } = {}) {
    const startedAt = Date.now();
    const runId = createRequestId("strategy_run");
    const state = createStrategyState({ runId, policy: this.policy, asset });
    state.ledger = createBudgetLedger(this.policy);

    await this.step(state, "load_user_policy", () => ({
      policyId: this.policy.id,
      asset,
      executionMode: this.policy.executionMode
    }));

    state.marketContext = await this.step(state, "build_market_context", () => {
      return this.marketContextBuilder.build({ asset });
    });

    state.memory = await this.step(state, "retrieve_memory", () => {
      return this.memoryManager.retrieve({ asset });
    });

    state.hypothesis = await this.step(state, "generate_hypothesis", () => {
      return this.reasoner.generateHypothesis({
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

    const paidResearch = await this.step(state, "execute_paid_research", async () => {
      return this.executePaidResearch({ state, serviceBaseUrl });
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

  async executePaidResearch({ state, serviceBaseUrl }) {
    const results = [];

    for (const plannedCall of state.toolPlan.toolCalls) {
      if (plannedCall.service !== "market-signal") {
        results.push({
          status: "deferred",
          service: plannedCall.service,
          reason: "Agent protocol is defined, but the service implementation is not connected yet."
        });
        continue;
      }

      const result = await this.paidToolClient.callMarketSignal({
        serviceBaseUrl,
        asset: state.asset,
        policy: this.policy,
        ledger: state.ledger,
        plannedCall
      });

      this.recordPaymentEvents({ state, result });
      results.push(result);
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
      evidence: state.evidence,
      decision: state.decision,
      coordination: state.coordination,
      executionProposal: state.executionProposal,
      reviewPlan: state.reviewPlan,
      memory: {
        stored: storedMemory,
        retrieved: state.memory
      },
      metrics: state.metrics,
      timeline: state.timeline
    };
  }
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

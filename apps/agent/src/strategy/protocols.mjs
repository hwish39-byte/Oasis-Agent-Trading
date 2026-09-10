export function createResearchRequest({ state, toolCall }) {
  return {
    type: "ResearchRequest",
    fromAgent: "Strategy Agent",
    toAgent: "Market Research Agent",
    runId: state.runId,
    asset: state.asset,
    hypothesis: state.hypothesis,
    maxFeeTinybar: toolCall.maxWillingToPayTinybar,
    reason: toolCall.reason,
    requiredBeforeExecution: toolCall.required
  };
}

export function createRiskChallengeRequest({ state, toolCall }) {
  return {
    type: "RiskChallengeRequest",
    fromAgent: "Strategy Agent",
    toAgent: "Risk Agent",
    runId: state.runId,
    asset: state.asset,
    hypothesis: state.hypothesis,
    evidence: state.evidence,
    maxFeeTinybar: toolCall.maxWillingToPayTinybar,
    reason: toolCall.reason,
    requiredBeforeExecution: true
  };
}

export function createExecutionProposal({ state }) {
  return {
    type: "ExecutionProposal",
    fromAgent: "Strategy Agent",
    toAgent: "Execution Agent",
    runId: state.runId,
    decisionId: state.decision.decisionId,
    asset: state.asset,
    action: state.decision.action,
    confidence: state.decision.confidence,
    policyApproved: state.policyChecks.every((check) => check.allowed),
    riskApproved: state.decision.risk.blockingReasons.length === 0,
    mode: state.policy.executionMode
  };
}

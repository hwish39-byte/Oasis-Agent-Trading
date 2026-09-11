import { StrategyAgent } from "../../agent/src/strategy/StrategyAgent.mjs";

export async function parseStrategyIntentForProduct(message, { modelConfig } = {}) {
  return new StrategyAgent().parseIntent({ message, modelConfig });
}

export function buildPolicyDraft(intent) {
  return new StrategyAgent().draftPolicy({ intent });
}

export async function buildStrategyDraftForProduct({ intent, policy, modelConfig } = {}) {
  return new StrategyAgent().draftStrategy({ intent, policy, modelConfig });
}

export async function buildAgentPlan({ intent, policy, modelConfig } = {}) {
  return new StrategyAgent().planEvidence({ intent, policy, modelConfig });
}

export function getServiceQuotes({ service, asset, depth } = {}) {
  return new StrategyAgent().getServiceQuotes({ service, asset, depth });
}

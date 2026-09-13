# Architecture

The Strategy Agent is a runtime state machine, not a fixed demo script. Each stage is a
deterministic step whose output feeds the next, and LLM output is treated as a hypothesis,
never as authority: paid Agent charges and execution remain controlled by policy and risk guards.

## Implementation Map

| Concern | Module |
| --- | --- |
| Strategy Agent Runtime state machine | `apps/agent/src/strategy/StrategyAgent.mjs` |
| Structured schemas and validation | `apps/agent/src/strategy/schemas.mjs` |
| LLM Reasoning Layer | `apps/agent/src/strategy/LLMReasoner.mjs` |
| Model provider adapters | `apps/agent/src/strategy/ModelProviders.mjs` |
| Market Context system | `apps/agent/src/strategy/MarketContextBuilder.mjs` |
| Tool Planner | `apps/agent/src/strategy/ToolPlanner.mjs` |
| Policy Guard + Billing Guard | `apps/agent/src/strategy/PolicyPaymentGuard.mjs` |
| x402/Hedera paid Agent settlement | `apps/agent/src/strategy/X402PaidToolClient.mjs` |
| Market Agent | `apps/agent/src/market/MarketResearchAgent.mjs` |
| Risk Agent | `apps/agent/src/risk/RiskAgent.mjs` |
| Evidence Synthesizer | `apps/agent/src/strategy/EvidenceSynthesizer.mjs` |
| Risk-Aware Decision Composer | `apps/agent/src/strategy/DecisionComposer.mjs` |
| Execution Agent (simulation only) | `apps/agent/src/execution/ExecutionAgent.mjs` |
| Decision Memory | `apps/agent/src/strategy/MemoryManager.mjs` |
| Multi-agent collaboration protocol | `apps/agent/src/strategy/protocols.mjs` |
| HCS audit wrapper | `apps/agent/src/strategy/AuditLogger.mjs` |
| Observability and evaluation metrics | `apps/agent/src/strategy/Observability.mjs` |
| Paid Agent pricing model | `packages/shared/src/pricing.mjs` |
| Budget and policy engine | `packages/policy/src/index.mjs` |
| Hedera/x402 adapter (real + mock) | `packages/hedera/src/index.mjs` |

## Runtime Flow

```text
load_user_policy
build_market_context
retrieve_memory
generate_hypothesis
plan_evidence_needed
plan_tool_calls
execute_paid_research
synthesize_evidence
compose_strategy_decision
final_policy_risk_check
execution_agent_review
write_audit
persist_memory
emit_observability
```

## LLM Reasoning Layer

`LLMReasoner.mjs` uses a provider adapter selected by the frontend or by `STRATEGY_AGENT_PROVIDER`.
Supported providers are OpenAI, DeepSeek, Claude, and GLM.

Frontend strategy runs send `requireLlm: true`, so missing provider credentials fail clearly instead
of pretending to be a real agent. Tests and explicit offline demos can set `OASIS_LLM_MODE=rule` to use
the deterministic `RuleBasedStrategyReasoner`.

LLM output is a hypothesis, not authority. Paid Agent charges and execution are still controlled by
deterministic policy and risk guards.

## Market Context

`MarketContextBuilder.mjs` uses live Binance public market data by default (with a CoinGecko fallback)
and computes the current signal for the requested asset/timeframe. The old ETH snapshot is retained only
through `OASIS_MARKET_DATA_MODE=fixture` for deterministic tests.

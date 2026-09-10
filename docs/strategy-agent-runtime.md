# Strategy Agent Runtime

The Strategy Agent is now organized as a runtime instead of a fixed demo script.

## Implementation Map

| Roadmap item | Current module |
| --- | --- |
| Strategy Agent Runtime state machine | `apps/agent/src/strategy/StrategyAgent.mjs` |
| Structured schemas and validation | `apps/agent/src/strategy/schemas.mjs` |
| LLM Reasoning Layer | `apps/agent/src/strategy/LLMReasoner.mjs` |
| Market Context system | `apps/agent/src/strategy/MarketContextBuilder.mjs` |
| Tool Planner | `apps/agent/src/strategy/ToolPlanner.mjs` |
| Policy Guard + Payment Guard | `apps/agent/src/strategy/PolicyPaymentGuard.mjs` |
| x402 paid tool calls | `apps/agent/src/strategy/X402PaidToolClient.mjs` |
| Evidence Synthesizer | `apps/agent/src/strategy/EvidenceSynthesizer.mjs` |
| Risk-Aware Decision Composer | `apps/agent/src/strategy/DecisionComposer.mjs` |
| Decision Memory | `apps/agent/src/strategy/MemoryManager.mjs` |
| Performance Memory | `apps/agent/src/strategy/MemoryManager.mjs` |
| Automatic review plan | `apps/agent/src/strategy/MemoryManager.mjs` |
| Multi-agent collaboration protocol | `apps/agent/src/strategy/protocols.mjs` |
| HCS audit wrapper | `apps/agent/src/strategy/AuditLogger.mjs` |
| Observability and evaluation metrics | `apps/agent/src/strategy/Observability.mjs` |
| Production safety boundaries | schemas, guards, audit hashing, timeline redaction |

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
write_audit
persist_memory
emit_observability
```

`LLMReasoner.mjs` uses the OpenAI Responses API when `OPENAI_API_KEY` is present.
Without an API key, it falls back to `RuleBasedStrategyReasoner` so local tests and mock demos remain deterministic.

LLM output is treated as a hypothesis, not as authority. Payment and execution are still controlled by deterministic policy and risk guards.

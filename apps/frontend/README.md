# Oasis Frontend Demo

Run the demo web server:

```bash
pnpm demo:web
```

Then open the printed localhost URL.

The frontend follows the Strategy Agent product flow:

1. User enters a natural-language trading goal.
2. Strategy Agent parses intent through `POST /strategy/intent`.
3. Strategy Agent drafts user policy through `POST /strategy/policy/draft`.
4. Strategy Agent drafts the strategy through `POST /strategy/draft`.
5. Strategy Agent plans evidence and paid tool calls through `POST /strategy/plan`.
6. User authorizes the budget boundary from the Policy page through `POST /billing/session/authorize`.
7. User reviews the Agent Plan page; if the budget boundary is authorized, Strategy Agent runs the full decision loop through `POST /strategy/run`.
8. The UI replays the runtime timeline, committee transcript, x402/Hedera payment flow, final decision, and audit hash.

The page is split into four stages:

- `Intent`: user goal, model selection, policy draft, strategy draft.
- `Agent Plan`: committee plan, paid service review, x402/Hedera payment states, delegated budget status, run action.
- `Run`: Strategy Agent state timeline and committee transcript.
- `Decision`: final simulated decision, evidence score, market source, LLM provider, and audit hash.

Execution remains simulation-only. Payment settlement uses the configured x402/Hedera adapter; tests can force local mock mode with `HEDERA_PAYMENT_MODE=mock`.

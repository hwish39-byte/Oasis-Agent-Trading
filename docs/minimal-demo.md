# Minimal Agent Committee x402 + Hedera Demo

This demo proves the first Oasis user-paid Agent service loop:

1. The user configures User Policy settings for each strategy analysis: total budget boundary, paid Agent call limit, and enabled paid Agents.
2. In the frontend flow, the user authorizes that budget boundary once from the Policy page.
3. The backend records the authorized session budget for automatic paid Agent charges.
4. Strategy Agent is free. It parses the natural-language trading goal and drafts a strategy.
5. Strategy Agent decides whether evidence is insufficient and recommends Market Agent and/or Risk Agent.
6. Each paid Agent quote is usage-based. Market Agent prices by requested market data volume, while Risk Agent prices by challenge workload.
7. User Policy checks each quote against allowed paid Agents, remaining budget, per-call limit, and Agent-level budgets.
8. In real payment mode, the runtime sends x402 v2 Hedera payment payloads to Blocky402 for approved internal paid Agent charges.
9. The committee synthesizes the paid Market Agent and Risk Agent outputs.
10. Execution Agent is free and creates a simulation-only execution report when the final strategy permits it.
11. The runtime records Agent charge records, simulated execution output, audit summary, and committee transcript.

Run it locally:

```bash
pnpm demo
```

Run the service alone:

```bash
pnpm demo:service
pnpm demo:risk-service
```

Run the visual web demo:

```bash
pnpm demo:web
```

Then open the printed localhost URL, authorize the budget boundary on the Policy page, and run the strategy loop from Agent Plan.

The default payment mode is `HEDERA_PAYMENT_MODE=real`. It uses funded Hedera testnet accounts and HBAR:

- network: `hedera:testnet`
- asset: `0.0.0` native HBAR
- payer: `HEDERA_USER_PAYER_ACCOUNT_ID`
- spender: `HEDERA_OASIS_SPENDER_ACCOUNT_ID`
- merchant receiver: `HEDERA_OASIS_MERCHANT_ACCOUNT_ID`
- facilitator: `BLOCKY402_FACILITATOR_URL`
- transaction ids: returned by Blocky402 `/settle`

Paid Agent pricing is dynamic:

- Market Agent: base fee plus requested candle count, indicator count, and timeframe count.
- Risk Agent: base fee plus stress scenario count, policy/risk checks, and risk factor count.

The Strategy Agent includes the expected usage in each quote. The paid service recalculates the same usage-based price from request parameters before issuing or validating the x402 payment requirement.

Real strategy runs use live market data by default and require an OpenAI API key from the frontend path. For deterministic local tests, set:

```bash
OASIS_LLM_MODE=rule OASIS_MARKET_DATA_MODE=fixture pnpm test
```

Real settlement is isolated behind `packages/hedera/src/index.mjs`.
Run with:

```bash
HEDERA_PAYMENT_MODE=real \
HEDERA_NETWORK=testnet \
HEDERA_USER_PAYER_ACCOUNT_ID=... \
HEDERA_OASIS_SPENDER_ACCOUNT_ID=... \
HEDERA_OASIS_SPENDER_PRIVATE_KEY=... \
HEDERA_OASIS_MERCHANT_ACCOUNT_ID=... \
BLOCKY402_FACILITATOR_URL=... \
pnpm demo
```

Tests and offline development can still force local mock settlement with `HEDERA_PAYMENT_MODE=mock`.

Do not commit funded accounts, private keys, seed phrases, or facilitator credentials.

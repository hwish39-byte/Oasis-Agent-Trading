# Minimal Agent Committee x402 + Hedera Demo

This demo proves the first Oasis Agent Committee loop:

1. Strategy Agent proposes researching an ETH breakout.
2. Risk Agent requests a paid adversarial risk challenge.
3. Market Research Agent requests a paid market signal.
4. User Policy checks each payment against service permissions, total budget, per-call limits, and service budgets.
5. Each service responds with HTTP 402.
6. The committee creates Hedera HBAR x402 payment payloads.
7. The services settle payments through the Blocky402/Hedera adapter.
8. The committee synthesizes the gated market signal and risk challenge.
9. Execution Agent only creates a simulated order if policy and risk checks pass.
10. The runtime records an audit summary and committee transcript.

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

Then open the printed localhost URL and click `运行演示`.

The default payment mode is `HEDERA_PAYMENT_MODE=mock`. It uses:

- network: `hedera:testnet`
- asset: `0.0.0` native HBAR
- facilitator: `mock://blocky402`
- transaction ids: deterministic Hedera-shaped demo ids

Real strategy runs use live market data by default and require an OpenAI API key from the frontend path. For deterministic local tests, set:

```bash
OASIS_LLM_MODE=rule OASIS_MARKET_DATA_MODE=fixture pnpm test
```

Real settlement is isolated behind `packages/hedera/src/index.mjs`.
When Blocky402 and Hedera credentials are available, run with:

```bash
HEDERA_PAYMENT_MODE=real \
HEDERA_NETWORK=testnet \
HEDERA_AGENT_ACCOUNT_ID=... \
HEDERA_AGENT_PRIVATE_KEY=... \
HEDERA_SERVICE_ACCOUNT_ID=... \
BLOCKY402_FACILITATOR_URL=... \
pnpm demo
```

Do not commit funded accounts, private keys, seed phrases, or facilitator credentials.

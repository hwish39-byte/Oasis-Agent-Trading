# Minimal Single-Agent x402 + Hedera Demo

This demo proves the first Oasis loop:

1. Strategy Agent proposes researching an ETH breakout.
2. Market Signal API responds with HTTP 402.
3. The agent checks user policy before paying.
4. The agent creates a Hedera HBAR x402 payment payload.
5. The service settles the payment through the Blocky402/Hedera adapter.
6. The service returns a gated market signal.
7. The agent records an audit summary and returns a simulation-only decision.

Run it locally:

```bash
pnpm demo
```

Run the service alone:

```bash
pnpm demo:service
```

Run the visual web demo:

```bash
pnpm demo:web
```

Then open the printed localhost URL and click `运行演示`.

The default mode is `HEDERA_PAYMENT_MODE=mock`. It uses:

- network: `hedera:testnet`
- asset: `0.0.0` native HBAR
- facilitator: `mock://blocky402`
- transaction id: deterministic Hedera-shaped demo id

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

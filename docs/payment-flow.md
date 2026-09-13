# Payment Flow

The paid Agent loop proves the first Oasis user-paid service: a budget-bounded x402/Hedera charge that
returns specialist analysis, all behind a policy guard.

## Flow

1. The user configures User Policy settings for each analysis: total budget boundary, paid Agent call limit, and enabled paid Agents.
2. In the frontend, the user authorizes that budget boundary once from the Policy page.
3. The backend records the authorized session budget for automatic paid Agent charges.
4. Strategy Agent is free. It parses the natural-language goal and drafts a strategy.
5. Strategy Agent decides whether evidence is insufficient and recommends Market Agent and/or Risk Agent.
6. Each paid Agent quote is usage-based. Market Agent prices by requested market data volume, Risk Agent by challenge workload.
7. User Policy checks each quote against allowed paid Agents, remaining budget, per-call limit, and Agent-level budgets.
8. In real payment mode, the runtime sends x402 v2 Hedera payment payloads to Blocky402 for approved internal charges.
9. The committee synthesizes the paid Market Agent and Risk Agent outputs.
10. Execution Agent is free and creates a simulation-only execution report when the final strategy permits it.
11. The runtime records Agent charge records, simulated execution output, audit summary, and committee transcript.

## x402 v2 Payment Requirement

The `exact` Hedera scheme uses this shape:

| Field | Value |
| --- | --- |
| `scheme` | `exact` |
| `network` | `hedera:testnet` |
| `asset` | `0.0.0` (native HBAR) |
| `amount` | price in tinybars |
| `payTo` | the Oasis merchant receiver account |
| `extra.feePayer` | returned by Blocky402 `/supported` |

Server-side facilitator calls:

- `POST /supported` — discover the fee payer
- `POST /verify` — validate a payment payload
- `POST /settle` — settle and return the Hedera transaction id

Real settlement is isolated behind `packages/hedera/src/index.mjs`.

## Required Environment

Copy `.env.example` and fill real testnet values:

```bash
HEDERA_PAYMENT_MODE=real
HEDERA_NETWORK=testnet
HEDERA_USER_PAYER_ACCOUNT_ID=0.0.x
HEDERA_OASIS_SPENDER_ACCOUNT_ID=0.0.y
HEDERA_OASIS_SPENDER_PRIVATE_KEY=0x...
HEDERA_OASIS_MERCHANT_ACCOUNT_ID=0.0.z
BLOCKY402_FACILITATOR_URL=https://your-blocky402-facilitator.example
HCS_TOPIC_ID=0.0.topic
HEDERA_MIRROR_NODE_URL=
```

Use funded Hedera testnet accounts only. The spender account is also used as the HCS submitter, so the
configured topic must allow that key to submit messages.

## Run

```bash
pnpm demo:check-real     # verify config and account balances
pnpm demo:real-payment   # one real testnet HBAR x402 payment against the local paid service
pnpm demo:web            # open the visual workspace
```

Tests and offline development force local mock settlement with `HEDERA_PAYMENT_MODE=mock`:

```bash
OASIS_LLM_MODE=rule OASIS_MARKET_DATA_MODE=fixture pnpm test
```

## Audit

In real mode, each strategy run writes a compact audit message to HCS. The message includes only
non-sensitive fields: request ID, network, decision action, reason hash, market/model/final decision
hashes, and payment transaction metadata.

Read recent audit messages back from the Mirror Node:

```bash
curl "http://127.0.0.1:4173/audit/messages?limit=10"
```

If `HEDERA_MIRROR_NODE_URL` is omitted, the adapter uses the public Mirror Node URL for the configured network.
HashScan links are generated for configured accounts, payment transactions, HCS transactions, and HCS topics.

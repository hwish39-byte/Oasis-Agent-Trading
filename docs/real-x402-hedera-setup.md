# Real x402 + Blocky402 + Hedera Testnet Setup

The local demo now has a real-mode adapter for the x402 v2 `exact` Hedera scheme.

## What is wired

- Agent-side Hedera payment payload creation through `@x402/hedera`.
- x402 v2 payment requirement shape:
  - `scheme: "exact"`
  - `network: "hedera:testnet"`
  - `asset: "0.0.0"` for native HBAR
  - `amount` in tinybars
  - `payTo` as the service receiver account
  - `extra.feePayer` from Blocky402 `/supported`
- Server-side facilitator calls:
  - `POST /supported`
  - `POST /verify`
  - `POST /settle`

## Required environment

Copy `.env.example` and fill real testnet values:

```bash
HEDERA_PAYMENT_MODE=real
HEDERA_NETWORK=testnet
HEDERA_AGENT_ACCOUNT_ID=0.0.x
HEDERA_AGENT_PRIVATE_KEY=0x...
HEDERA_SERVICE_ACCOUNT_ID=0.0.y
BLOCKY402_FACILITATOR_URL=https://your-blocky402-facilitator.example
HCS_TOPIC_ID=
```

Use funded Hedera testnet accounts only. Do not use mainnet credentials for the MVP.

## Run

```bash
pnpm demo:web
```

Open the printed URL and click `运行演示`.

## Current limitation

HCS writes are still represented as an audit hash in real mode. This keeps the first real milestone focused on one end-to-end paid request. After settlement is verified, add a real HCS `TopicMessageSubmitTransaction` step.

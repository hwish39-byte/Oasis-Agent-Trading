# Real x402 + Blocky402 + Hedera Testnet Setup

The local demo now has a real-mode adapter for the x402 v2 `exact` Hedera scheme.

## What is wired

- Policy-authorized Hedera payment payload creation through `@x402/hedera`.
- x402 v2 payment requirement shape:
  - `scheme: "exact"`
  - `network: "hedera:testnet"`
  - `asset: "0.0.0"` for native HBAR
  - `amount` in tinybars
  - `payTo` as the Oasis merchant receiver account
  - `extra.feePayer` from Blocky402 `/supported`
- Server-side facilitator calls:
  - `POST /supported`
  - `POST /verify`
  - `POST /settle`
- Real HCS audit submission with `TopicMessageSubmitTransaction`.
- HashScan links for configured accounts, payment transactions, HCS transactions, and HCS topics.
- Mirror Node audit reads through `GET /audit/messages`.

## Required environment

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

Use funded Hedera testnet accounts only. Do not use mainnet credentials for the MVP. The spender account is also used as the HCS submitter, so the configured topic must allow that key to submit messages.

## Run

```bash
pnpm demo:check-real
pnpm demo:real-payment
pnpm demo:web
```

Use `pnpm demo:real-payment` first to verify one real Hedera testnet HBAR x402 payment against the local `market-signal` paid Agent service. The product flow lets Strategy Agent decide whether Market/Risk Agent reasoning is needed, checks the Agent quote against the user's budget boundary, sends `X-PAYMENT`, and prints the real settlement transaction returned by Blocky402.

After the smoke test passes, open the printed `pnpm demo:web` URL and click `运行演示`.

## Audit

In real mode, each strategy run writes a compact audit message to HCS. The message includes only non-sensitive fields: request ID, network, decision action, reason hash, market/model/final decision hashes, and payment transaction metadata.

The demo API can read recent audit messages back from the Mirror Node:

```bash
curl "http://127.0.0.1:4173/audit/messages?limit=10"
```

If `HEDERA_MIRROR_NODE_URL` is omitted, the adapter uses the public Mirror Node URL for the configured Hedera network.

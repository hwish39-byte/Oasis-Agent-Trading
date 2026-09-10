# Oasis Frontend Demo

Run the demo web server:

```bash
pnpm demo:web
```

Then open the printed localhost URL.

The page calls `POST /demo/run` and renders the real local backend timeline:

- Strategy Agent proposes an ETH research call.
- Market Signal API requires 0.03 HBAR through HTTP 402.
- Policy allows the call under a 0.20 HBAR daily budget.
- The payment settles in mock Hedera testnet mode.
- The paid signal causes a simulation-only `NO_TRADE` decision.

The payment mode is still local mock settlement until `packages/hedera/src/index.mjs` is wired to real Blocky402/Hedera testnet credentials.

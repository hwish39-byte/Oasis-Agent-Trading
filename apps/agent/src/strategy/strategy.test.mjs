import test from "node:test";
import assert from "node:assert/strict";
import { createBudgetLedger, defaultUserPolicy } from "../../../../packages/policy/src/index.mjs";
import { PolicyPaymentGuard } from "./PolicyPaymentGuard.mjs";
import { assertStrategyDecision } from "./schemas.mjs";

test("schema validation rejects malformed strategy decisions", () => {
  assert.throws(
    () => assertStrategyDecision({
      decisionId: "decision_bad",
      action: "BUY_NOW",
      asset: "ETH",
      confidence: 1.2,
      reason: "",
      rationale: [],
      risk: {
        level: "low",
        blockingReasons: []
      }
    }),
    /decision.action/
  );
});

test("payment guard blocks unplanned or overpriced paid research", () => {
  const guard = new PolicyPaymentGuard();
  const ledger = createBudgetLedger(defaultUserPolicy);
  const paymentRequirement = {
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    amount: "3000000",
    payTo: "0.0.2002",
    extra: {
      requestId: "market_test"
    }
  };

  const unplanned = guard.checkBeforePayment({
    policy: defaultUserPolicy,
    ledger,
    paymentRequirement,
    service: "market-signal"
  });
  assert.equal(unplanned.allowed, false);
  assert.match(unplanned.reasons.join(";"), /not planned/);

  const overpriced = guard.checkBeforePayment({
    policy: defaultUserPolicy,
    ledger,
    paymentRequirement,
    service: "market-signal",
    plannedCall: {
      service: "market-signal",
      maxWillingToPayTinybar: 1_000_000
    }
  });
  assert.equal(overpriced.allowed, false);
  assert.match(overpriced.reasons.join(";"), /exceeds Strategy Agent willingness/);
});

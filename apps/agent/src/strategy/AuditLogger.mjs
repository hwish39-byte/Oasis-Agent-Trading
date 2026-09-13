import { createHash } from "node:crypto";
import { writeAuditRecord } from "../../../../packages/hedera/src/index.mjs";

export class AuditLogger {
  async write({ state }) {
    const marketDataHash = hashJson(state.marketContext.snapshot);
    const modelOutputHash = hashJson(state.hypothesis);
    const finalDecisionHash = hashJson(state.decision);
    const payment = state.payments.at(-1)?.payment ?? null;
    let audit;
    try {
      audit = await writeAuditRecord({
        requestId: state.runId,
        decision: {
          ...state.decision,
          hashes: {
            marketDataHash,
            modelOutputHash,
            finalDecisionHash
          }
        },
        payment
      });
    } catch (error) {
      audit = {
        mode: "failed",
        status: "failed",
        messageHash: hashJson({ requestId: state.runId, decision: state.decision, payment }),
        error: error.message,
        note: "Decision completed, but HCS audit submission failed."
      };
    }

    return {
      ...audit,
      status: audit.status ?? "recorded",
      marketDataHash,
      modelOutputHash,
      finalDecisionHash,
      policyVersion: state.policy.id,
      promptVersion: state.hypothesis.generatedBy ?? "unknown",
      paymentTransactionIds: state.payments.map((item) => item.payment?.transactionId).filter(Boolean)
    };
  }
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

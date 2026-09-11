import { assertEvidenceBundle } from "./schemas.mjs";

export class EvidenceSynthesizer {
  synthesize({ hypothesis, marketContext, paidResearch }) {
    const supportingEvidence = [...hypothesis.reasoning];
    const contradictingEvidence = [];
    const missingEvidence = [...hypothesis.uncertainty.missingEvidence];
    const marketSignal = paidResearch.find((item) => item.service === "market-signal" && item.status === "settled")?.result?.signal;
    const riskChallenge = paidResearch.find((item) => item.service === "risk-challenge" && item.status === "settled")?.result?.challenge;

    if (marketSignal) {
      if (marketSignal.recommendation === "buy") {
        supportingEvidence.push("Paid market signal recommends buy");
      } else {
        contradictingEvidence.push(`Paid market signal recommends ${marketSignal.recommendation}`);
      }

      if (marketSignal.volumeConfirmation === "weak") {
        contradictingEvidence.push("Paid market signal reports weak volume confirmation");
      }

      removeValue(missingEvidence, "independent market confirmation");
    }

    if (riskChallenge) {
      if (riskChallenge.verdict === "pass") {
        supportingEvidence.push("Paid risk challenge did not block the setup");
      } else {
        contradictingEvidence.push(`Paid risk challenge blocks execution: ${riskChallenge.blockingReasons.join("; ")}`);
      }

      removeValue(missingEvidence, "adversarial downside review");
    }

    const evidenceScore = scoreEvidence({
      hypothesis,
      marketContext,
      marketSignal,
      contradictingEvidence,
      riskChallenge
    });

    return assertEvidenceBundle({
      supportingEvidence,
      contradictingEvidence,
      missingEvidence,
      marketSignal: marketSignal ?? null,
      evidenceScore,
      evidenceQuality: evidenceScore >= 75 ? "high" : evidenceScore >= 50 ? "medium" : "low",
      conflictLevel: contradictingEvidence.length >= 2 ? "high" : contradictingEvidence.length === 1 ? "medium" : "low",
      riskChallenge: riskChallenge ?? null,
      recommendedDecision: evidenceScore >= 75 ? "SIMULATED_BUY" : evidenceScore >= 55 ? "HOLD" : "NO_TRADE"
    });
  }
}

function scoreEvidence({ hypothesis, marketContext, marketSignal, contradictingEvidence, riskChallenge }) {
  const signal = marketSignal ?? marketContext.snapshot;
  const breakoutScore = Number(signal.breakoutScore ?? 50);
  const confidenceScore = Number(signal.confidence ?? hypothesis.initialConfidence) * 100;
  const volumeScore = signal.volumeConfirmation === "strong" ? 90 : signal.volumeConfirmation === "weak" ? 35 : 55;
  const momentumScore = signal.momentum === "positive" ? 75 : signal.momentum === "negative" ? 25 : 50;
  const conflictPenalty = contradictingEvidence.length * 10;
  const riskPenalty = riskChallenge?.verdict === "block" ? 12 : 0;

  return clamp(
    Math.round((breakoutScore * 0.4) + (confidenceScore * 0.3) + (volumeScore * 0.2) + (momentumScore * 0.1) - conflictPenalty - riskPenalty),
    0,
    100
  );
}

function removeValue(values, target) {
  const index = values.indexOf(target);
  if (index >= 0) values.splice(index, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

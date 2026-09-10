export const HBAR_TINYBAR_MULTIPLIER = 100_000_000;

export function hbarToTinybar(hbarAmount) {
  return Math.round(Number(hbarAmount) * HBAR_TINYBAR_MULTIPLIER);
}

export function tinybarToHbar(tinybarAmount) {
  return Number(tinybarAmount) / HBAR_TINYBAR_MULTIPLIER;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createRequestId(prefix = "req") {
  const random = crypto.randomUUID().slice(0, 8);
  return `${prefix}_${Date.now()}_${random}`;
}

export function encodePaymentHeader(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePaymentHeader(headerValue) {
  if (!headerValue) {
    throw new Error("Missing X-PAYMENT header");
  }

  const json = Buffer.from(headerValue, "base64url").toString("utf8");
  return JSON.parse(json);
}

export function buildX402PaymentRequired({
  requestId,
  service,
  receiverAccountId,
  priceTinybar,
  network,
  feePayer = "0.0.7162784"
}) {
  return {
    error: "payment_required",
    accepts: [
      {
        scheme: "exact",
        network,
        asset: "0.0.0",
        amount: String(priceTinybar),
        payTo: receiverAccountId,
        description: `${service} pay-per-request result`,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        extra: {
          feePayer,
          requestId
        }
      }
    ],
    x402Version: 2
  };
}

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { nowIso } from "../../shared/src/index.mjs";

loadLocalEnv();

export function getPaymentMode() {
  return process.env.HEDERA_PAYMENT_MODE === "real" ? "real" : "mock";
}

export function getHederaConfig() {
  const mode = getPaymentMode();

  return {
    mode,
    network: process.env.HEDERA_NETWORK ?? "testnet",
    agentAccountId: process.env.HEDERA_AGENT_ACCOUNT_ID ?? "0.0.1001",
    agentPrivateKey: process.env.HEDERA_AGENT_PRIVATE_KEY,
    serviceAccountId: process.env.HEDERA_SERVICE_ACCOUNT_ID ?? (mode === "mock" ? "0.0.2002" : undefined),
    facilitatorUrl: process.env.BLOCKY402_FACILITATOR_URL ?? "mock://blocky402",
    hcsTopicId: process.env.HCS_TOPIC_ID ?? "mock-topic"
  };
}

export function getRealConfigStatus() {
  const config = getHederaConfig();
  const required = [
    "network",
    "agentAccountId",
    "agentPrivateKey",
    "serviceAccountId",
    "facilitatorUrl"
  ];
  const missing = required.filter((key) => !config[key] || config[key] === "mock://blocky402");

  if (config.mode !== "real") {
    missing.unshift("HEDERA_PAYMENT_MODE=real");
  }

  return {
    ready: config.mode === "real" && missing.length === 0,
    mode: config.mode,
    network: config.network,
    hasAgentAccountId: Boolean(config.agentAccountId),
    hasAgentPrivateKey: Boolean(config.agentPrivateKey),
    hasServiceAccountId: Boolean(config.serviceAccountId),
    facilitatorUrl: config.facilitatorUrl,
    hasHcsTopicId: Boolean(process.env.HCS_TOPIC_ID),
    missing
  };
}

export async function createAgentPaymentPayload({ requestId, paymentRequirement, policyId }) {
  const config = getHederaConfig();

  if (config.mode === "real") {
    return createRealAgentPaymentPayload({ requestId, paymentRequirement, policyId, config });
  }

  const message = [
    requestId,
    paymentRequirement.payTo,
    paymentRequirement.amount,
    paymentRequirement.network,
    paymentRequirement.asset,
    policyId
  ].join(":");

  const mockSignature = createHash("sha256").update(`mock-hedera-signature:${message}`).digest("hex");

  return {
    mode: "mock",
    x402Version: 2,
    scheme: paymentRequirement.scheme,
    network: paymentRequirement.network,
    asset: paymentRequirement.asset,
    amount: paymentRequirement.amount,
    payer: config.agentAccountId,
    payTo: paymentRequirement.payTo,
    requestId,
    policyId,
    facilitatorUrl: config.facilitatorUrl,
    signature: mockSignature,
    signedAt: nowIso()
  };
}

export async function settlePaymentForResource({ paymentPayload, expectedRequirement }) {
  const config = getHederaConfig();

  if (config.mode === "real") {
    return settleRealPaymentForResource({ paymentPayload, expectedRequirement, config });
  }

  validateMockPayment({ paymentPayload, expectedRequirement });

  const digest = createHash("sha256")
    .update(JSON.stringify({ paymentPayload, expectedRequirement }))
    .digest("hex")
    .slice(0, 16);

  return {
    mode: "mock",
    facilitator: "Blocky402 mock facilitator",
    network: "hedera:testnet",
    asset: "0.0.0",
    transactionId: `0.0.1001@${Date.now()}.${digest}`,
    settledAt: nowIso()
  };
}

export async function writeAuditRecord({ requestId, decision, payment }) {
  const config = getHederaConfig();

  if (config.mode === "real") {
    return writeRealAuditRecord({ requestId, decision, payment, config });
  }

  return {
    mode: "mock",
    hcsTopicId: config.hcsTopicId,
    consensusTimestamp: nowIso(),
    messageHash: createHash("sha256").update(JSON.stringify({ requestId, decision, payment })).digest("hex")
  };
}

function validateMockPayment({ paymentPayload, expectedRequirement }) {
  const failures = [];

  if (paymentPayload.mode !== "mock") failures.push("payment payload is not in mock mode");
  if (paymentPayload.scheme !== expectedRequirement.scheme) failures.push("scheme mismatch");
  if (paymentPayload.network !== expectedRequirement.network) failures.push("network mismatch");
  if (paymentPayload.asset !== expectedRequirement.asset) failures.push("asset mismatch");
  if (paymentPayload.amount !== expectedRequirement.amount) failures.push("amount mismatch");
  if (paymentPayload.payTo !== expectedRequirement.payTo) failures.push("payTo mismatch");
  if (paymentPayload.requestId !== expectedRequirement.extra.requestId) failures.push("request id mismatch");
  if (!paymentPayload.signature) failures.push("missing mock signature");

  if (failures.length > 0) {
    const error = new Error(`Payment verification failed: ${failures.join(", ")}`);
    error.statusCode = 402;
    throw error;
  }
}

async function createRealAgentPaymentPayload({ requestId, paymentRequirement, policyId, config }) {
  assertRealConfig(config, ["agentAccountId", "agentPrivateKey"]);

  const { ExactHederaScheme } = await import("@x402/hedera/exact/client");
  const { createClientHederaSigner, PrivateKey } = await import("@x402/hedera");
  const privateKey = parsePrivateKey(PrivateKey, config.agentPrivateKey);
  const signer = createClientHederaSigner(config.agentAccountId, privateKey, {
    network: paymentRequirement.network
  });
  const scheme = new ExactHederaScheme(signer);
  const mechanismPayment = await scheme.createPaymentPayload(2, paymentRequirement);
  const payment = {
    ...mechanismPayment,
    scheme: paymentRequirement.scheme,
    network: paymentRequirement.network,
    accepted: paymentRequirement
  };

  return {
    mode: "real",
    paymentPayload: payment,
    meta: {
      payer: config.agentAccountId,
      requestId,
      policyId,
      facilitatorUrl: config.facilitatorUrl
    },
    x402Version: payment.x402Version,
    payer: config.agentAccountId,
    requestId,
    policyId,
    facilitatorUrl: config.facilitatorUrl
  };
}

async function settleRealPaymentForResource({ paymentPayload, expectedRequirement, config }) {
  assertRealConfig(config, ["facilitatorUrl"]);
  const x402PaymentPayload = paymentPayload.paymentPayload ?? paymentPayload;

  const verify = await postFacilitatorJson({
    facilitatorUrl: config.facilitatorUrl,
    pathname: "/verify",
    body: {
      x402Version: x402PaymentPayload.x402Version ?? 2,
      paymentPayload: x402PaymentPayload,
      paymentRequirements: expectedRequirement
    }
  });

  if (!verify.isValid) {
    const reason = verify.invalidReason ?? verify.error ?? "unknown facilitator verification failure";
    const error = new Error(`Blocky402 verification failed: ${reason}`);
    error.statusCode = 402;
    throw error;
  }

  const settle = await postFacilitatorJson({
    facilitatorUrl: config.facilitatorUrl,
    pathname: "/settle",
    body: {
      x402Version: x402PaymentPayload.x402Version ?? 2,
      paymentPayload: x402PaymentPayload,
      paymentRequirements: expectedRequirement
    }
  });

  return {
    mode: "real",
    facilitator: config.facilitatorUrl,
    network: expectedRequirement.network,
    asset: expectedRequirement.asset,
    transactionId: settle.transaction ?? settle.transactionId ?? settle.txHash ?? settle.txId ?? "unknown",
    settledAt: nowIso(),
    facilitatorResponse: settle
  };
}

async function writeRealAuditRecord({ requestId, decision, payment, config }) {
  return {
    mode: "real",
    hcsTopicId: config.hcsTopicId || "not-configured",
    consensusTimestamp: nowIso(),
    messageHash: createHash("sha256").update(JSON.stringify({ requestId, decision, payment })).digest("hex"),
    note: "HCS topic submission is intentionally separate from the x402 payment loop and can be enabled after testnet settlement is verified."
  };
}

export async function fetchBlocky402SupportedRequirements({ service = "market-signal", amountTinybar, description }) {
  const config = getHederaConfig();

  if (config.mode !== "real") {
    return null;
  }

  assertRealConfig(config, ["facilitatorUrl"]);

  const supported = await postFacilitatorJson({
    facilitatorUrl: config.facilitatorUrl,
    pathname: "/supported",
    method: "GET"
  });
  const requirements = Array.isArray(supported) ? supported : supported.kinds ?? supported.accepts ?? [];
  const hederaExact = requirements.find((item) => item.scheme === "exact" && item.network === "hedera:testnet");

  if (!hederaExact?.extra?.feePayer) {
    throw new Error("Blocky402 /supported did not return a hedera:testnet exact feePayer");
  }

  return {
    feePayer: hederaExact.extra.feePayer,
    service,
    amountTinybar,
    description
  };
}

function assertRealConfig(config, keys) {
  const missing = keys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required real Hedera x402 configuration: ${missing.join(", ")}`);
  }
}

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  loadEnvFile(envPath);
}

function parsePrivateKey(PrivateKey, value) {
  if (typeof PrivateKey.fromStringECDSA === "function") {
    try {
      return PrivateKey.fromStringECDSA(value);
    } catch {
      return PrivateKey.fromString(value);
    }
  }

  return PrivateKey.fromString(value);
}

async function postFacilitatorJson({ facilitatorUrl, pathname, method = "POST", body }) {
  const endpoint = new URL(pathname, facilitatorUrl);
  const response = await fetch(endpoint, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Blocky402 ${pathname} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { HBAR_TINYBAR_MULTIPLIER, nowIso } from "../../shared/src/index.mjs";

loadLocalEnv();

const HEDERA_ENTITY_ID_PATTERN = /^\d+\.\d+\.\d+$/;

export function getPaymentMode() {
  return process.env.HEDERA_PAYMENT_MODE === "mock" ? "mock" : "real";
}

export function getHederaConfig() {
  const mode = getPaymentMode();
  const userPayerAccountId = cleanEnv(process.env.HEDERA_USER_PAYER_ACCOUNT_ID)
    ?? cleanEnv(process.env.HEDERA_AGENT_ACCOUNT_ID)
    ?? "0.0.1001";
  const spenderAccountId = cleanEnv(process.env.HEDERA_OASIS_SPENDER_ACCOUNT_ID)
    ?? cleanEnv(process.env.HEDERA_AGENT_ACCOUNT_ID)
    ?? "0.0.3003";
  const merchantAccountId = cleanEnv(process.env.HEDERA_OASIS_MERCHANT_ACCOUNT_ID)
    ?? cleanEnv(process.env.HEDERA_SERVICE_ACCOUNT_ID)
    ?? (mode === "mock" ? "0.0.2002" : undefined);

  return {
    mode,
    network: cleanEnv(process.env.HEDERA_NETWORK) ?? "testnet",
    userPayerAccountId,
    spenderAccountId,
    spenderPrivateKey: cleanEnv(process.env.HEDERA_OASIS_SPENDER_PRIVATE_KEY) ?? cleanEnv(process.env.HEDERA_AGENT_PRIVATE_KEY),
    merchantAccountId,
    agentAccountId: spenderAccountId,
    agentPrivateKey: cleanEnv(process.env.HEDERA_OASIS_SPENDER_PRIVATE_KEY) ?? cleanEnv(process.env.HEDERA_AGENT_PRIVATE_KEY),
    serviceAccountId: merchantAccountId,
    facilitatorUrl: cleanEnv(process.env.BLOCKY402_FACILITATOR_URL) ?? "mock://blocky402",
    hcsTopicId: normalizeHcsTopicId(cleanEnv(process.env.HCS_TOPIC_ID)) ?? "mock-topic",
    mirrorNodeUrl: cleanEnv(process.env.HEDERA_MIRROR_NODE_URL)
  };
}

export function getRealConfigStatus() {
  const config = getHederaConfig();
  const required = [
    "network",
    "userPayerAccountId",
    "spenderAccountId",
    "spenderPrivateKey",
    "merchantAccountId",
    "facilitatorUrl",
    "hcsTopicId"
  ];
  const missing = required.filter((key) => !isUsableRealConfigValue(key, config[key]));

  if (config.mode !== "real") {
    missing.unshift("HEDERA_PAYMENT_MODE=real");
  }

  return {
    ready: config.mode === "real" && missing.length === 0,
    mode: config.mode,
    network: config.network,
    hasUserPayerAccountId: Boolean(config.userPayerAccountId),
    hasSpenderAccountId: Boolean(config.spenderAccountId),
    hasSpenderPrivateKey: Boolean(config.spenderPrivateKey),
    hasMerchantAccountId: Boolean(config.merchantAccountId),
    hasAgentAccountId: Boolean(config.agentAccountId),
    hasAgentPrivateKey: Boolean(config.agentPrivateKey),
    hasServiceAccountId: Boolean(config.serviceAccountId),
    facilitatorUrl: config.facilitatorUrl,
    hasHcsTopicId: isValidEntityId(config.hcsTopicId),
    hcsReady: config.mode === "real" && isValidEntityId(config.hcsTopicId) && Boolean(config.spenderPrivateKey),
    missing
  };
}

export function tinybarToHbarString(tinybarAmount, { maxFractionDigits = 8 } = {}) {
  const hbar = Number(tinybarAmount) / HBAR_TINYBAR_MULTIPLIER;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits
  }).format(hbar);
}

export function formatTinybarAmount(tinybarAmount) {
  return `${tinybarToHbarString(tinybarAmount)} HBAR (${Number(tinybarAmount).toLocaleString("en-US")} tinybar)`;
}

export async function hederaNativeAccountToEvmAddress(accountId) {
  const { EntityIdHelper } = await import("@hiero-ledger/sdk");
  const { shard, realm, num } = EntityIdHelper.fromString(accountId);
  return `0x${EntityIdHelper.toSolidityAddress([shard, realm, num])}`;
}

export function getHashscanNetwork(network = "testnet") {
  return String(network).replace(/^hedera:/, "") || "testnet";
}

export function hashscanAccountUrl(accountId, network = "testnet") {
  return `https://hashscan.io/${getHashscanNetwork(network)}/account/${accountId}`;
}

export function hashscanTransactionUrl(transactionId, network = "testnet") {
  if (!transactionId || transactionId === "unknown") return null;
  return `https://hashscan.io/${getHashscanNetwork(network)}/transaction/${transactionId}`;
}

export function hashscanTopicUrl(topicId, network = "testnet") {
  if (!topicId || topicId === "mock-topic" || topicId === "not-configured") return null;
  return `https://hashscan.io/${getHashscanNetwork(network)}/topic/${topicId}`;
}

export async function getAccountBalanceTinybar(accountId) {
  const config = getHederaConfig();
  assertRealConfig(config, ["spenderAccountId", "spenderPrivateKey"]);
  const { AccountBalanceQuery } = await import("@hiero-ledger/sdk");
  const client = await createSdkClient(config);

  try {
    const balance = await new AccountBalanceQuery()
      .setAccountId(accountId)
      .execute(client);

    return Number(balance.hbars.toTinybars().toString());
  } finally {
    await closeClient(client);
  }
}

export async function createHcsAuditTopic({ memo = "Oasis Agent Trading audit timeline", submitKey = false } = {}) {
  const config = getHederaConfig();
  assertRealConfig(config, ["spenderAccountId", "spenderPrivateKey"]);
  const { PrivateKey, TopicCreateTransaction } = await import("@hiero-ledger/sdk");
  const client = await createSdkClient(config);
  const transaction = new TopicCreateTransaction().setTopicMemo(memo);

  if (submitKey) {
    const privateKey = parsePrivateKey(PrivateKey, config.spenderPrivateKey);
    transaction.setSubmitKey(privateKey.publicKey);
  }

  try {
    const txResponse = await transaction.execute(client);
    const receipt = await txResponse.getReceipt(client);
    const topicId = receipt.topicId?.toString();

    return {
      mode: "real",
      network: config.network,
      topicId,
      transactionId: txResponse.transactionId?.toString(),
      hashscanUrl: hashscanTopicUrl(topicId, config.network),
      transactionHashscanUrl: hashscanTransactionUrl(txResponse.transactionId?.toString(), config.network),
      memo,
      submitKeyMode: submitKey ? "spender_public_key" : "open_submit"
    };
  } finally {
    await closeClient(client);
  }
}

export async function getRealAccountChecks() {
  const config = getHederaConfig();
  const accounts = [
    ["payer", config.userPayerAccountId],
    ["spender", config.spenderAccountId],
    ["merchant", config.merchantAccountId]
  ].filter(([, accountId]) => accountId);

  const checks = [];
  for (const [role, accountId] of accounts) {
    try {
      const balanceTinybar = await getAccountBalanceTinybar(accountId);
      checks.push({
        role,
        accountId,
        balanceTinybar,
        balanceHbar: Number(balanceTinybar) / HBAR_TINYBAR_MULTIPLIER,
        hashscanUrl: hashscanAccountUrl(accountId, config.network),
        ok: balanceTinybar > 0
      });
    } catch (error) {
      checks.push({
        role,
        accountId,
        ok: false,
        error: error.message
      });
    }
  }

  return checks;
}

export async function getHederaRuntimeStatus() {
  const config = getHederaConfig();
  const status = getRealConfigStatus();
  const result = {
    mode: status.mode,
    network: status.network,
    ready: status.ready,
    missing: status.missing,
    facilitatorUrl: status.facilitatorUrl,
    hcs: {
      topicId: config.hcsTopicId === "mock-topic" ? null : config.hcsTopicId,
      ready: status.hcsReady,
      hashscanUrl: hashscanTopicUrl(config.hcsTopicId, config.network),
      mirrorNode: {
        checked: false,
        ok: false,
        error: null
      }
    },
    accounts: [
      ["payer", config.userPayerAccountId],
      ["spender", config.spenderAccountId],
      ["merchant", config.merchantAccountId]
    ].filter(([, accountId]) => accountId).map(([role, accountId]) => ({
      role,
      accountId,
      hashscanUrl: hashscanAccountUrl(accountId, config.network)
    })),
    blocky402: {
      checked: false,
      ok: false,
      feePayer: null,
      error: null
    }
  };

  if (config.mode !== "real") {
    return result;
  }

  if (isValidEntityId(config.hcsTopicId)) {
    result.hcs.mirrorNode.checked = true;
    try {
      const topic = await fetchHcsTopicInfo({ topicId: config.hcsTopicId });
      result.hcs.mirrorNode.ok = true;
      result.hcs.deleted = topic.deleted;
      result.hcs.memo = topic.memo;
      result.hcs.sequenceNumber = topic.sequenceNumber;
      result.hcs.ready = result.hcs.ready && !topic.deleted;
    } catch (error) {
      result.hcs.mirrorNode.error = error.message;
      result.hcs.ready = false;
      result.ready = false;
      if (!result.missing.includes("hcsTopicId")) result.missing.push("hcsTopicId");
    }
  }

  if (config.spenderPrivateKey && config.spenderAccountId) {
    result.accounts = await getRealAccountChecks();
  }

  if (config.facilitatorUrl && config.facilitatorUrl !== "mock://blocky402") {
    result.blocky402.checked = true;
    try {
      const supported = await fetchBlocky402SupportedRequirements({
        amountTinybar: 3_000_000,
        description: "market-signal pay-per-request result"
      });
      result.blocky402.ok = true;
      result.blocky402.feePayer = supported.feePayer;
    } catch (error) {
      result.blocky402.error = error.message;
    }
  }

  return result;
}

export async function createAgentPaymentPayload({
  requestId,
  paymentRequirement,
  policyId,
  payerAccountId,
  spenderAccountId
}) {
  const config = getHederaConfig();
  const payer = payerAccountId ?? config.userPayerAccountId;
  const spender = spenderAccountId ?? config.spenderAccountId;

  if (config.mode === "real") {
    return createRealAgentPaymentPayload({ requestId, paymentRequirement, policyId, payerAccountId: payer, spenderAccountId: spender, config });
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
    payer,
    spender,
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
  const transactionId = `0.0.1001@${Date.now()}.${digest}`;

  return {
    mode: "mock",
    facilitator: "Blocky402 mock facilitator",
    network: "hedera:testnet",
    asset: "0.0.0",
    payer: paymentPayload.payer,
    spender: paymentPayload.spender,
    payTo: paymentPayload.payTo,
    transactionId,
    hashscanUrl: hashscanTransactionUrl(transactionId, "testnet"),
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
    messageHash: createHash("sha256").update(JSON.stringify({ requestId, decision, payment })).digest("hex"),
    hashscanUrl: hashscanTopicUrl(config.hcsTopicId, config.network)
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

async function createRealAgentPaymentPayload({ requestId, paymentRequirement, policyId, payerAccountId, spenderAccountId, config }) {
  assertRealConfig(config, ["spenderAccountId", "spenderPrivateKey"]);

  const { ExactHederaScheme } = await import("@x402/hedera/exact/client");
  const { createClientHederaSigner, PrivateKey } = await import("@x402/hedera");
  const privateKey = parsePrivateKey(PrivateKey, config.spenderPrivateKey);
  const signer = createClientHederaSigner(config.spenderAccountId, privateKey, {
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
      payer: payerAccountId,
      spender: spenderAccountId,
      requestId,
      policyId,
      facilitatorUrl: config.facilitatorUrl
    },
    x402Version: payment.x402Version,
    payer: payerAccountId,
    spender: spenderAccountId,
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
    hashscanUrl: hashscanTransactionUrl(settle.transaction ?? settle.transactionId ?? settle.txHash ?? settle.txId, expectedRequirement.network),
    settledAt: nowIso(),
    facilitatorResponse: settle
  };
}

async function writeRealAuditRecord({ requestId, decision, payment, config }) {
  assertRealConfig(config, ["spenderAccountId", "spenderPrivateKey", "hcsTopicId"]);
  await fetchHcsTopicInfo({ topicId: config.hcsTopicId });
  const { TopicMessageSubmitTransaction } = await import("@hiero-ledger/sdk");
  const client = await createSdkClient(config);
  const message = createAuditMessage({ requestId, decision, payment, config });
  const messageJson = JSON.stringify(message);
  const messageHash = createHash("sha256").update(messageJson).digest("hex");

  try {
    const txResponse = await new TopicMessageSubmitTransaction({
      topicId: config.hcsTopicId,
      message: messageJson
    }).execute(client);
    const receipt = await txResponse.getReceipt(client);
    const transactionId = txResponse.transactionId?.toString();

    return {
      mode: "real",
      hcsTopicId: config.hcsTopicId,
      topicSequenceNumber: receipt.topicSequenceNumber?.toString(),
      consensusTimestamp: receipt.topicRunningHashVersion ? nowIso() : nowIso(),
      transactionId,
      transactionHashscanUrl: hashscanTransactionUrl(transactionId, config.network),
      messageHash,
      messageBytes: Buffer.byteLength(messageJson, "utf8"),
      hashscanUrl: hashscanTopicUrl(config.hcsTopicId, config.network)
    };
  } catch (error) {
    throw new Error(`HCS topic ${config.hcsTopicId} on ${getHashscanNetwork(config.network)} rejected audit write: ${error.message}`);
  } finally {
    await closeClient(client);
  }
}

export async function fetchAuditMessages({ topicId, limit = 25, order = "desc", minTimestamp } = {}) {
  const config = getHederaConfig();
  const resolvedTopicId = topicId ?? config.hcsTopicId;
  if (!resolvedTopicId || resolvedTopicId === "mock-topic") {
    return {
      mode: config.mode,
      hcsTopicId: resolvedTopicId,
      messages: []
    };
  }

  const mirrorNodeUrl = getMirrorNodeUrl(config);
  const endpoint = new URL(`/api/v1/topics/${resolvedTopicId}/messages`, mirrorNodeUrl);
  endpoint.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || 25, 1), 100)));
  endpoint.searchParams.set("order", order === "asc" ? "asc" : "desc");
  if (minTimestamp) {
    endpoint.searchParams.set("timestamp", `gt:${minTimestamp}`);
  }

  const response = await fetch(endpoint);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Mirror Node topic read failed with ${response.status}: ${JSON.stringify(payload)}`);
  }

  return {
    mode: "real",
    hcsTopicId: resolvedTopicId,
    mirrorNodeUrl,
    hashscanUrl: hashscanTopicUrl(resolvedTopicId, config.network),
    messages: (payload.messages ?? []).map(parseMirrorNodeTopicMessage)
  };
}

export async function fetchHcsTopicInfo({ topicId } = {}) {
  const config = getHederaConfig();
  const resolvedTopicId = topicId ?? config.hcsTopicId;
  if (!isValidEntityId(resolvedTopicId)) {
    throw new Error(`Invalid HCS topic id: ${resolvedTopicId ?? "missing"}`);
  }

  const mirrorNodeUrl = getMirrorNodeUrl(config);
  const endpoint = new URL(`/api/v1/topics/${resolvedTopicId}`, mirrorNodeUrl);
  const response = await fetch(endpoint);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload._status) {
    const detail = payload._status?.messages?.map((item) => item.detail ?? item.message).filter(Boolean).join("; ")
      ?? JSON.stringify(payload);
    throw new Error(`Mirror Node topic ${resolvedTopicId} not found on ${getHashscanNetwork(config.network)}: ${detail}`);
  }

  return {
    topicId: resolvedTopicId,
    memo: payload.memo ?? "",
    deleted: Boolean(payload.deleted),
    sequenceNumber: payload.sequence_number,
    submitKey: payload.submit_key?._type ? payload.submit_key : null,
    adminKey: payload.admin_key?._type ? payload.admin_key : null,
    createdTimestamp: payload.created_timestamp,
    autoRenewAccount: payload.auto_renew_account
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
  const missing = keys.filter((key) => !isUsableRealConfigValue(key, config[key]));

  if (missing.length > 0) {
    throw new Error(`Missing required real Hedera x402 configuration: ${missing.join(", ")}`);
  }
}

function cleanEnv(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHcsTopicId(value) {
  if (!value) return undefined;
  const match = String(value).match(/\d+\.\d+\.\d+/);
  return match?.[0] ?? value;
}

function isValidEntityId(value) {
  return HEDERA_ENTITY_ID_PATTERN.test(String(value ?? ""));
}

function isUsableRealConfigValue(key, value) {
  if (!value || value === "mock://blocky402" || value === "mock-topic") return false;
  if (["hcsTopicId", "userPayerAccountId", "spenderAccountId", "merchantAccountId"].includes(key)) {
    return isValidEntityId(value);
  }
  return true;
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

async function createSdkClient(config) {
  const { AccountId, Client, PrivateKey } = await import("@hiero-ledger/sdk");
  const privateKey = parsePrivateKey(PrivateKey, config.spenderPrivateKey);
  const accountId = AccountId.fromString(config.spenderAccountId);
  const network = getHashscanNetwork(config.network);
  const client = network === "mainnet"
    ? Client.forMainnet()
    : network === "previewnet"
      ? Client.forPreviewnet()
      : Client.forTestnet();

  return client.setOperator(accountId, privateKey);
}

async function closeClient(client) {
  if (typeof client.close === "function") {
    await client.close();
  }
}

function createAuditMessage({ requestId, decision, payment, config }) {
  return {
    type: "oasis.agent_decision_audit.v1",
    requestId,
    network: `hedera:${getHashscanNetwork(config.network)}`,
    recordedAt: nowIso(),
    decisionAction: decision?.action,
    decisionReasonHash: createHash("sha256").update(String(decision?.reason ?? "")).digest("hex"),
    decisionHashes: decision?.hashes ?? {},
    payment: payment ? {
      transactionId: payment.transactionId,
      network: payment.network,
      asset: payment.asset,
      mode: payment.mode,
      settledAt: payment.settledAt
    } : null
  };
}

function getMirrorNodeUrl(config) {
  if (config.mirrorNodeUrl) return config.mirrorNodeUrl;
  const network = getHashscanNetwork(config.network);
  if (network === "mainnet") return "https://mainnet-public.mirrornode.hedera.com";
  if (network === "previewnet") return "https://previewnet.mirrornode.hedera.com";
  return "https://testnet.mirrornode.hedera.com";
}

function parseMirrorNodeTopicMessage(item) {
  const decoded = Buffer.from(item.message ?? "", "base64").toString("utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    parsed = decoded;
  }

  return {
    consensusTimestamp: item.consensus_timestamp,
    sequenceNumber: item.sequence_number,
    runningHash: item.running_hash,
    runningHashVersion: item.running_hash_version,
    payerAccountId: item.payer_account_id,
    messageHash: createHash("sha256").update(decoded).digest("hex"),
    message: parsed
  };
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

import {
  fetchBlocky402SupportedRequirements,
  fetchHcsTopicInfo,
  formatTinybarAmount,
  getRealAccountChecks,
  getRealConfigStatus
} from "../../../packages/hedera/src/index.mjs";

const status = getRealConfigStatus();

console.log("Oasis real x402/Hedera config check");
console.log("====================================");
console.log(`mode: ${status.mode}`);
console.log(`network: ${status.network}`);
console.log(`agent account: ${status.hasAgentAccountId ? "set" : "missing"}`);
console.log(`agent private key: ${status.hasAgentPrivateKey ? "set" : "missing"}`);
console.log(`service account: ${status.hasServiceAccountId ? "set" : "missing"}`);
console.log(`facilitator: ${status.facilitatorUrl}`);
console.log(`HCS topic: ${status.hasHcsTopicId ? "set" : "missing"}`);
console.log(`HCS audit writes: ${status.hcsReady ? "ready" : "not ready"}`);

if (status.missing.length > 0) {
  console.log(`missing required fields: ${status.missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("required env fields: ok");
}

if (status.mode === "real" && status.facilitatorUrl && status.facilitatorUrl !== "mock://blocky402") {
  if (status.hasHcsTopicId) {
    try {
      const topic = await fetchHcsTopicInfo();
      console.log(`HCS topic metadata: ok, sequence=${topic.sequenceNumber}, deleted=${topic.deleted}`);
    } catch (error) {
      console.log(`HCS topic metadata: failed, ${error.message}`);
      process.exitCode = 1;
    }
  }

  try {
    const accountChecks = await getRealAccountChecks();
    for (const check of accountChecks) {
      if (check.ok) {
        console.log(`${check.role} balance: ${formatTinybarAmount(check.balanceTinybar)} ${check.hashscanUrl}`);
      } else {
        console.log(`${check.role} balance: failed, ${check.error}`);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.log(`Hedera account checks: failed, ${error.message}`);
    process.exitCode = 1;
  }

  try {
    const supported = await fetchBlocky402SupportedRequirements({
      amountTinybar: 3_000_000,
      description: "market-signal pay-per-request result"
    });

    console.log(`Blocky402 /supported: ok, feePayer=${supported.feePayer}`);
  } catch (error) {
    console.log(`Blocky402 /supported: failed, ${error.message}`);
    process.exitCode = 1;
  }
}

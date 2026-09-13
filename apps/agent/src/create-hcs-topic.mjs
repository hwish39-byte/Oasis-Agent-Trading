import { createHcsAuditTopic, getRealConfigStatus } from "../../../packages/hedera/src/index.mjs";

const status = getRealConfigStatus();

if (status.mode !== "real" || !status.hasSpenderAccountId || !status.hasSpenderPrivateKey) {
  console.error("Cannot create HCS topic without real Hedera spender credentials.");
  console.error("Set HEDERA_PAYMENT_MODE=real, HEDERA_OASIS_SPENDER_ACCOUNT_ID, and HEDERA_OASIS_SPENDER_PRIVATE_KEY first.");
  process.exit(1);
}

const topic = await createHcsAuditTopic({
  memo: "Oasis Agent Trading audit timeline",
  submitKey: process.argv.includes("--submit-key")
});

console.log("Created Oasis HCS audit topic");
console.log("==============================");
console.log(`network: hedera:${topic.network}`);
console.log(`topicId: ${topic.topicId}`);
console.log(`submitKeyMode: ${topic.submitKeyMode}`);
console.log(`topic: ${topic.hashscanUrl}`);
console.log(`transaction: ${topic.transactionHashscanUrl}`);
console.log("");
console.log("Add this to .env and restart pnpm demo:web:");
console.log(`HCS_TOPIC_ID=${topic.topicId}`);

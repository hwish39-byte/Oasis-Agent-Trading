import {
  closeMarketSignalServer,
  createMarketSignalServer
} from "../../market-signal-api/src/server.mjs";
import { StrategyAgent } from "./strategy/StrategyAgent.mjs";

export async function runSingleAgentDemo({ startLocalService = true, serviceBaseUrl, strategyAgent } = {}) {
  let ownedServer;

  if (startLocalService) {
    const started = await createMarketSignalServer({ port: 0 });
    ownedServer = started.server;
    serviceBaseUrl = started.baseUrl;
  }

  try {
    const agent = strategyAgent ?? new StrategyAgent();
    return await agent.run({ serviceBaseUrl });
  } finally {
    if (ownedServer) {
      await closeMarketSignalServer(ownedServer);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runSingleAgentDemo();

  console.log("\nOasis Strategy Agent runtime demo");
  console.log("=================================\n");

  for (const event of result.timeline) {
    console.log(JSON.stringify(event, null, 2));
  }

  console.log("\nFinal result");
  console.log(JSON.stringify(
    {
      finalDecision: result.finalDecision,
      reason: result.reason,
      budget: result.budget,
      payment: result.payment,
      audit: result.audit,
      metrics: result.metrics
    },
    null,
    2
  ));
}

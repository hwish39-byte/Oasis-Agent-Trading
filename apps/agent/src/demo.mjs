import {
  closeMarketSignalServer,
  createMarketSignalServer
} from "../../market-signal-api/src/server.mjs";
import {
  closeRiskChallengeServer,
  createRiskChallengeServer
} from "../../risk-challenge-api/src/server.mjs";
import { StrategyAgent } from "./strategy/StrategyAgent.mjs";

export async function runSingleAgentDemo({
  startLocalService = true,
  serviceBaseUrl,
  marketServiceBaseUrl,
  riskServiceBaseUrl,
  strategyAgent,
  userMessage,
  intent,
  strategyDraft
} = {}) {
  let ownedMarketServer;
  let ownedRiskServer;

  if (startLocalService) {
    const market = await createMarketSignalServer({ port: 0 });
    const risk = await createRiskChallengeServer({ port: 0 });
    ownedMarketServer = market.server;
    ownedRiskServer = risk.server;
    marketServiceBaseUrl = market.baseUrl;
    riskServiceBaseUrl = risk.baseUrl;
  }

  try {
    const agent = strategyAgent ?? new StrategyAgent();
    return await agent.run({
      userMessage,
      intent,
      strategyDraft,
      serviceBaseUrl,
      marketServiceBaseUrl: marketServiceBaseUrl ?? serviceBaseUrl,
      riskServiceBaseUrl
    });
  } finally {
    if (ownedMarketServer) {
      await closeMarketSignalServer(ownedMarketServer);
    }

    if (ownedRiskServer) {
      await closeRiskChallengeServer(ownedRiskServer);
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

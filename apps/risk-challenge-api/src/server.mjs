import http from "node:http";
import { buildX402PaymentRequired, createRequestId, decodePaymentHeader } from "../../../packages/shared/src/index.mjs";
import {
  fetchBlocky402SupportedRequirements,
  getHederaConfig,
  settlePaymentForResource
} from "../../../packages/hedera/src/index.mjs";

const SERVICE_NAME = "risk-challenge";
const PRICE_TINYBAR = 2_000_000;

export async function createRiskChallengeServer({ port = 4022, host = "127.0.0.1" } = {}) {
  const config = getHederaConfig();
  const supported = await fetchBlocky402SupportedRequirements({
    service: SERVICE_NAME,
    amountTinybar: PRICE_TINYBAR,
    description: `${SERVICE_NAME} pay-per-request result`
  });
  const pendingRequirements = new Map();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: SERVICE_NAME });
        return;
      }

      if (request.method !== "GET" || url.pathname !== "/challenge") {
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      const asset = url.searchParams.get("asset") ?? "ETH";
      const setup = url.searchParams.get("setup") ?? "BREAKOUT";
      const confidence = Number(url.searchParams.get("confidence") ?? 0.5);
      const paymentHeader = request.headers["x-payment"];

      if (!paymentHeader) {
        const requestId = createRequestId("risk");
        const paymentRequired = buildX402PaymentRequired({
          requestId,
          service: SERVICE_NAME,
          receiverAccountId: config.serviceAccountId,
          priceTinybar: PRICE_TINYBAR,
          network: "hedera:testnet",
          feePayer: supported?.feePayer
        });
        pendingRequirements.set(requestId, paymentRequired.accepts[0]);
        response.setHeader("X-PAYMENT-REQUIRED", "true");
        sendJson(response, 402, paymentRequired);
        return;
      }

      const paymentPayload = decodePaymentHeader(paymentHeader);
      const expectedRequirement = pendingRequirements.get(paymentPayload.requestId);

      if (!expectedRequirement) {
        sendJson(response, 402, {
          error: "unknown_payment_request",
          message: "Payment request has expired or was not issued by this service."
        });
        return;
      }

      const settlement = await settlePaymentForResource({ paymentPayload, expectedRequirement });
      pendingRequirements.delete(paymentPayload.requestId);

      sendJson(response, 200, {
        service: SERVICE_NAME,
        asset,
        priceTinybar: PRICE_TINYBAR,
        payment: settlement,
        challenge: buildRiskChallenge({ asset, setup, confidence })
      });
    } catch (error) {
      const status = error.statusCode ?? 500;
      sendJson(response, status, {
        error: status === 402 ? "payment_failed" : "internal_error",
        message: error.message
      });
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return {
    server,
    baseUrl: `http://${host}:${server.address().port}`
  };
}

export async function closeRiskChallengeServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function buildRiskChallenge({ asset, setup, confidence }) {
  const blockingReasons = [];

  if (setup === "BREAKOUT") {
    blockingReasons.push("breakout needs stronger volume confirmation before simulated execution");
  }

  if (confidence < 0.65) {
    blockingReasons.push("initial confidence is below the committee execution threshold");
  }

  return {
    verdict: blockingReasons.length > 0 ? "block" : "pass",
    riskLevel: blockingReasons.length > 0 ? "high" : "medium",
    blockingReasons,
    stressScenarios: [
      `${asset} rejects the breakout level and returns to the prior range`,
      "liquidity thins after the signal and slippage rises",
      "correlated majors weaken and invalidate momentum confirmation"
    ],
    counterArgument: blockingReasons.length > 0
      ? `${asset} ${setup} evidence is not robust enough to increase exposure.`
      : `${asset} ${setup} can proceed only as a simulation with tight invalidation.`
  };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4022);
  const { baseUrl } = await createRiskChallengeServer({ port });
  console.log(`Risk Challenge API listening on ${baseUrl}`);
}

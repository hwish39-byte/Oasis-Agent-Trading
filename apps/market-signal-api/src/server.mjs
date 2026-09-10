import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildX402PaymentRequired,
  createRequestId,
  decodePaymentHeader
} from "../../../packages/shared/src/index.mjs";
import {
  fetchBlocky402SupportedRequirements,
  getHederaConfig,
  settlePaymentForResource
} from "../../../packages/hedera/src/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(__dirname, "../../../data/snapshots/eth-breakout.json");

const SERVICE_NAME = "market-signal";
const PRICE_TINYBAR = 3_000_000;

export async function createMarketSignalServer({ port = 4021, host = "127.0.0.1" } = {}) {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
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

      if (request.method !== "GET" || url.pathname !== "/signal") {
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      const asset = url.searchParams.get("asset") ?? "ETH";
      const paymentHeader = request.headers["x-payment"];

      if (!paymentHeader) {
        const requestId = createRequestId("market");
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
        signal: snapshot
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

export async function closeMarketSignalServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4021);
  const { baseUrl } = await createMarketSignalServer({ port });
  console.log(`Market Signal API listening on ${baseUrl}`);
}

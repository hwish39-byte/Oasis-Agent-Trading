import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSingleAgentDemo } from "../../agent/src/demo.mjs";
import { StrategyAgent } from "../../agent/src/strategy/StrategyAgent.mjs";
import {
  buildAgentPlan,
  buildPolicyDraft,
  buildStrategyDraft,
  getServiceQuotes,
  parseStrategyIntent
} from "./strategy-product.mjs";

const projectRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const frontendRoot = resolve(projectRoot, "apps/frontend");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export async function createDemoApiServer({ port = 4173, host = "127.0.0.1" } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "oasis-demo-api" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/demo/run") {
        const result = await runSingleAgentDemo();
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/intent") {
        const body = await readJsonBody(request);
        const intent = parseStrategyIntent(body.message);
        sendJson(response, 200, intent);
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/policy/draft") {
        const body = await readJsonBody(request);
        const policyDraft = buildPolicyDraft(body.intent);
        sendJson(response, 200, { policyDraft, requiresUserApproval: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/draft") {
        const body = await readJsonBody(request);
        const strategyDraft = buildStrategyDraft({ intent: body.intent, policy: body.policy });
        sendJson(response, 200, { strategyDraft, requiresUserApproval: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/plan") {
        const body = await readJsonBody(request);
        const plan = await buildAgentPlan({ intent: body.intent, policy: body.policy });
        sendJson(response, 200, plan);
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/run") {
        const body = await readJsonBody(request);
        const policy = body.policy ? Object.freeze(body.policy) : undefined;
        const result = await runSingleAgentDemo({
          strategyAgent: policy ? new StrategyAgent({ policy }) : undefined
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/services/quotes") {
        sendJson(response, 200, getServiceQuotes({
          service: url.searchParams.get("service"),
          asset: url.searchParams.get("asset"),
          depth: url.searchParams.get("depth")
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/payments/approve") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          status: "approved",
          approvalId: `approval_${Date.now()}`,
          approvedAt: new Date().toISOString(),
          ...body
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/payments/reject") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          status: "rejected",
          rejectedAt: new Date().toISOString(),
          ...body
        });
        return;
      }

      if (request.method === "GET") {
        await serveFrontendAsset({ pathname: url.pathname, response });
        return;
      }

      sendJson(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      sendJson(response, error.statusCode ?? 500, {
        error: "demo_api_error",
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

export async function closeDemoApiServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

async function serveFrontendAsset({ pathname, response }) {
  const assetPathname = pathname === "/" ? "/index.html" : pathname;
  const normalized = resolve(frontendRoot, `.${assetPathname}`);

  if (!normalized.startsWith(frontendRoot)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }

  try {
    const body = await readFile(normalized);
    response.writeHead(200, {
      "content-type": contentTypes[extname(normalized)] ?? "application/octet-stream"
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "not_found" });
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4173);
  const { baseUrl } = await createDemoApiServer({ port });
  console.log(`Oasis demo running at ${baseUrl}`);
}

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestId } from "../../../packages/shared/src/index.mjs";
import { fetchAuditMessages, getHederaRuntimeStatus } from "../../../packages/hedera/src/index.mjs";
import { runSingleAgentDemo } from "../../agent/src/demo.mjs";
import { StrategyAgent } from "../../agent/src/strategy/StrategyAgent.mjs";
import { createDefaultReasoner } from "../../agent/src/strategy/LLMReasoner.mjs";

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

      if (request.method === "GET" && url.pathname === "/audit/messages") {
        const result = await fetchAuditMessages({
          topicId: url.searchParams.get("topicId") || undefined,
          limit: url.searchParams.get("limit") || undefined,
          order: url.searchParams.get("order") || undefined,
          minTimestamp: url.searchParams.get("minTimestamp") || undefined
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/hedera/status") {
        const status = await getHederaRuntimeStatus();
        sendJson(response, 200, status);
        return;
      }

      if (request.method === "POST" && url.pathname === "/demo/run") {
        const result = await runSingleAgentDemo();
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/intent") {
        const body = await readJsonBody(request);
        const strategyAgent = new StrategyAgent({ locale: body.locale });
        const intent = await strategyAgent.parseIntent({
          message: body.message,
          modelConfig: body.modelConfig,
          locale: body.locale
        });
        sendJson(response, 200, intent);
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/policy/draft") {
        const body = await readJsonBody(request);
        const strategyAgent = new StrategyAgent({ locale: body.locale });
        const policyDraft = strategyAgent.draftPolicy({ intent: body.intent });
        sendJson(response, 200, { policyDraft, requiresUserApproval: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/draft") {
        const body = await readJsonBody(request);
        const strategyAgent = new StrategyAgent({ locale: body.locale });
        const strategyDraft = await strategyAgent.draftStrategy({
          intent: body.intent,
          policy: body.policy,
          modelConfig: body.modelConfig,
          locale: body.locale
        });
        sendJson(response, 200, { strategyDraft, requiresUserApproval: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/plan") {
        const body = await readJsonBody(request);
        const strategyAgent = new StrategyAgent({ locale: body.locale });
        const plan = await strategyAgent.planEvidence({
          intent: body.intent,
          policy: body.policy,
          modelConfig: body.modelConfig,
          locale: body.locale
        });
        sendJson(response, 200, plan);
        return;
      }

      if (request.method === "POST" && url.pathname === "/strategy/run") {
        const body = await readJsonBody(request);
        const policy = body.policy ? Object.freeze(body.policy) : undefined;
        const authorization = validateBudgetAuthorization({ policy });
        if (!authorization.allowed) {
          sendJson(response, 403, {
            error: "budget_authorization_required",
            message: authorization.reasons.join("; "),
            reasons: authorization.reasons
          });
          return;
        }
        const result = await runSingleAgentDemo({
          strategyAgent: policy ? new StrategyAgent({
            policy,
            locale: body.locale,
            reasoner: createDefaultReasoner({
              provider: body.modelConfig?.provider,
              model: body.modelConfig?.model,
              requireLlm: body.requireLlm === true
            })
          }) : undefined,
          userMessage: body.message ?? body.intent?.message,
          intent: body.intent,
          strategyDraft: body.strategyDraft
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/billing/session/authorize") {
        const body = await readJsonBody(request);
        const sessionBudgetTinybar = Number(body.sessionBudgetTinybar);

        if (!Number.isFinite(sessionBudgetTinybar) || sessionBudgetTinybar <= 0) {
          sendJson(response, 400, {
            error: "invalid_session_budget",
            message: "Session budget must be greater than zero."
          });
          return;
        }

        sendJson(response, 200, {
          status: "authorized",
          sessionId: createRequestId("escrow_session"),
          payerAccountId: "local-session",
          authorizedBudgetTinybar: sessionBudgetTinybar,
          availableBalanceTinybar: sessionBudgetTinybar,
          spentTinybar: 0,
          fundingReference: `local://session-budget/${Date.now()}`,
          authorizedAt: new Date().toISOString()
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/services/quotes") {
        const strategyAgent = new StrategyAgent();
        sendJson(response, 200, strategyAgent.getServiceQuotes({
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

function validateBudgetAuthorization({ policy }) {
  const reasons = [];

  if (!policy) {
    reasons.push("policy is required");
    return { allowed: false, reasons };
  }

  const sessionBudgetTinybar = Number(policy.sessionBudgetTinybar ?? policy.dailyBudgetTinybar);
  const maxPaidAgentCallTinybar = Number(policy.maxPaidAgentCallTinybar ?? policy.maxPaymentPerCallTinybar);
  const escrow = policy.sessionEscrow ?? {};
  const authorizedBudgetTinybar = Number(escrow.authorizedBudgetTinybar ?? 0);
  const availableBalanceTinybar = Number(escrow.availableBalanceTinybar ?? 0);

  if (policy.autoPayEnabled !== true) reasons.push("auto-pay must be enabled for delegated budget spending");
  if (escrow.status !== "authorized") reasons.push("session budget boundary is not authorized");
  if (!escrow.sessionId) reasons.push("session budget authorization is missing a sessionId");
  if (!Number.isFinite(sessionBudgetTinybar) || sessionBudgetTinybar <= 0) reasons.push("session budget must be greater than zero");
  if (!Number.isFinite(maxPaidAgentCallTinybar) || maxPaidAgentCallTinybar <= 0) reasons.push("per-agent call limit must be greater than zero");
  if (!Number.isFinite(authorizedBudgetTinybar) || authorizedBudgetTinybar < sessionBudgetTinybar) {
    reasons.push("authorized budget is lower than the submitted policy budget");
  }
  if (!Number.isFinite(availableBalanceTinybar) || availableBalanceTinybar <= 0) {
    reasons.push("authorized session budget has no available balance");
  }
  return {
    allowed: reasons.length === 0,
    reasons
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

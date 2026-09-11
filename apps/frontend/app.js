const els = {
  intentInput: document.querySelector("#intentInput"),
  pages: [...document.querySelectorAll("[data-page]")],
  pageTabs: [...document.querySelectorAll("[data-page-target]")],
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  pageStatus: document.querySelector("#pageStatus"),
  providerInput: document.querySelector("#providerInput"),
  modelInput: document.querySelector("#modelInput"),
  analyzeButton: document.querySelector("#analyzeButton"),
  runButton: document.querySelector("#runButton"),
  workspaceStatus: document.querySelector("#workspaceStatus"),
  policyStatus: document.querySelector("#policyStatus"),
  assetInput: document.querySelector("#assetInput"),
  timeframeInput: document.querySelector("#timeframeInput"),
  budgetInput: document.querySelector("#budgetInput"),
  perCallInput: document.querySelector("#perCallInput"),
  riskInput: document.querySelector("#riskInput"),
  executionInput: document.querySelector("#executionInput"),
  policyApprovedInput: document.querySelector("#policyApprovedInput"),
  strategyStatus: document.querySelector("#strategyStatus"),
  strategyName: document.querySelector("#strategyName"),
  strategyThesis: document.querySelector("#strategyThesis"),
  entryList: document.querySelector("#entryList"),
  riskList: document.querySelector("#riskList"),
  committeeStatus: document.querySelector("#committeeStatus"),
  transcriptStatus: document.querySelector("#transcriptStatus"),
  committeeTranscript: document.querySelector("#committeeTranscript"),
  strategyLane: document.querySelector("#strategyLane"),
  marketLane: document.querySelector("#marketLane"),
  riskLane: document.querySelector("#riskLane"),
  executionLane: document.querySelector("#executionLane"),
  paymentStatus: document.querySelector("#paymentStatus"),
  paymentList: document.querySelector("#paymentList"),
  x402Flow: document.querySelector("#x402Flow"),
  budgetFill: document.querySelector("#budgetFill"),
  budgetText: document.querySelector("#budgetText"),
  timeline: document.querySelector("#timeline"),
  loopStatus: document.querySelector("#loopStatus"),
  decisionBadge: document.querySelector("#decisionBadge"),
  decisionTitle: document.querySelector("#decisionTitle"),
  decisionReason: document.querySelector("#decisionReason"),
  signalScore: document.querySelector("#signalScore"),
  signalSummary: document.querySelector("#signalSummary"),
  llmProvider: document.querySelector("#llmProvider"),
  marketSource: document.querySelector("#marketSource"),
  auditHash: document.querySelector("#auditHash")
};

const state = {
  intent: null,
  policy: null,
  strategyDraft: null,
  plan: null,
  userApproval: null,
  running: false,
  activePage: "setup"
};

const PAGES = [
  { id: "setup", label: "Intent" },
  { id: "plan", label: "Agent Plan" },
  { id: "run", label: "Run" },
  { id: "decision", label: "Decision" }
];

const DEFAULT_MODELS = {
  openai: "gpt-5",
  deepseek: "deepseek-chat",
  claude: "claude-sonnet-4-5",
  glm: "glm-4.5",
  rule: "rule_based_fallback"
};

els.analyzeButton.addEventListener("click", analyzeIntent);
els.runButton.addEventListener("click", runStrategy);
els.policyApprovedInput.addEventListener("change", handleApprovalChange);
els.prevPageButton.addEventListener("click", () => movePage(-1));
els.nextPageButton.addEventListener("click", () => movePage(1));
for (const tab of els.pageTabs) {
  tab.addEventListener("click", () => showPage(tab.dataset.pageTarget));
}
els.providerInput.addEventListener("change", () => {
  els.modelInput.value = DEFAULT_MODELS[els.providerInput.value] ?? "";
});

for (const input of [els.assetInput, els.timeframeInput, els.budgetInput, els.perCallInput, els.riskInput, els.executionInput]) {
  input.addEventListener("input", () => {
    if (!state.intent) return;
    state.policy = buildPolicyFromControls();
    state.userApproval = null;
    els.policyApprovedInput.checked = false;
    renderPolicy(state.policy);
    updateRunAvailability();
  });
}

showPage("setup");

async function analyzeIntent() {
  setBusy(true, "Strategy Agent 正在解析用户目标");
  resetRunOutput();

  try {
    const intent = await postJson("/strategy/intent", {
      message: els.intentInput.value,
      modelConfig: getModelConfig()
    });
    state.intent = intent;

    if (intent.status === "needs_clarification" && intent.missingFields.length > 0) {
      els.workspaceStatus.textContent = intent.questions.join(" ");
    } else {
      els.workspaceStatus.textContent = "Strategy Agent 已解析目标";
    }

    const policyResponse = await postJson("/strategy/policy/draft", { intent });
    state.policy = policyResponse.policyDraft;
    applyPolicyToControls(state.policy);
    renderPolicy(state.policy);

    const strategyResponse = await postJson("/strategy/draft", {
      intent,
      policy: state.policy,
      modelConfig: getModelConfig()
    });
    state.strategyDraft = strategyResponse.strategyDraft;
    renderStrategyDraft(state.strategyDraft);

    state.plan = await postJson("/strategy/plan", {
      intent,
      policy: state.policy,
      modelConfig: getModelConfig()
    });
    renderPlan(state.plan);

    state.userApproval = null;
    els.policyApprovedInput.checked = false;
    updateRunAvailability();
    showPage("plan");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runStrategy() {
  if (state.running || !state.policy || !els.policyApprovedInput.checked) return;

  state.running = true;
  els.runButton.disabled = true;
  els.loopStatus.textContent = "RUNNING";
  els.timeline.innerHTML = "";
  els.committeeTranscript.innerHTML = "";
  els.transcriptStatus.textContent = "RUNNING";
  els.decisionBadge.textContent = "RUNNING";
  els.decisionTitle.textContent = "运行中";
  els.decisionReason.textContent = "Strategy Agent 正在执行已批准的策略计划。";
  showPage("run");

  try {
    const result = await postJson("/strategy/run", {
      message: els.intentInput.value,
      intent: state.intent,
      policy: buildPolicyFromControls(),
      strategyDraft: state.strategyDraft,
      approvalMode: "preapproved_budget",
      userApproval: state.userApproval,
      requireLlm: els.providerInput.value !== "rule",
      modelConfig: getModelConfig()
    });

    await renderRuntime(result);
    showPage("decision");
  } catch (error) {
    showError(error);
  } finally {
    state.running = false;
    updateRunAvailability();
  }
}

function showPage(pageId) {
  const nextPage = PAGES.some((page) => page.id === pageId) ? pageId : "setup";
  state.activePage = nextPage;

  for (const page of els.pages) {
    page.classList.toggle("is-active", page.dataset.page === nextPage);
  }

  for (const tab of els.pageTabs) {
    tab.classList.toggle("is-active", tab.dataset.pageTarget === nextPage);
  }

  const index = PAGES.findIndex((page) => page.id === nextPage);
  els.prevPageButton.disabled = index === 0;
  els.nextPageButton.disabled = index === PAGES.length - 1;
  els.pageStatus.textContent = `${PAGES[index].label} / ${index + 1} of ${PAGES.length}`;
}

function movePage(delta) {
  const currentIndex = PAGES.findIndex((page) => page.id === state.activePage);
  const nextIndex = Math.min(PAGES.length - 1, Math.max(0, currentIndex + delta));
  showPage(PAGES[nextIndex].id);
}

function renderPolicy(policy) {
  els.policyStatus.textContent = "DRAFT";
  els.budgetText.textContent = `总预算 ${tinybarToHbar(policy.dailyBudgetTinybar)} HBAR，单次上限 ${tinybarToHbar(policy.maxPaymentPerCallTinybar)} HBAR`;
  els.budgetFill.style.width = "0%";
}

function renderStrategyDraft(draft) {
  els.strategyStatus.textContent = "READY";
  els.strategyName.textContent = draft.name;
  els.strategyThesis.textContent = draft.thesis;
  renderList(els.entryList, draft.entryConditions);
  renderList(els.riskList, draft.riskControls);
}

function renderPlan(plan) {
  const calls = plan.agentPlan.plannedToolCalls;
  els.committeeStatus.textContent = calls.length > 0 ? "PLANNED" : "NO PAID CALL";
  els.strategyLane.textContent = `${plan.hypothesis.direction} ${plan.hypothesis.setup}，初始置信度 ${plan.hypothesis.initialConfidence}`;
  els.marketLane.textContent = describeAgentCall(calls.find((call) => call.service === "market-signal"));
  els.riskLane.textContent = describeAgentCall(calls.find((call) => call.service === "risk-challenge"));
  els.executionLane.textContent = "等待 Strategy Agent 最终决策";

  els.paymentStatus.textContent = calls.length > 0 ? "REVIEW REQUIRED" : "READY";
  els.paymentList.innerHTML = "";

  for (const call of calls) {
    const item = document.createElement("article");
    item.className = "payment-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(call.service)}</strong>
        <p>${escapeHtml(call.reason)}</p>
      </div>
      <span>${tinybarToHbar(call.quotedPriceTinybar)} HBAR</span>
    `;
    els.paymentList.append(item);
  }

  if (calls.length === 0) {
    els.paymentList.innerHTML = "<p class=\"empty-note\">当前策略证据不足或无需购买外部服务。</p>";
  }

  renderPaymentFlow("planned", {
    serviceCount: calls.length,
    totalQuotedTinybar: calls.reduce((sum, call) => sum + Number(call.quotedPriceTinybar ?? 0), 0)
  });
}

async function renderRuntime(result) {
  for (const event of result.timeline) {
    await wait(120);
    addTimelineEvent(event);
    applyRuntimeEvent(event, result);
  }

  els.loopStatus.textContent = "DONE";
  renderCommitteeTranscript(result.committeeTranscript ?? []);
  els.transcriptStatus.textContent = "DONE";
  els.decisionBadge.textContent = result.finalDecision;
  els.decisionTitle.textContent = result.finalDecision === "SIMULATED_BUY" ? "模拟买入" : result.finalDecision === "HOLD" ? "保持观察" : "不交易";
  els.decisionReason.textContent = result.reason;
  els.signalScore.textContent = result.evidence?.evidenceScore ?? "--";
  els.signalSummary.textContent = result.evidence?.contradictingEvidence?.[0] ?? result.evidence?.supportingEvidence?.[0] ?? "证据已合成";
  els.llmProvider.textContent = result.metrics?.llmProvider ?? result.hypothesis?.generatedBy ?? "unknown";
  els.marketSource.textContent = result.marketSource ?? result.evidence?.marketSignal?.source ?? "unknown";
  els.auditHash.textContent = result.audit?.messageHash ?? "not recorded";
  els.executionLane.textContent = result.executionProposal?.action ?? "NO ACTION";
  if (result.executionResult?.status) {
    els.executionLane.textContent = `${result.executionResult.status}: ${result.executionProposal?.action ?? "NO ACTION"}`;
  }

  const dailyBudget = Math.max(1, Number(result.policy.dailyBudgetTinybar));
  const spentRatio = Math.min(1, Math.max(0, result.budget.spentTinybar / dailyBudget));
  els.budgetFill.style.width = `${Math.round(spentRatio * 100)}%`;
  els.budgetText.textContent = `已使用 ${result.budget.spentHbar} HBAR，剩余 ${result.budget.remainingHbar} HBAR`;
}

function getModelConfig() {
  return {
    provider: els.providerInput.value,
    model: els.modelInput.value.trim() || DEFAULT_MODELS[els.providerInput.value]
  };
}

function applyRuntimeEvent(event, result) {
  if (event.stateStep === "generate_hypothesis") {
    els.strategyLane.textContent = `${event.output.direction} ${event.output.setup}，置信度 ${event.output.initialConfidence}`;
  }

  if (event.step === "payment_settled") {
    els.paymentStatus.textContent = "SETTLED";
    renderPaymentFlow("settled", event);
    if (event.service === "risk-challenge") {
      els.riskLane.textContent = `支付完成，交易 ${event.transactionId}`;
    } else {
      els.marketLane.textContent = `支付完成，交易 ${event.transactionId}`;
    }
  }

  if (event.step === "signal_delivered") {
    renderPaymentFlow("delivered", event);
    els.signalScore.textContent = event.signal.breakoutScore ?? result.evidence?.evidenceScore ?? "--";
    els.signalSummary.textContent = event.signal.summary ?? "市场信号已返回";
  }
}

function addTimelineEvent(event) {
  const item = document.createElement("li");
  const title = event.stateStep ?? event.step;
  const body = describeTimelineEvent(event);
  item.innerHTML = `
    <time>${new Date().toLocaleTimeString("zh-CN", { hour12: false })}</time>
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
  els.timeline.append(item);
}

function renderCommitteeTranscript(entries) {
  els.committeeTranscript.innerHTML = "";

  for (const entry of entries) {
    const item = document.createElement("li");
    item.innerHTML = `
      <span>${escapeHtml(entry.agent)}</span>
      <div>
        <strong>${escapeHtml(labelAction(entry.action))}</strong>
        <p>${escapeHtml(describeTranscriptEntry(entry))}</p>
      </div>
    `;
    els.committeeTranscript.append(item);
  }

  if (entries.length === 0) {
    els.committeeTranscript.innerHTML = "<li><span>Committee</span><div><strong>WAITING</strong><p>等待运行结果。</p></div></li>";
  }
}

function labelAction(action) {
  return String(action ?? "event").replaceAll("_", " ").toUpperCase();
}

function describeTranscriptEntry(entry) {
  if (entry.message) return entry.message;
  if (entry.summary) return entry.summary;
  if (entry.reason) return entry.reason;
  if (entry.action === "approve_payment") return `${entry.service} 付款通过，金额 ${tinybarToHbar(entry.amountTinybar)} HBAR`;
  if (entry.action === "reject_payment") return `${entry.service} 付款被拒绝：${entry.reasons?.join("；")}`;
  if (entry.blockingReasons?.length) return entry.blockingReasons.join("；");
  if (entry.service) return `${entry.service}，最高费用 ${tinybarToHbar(entry.maxFeeTinybar ?? 0)} HBAR`;
  return JSON.stringify(entry);
}

function describeTimelineEvent(event) {
  if (event.step === "payment_required") {
    renderPaymentFlow("required", event);
    return `${event.service} 报价 ${event.price}，${event.network} / ${event.asset}`;
  }
  if (event.step === "policy_check") {
    renderPaymentFlow("policy", event);
    return event.allowed ? `policy 通过，剩余 ${event.remainingBudget}` : event.reasons.join("；");
  }
  if (event.step === "payment_signed") {
    renderPaymentFlow("signed", event);
    return `payer ${event.payer} 已生成 X-PAYMENT，经由 ${event.facilitator}`;
  }
  if (event.step === "payment_settled") return `settled ${event.transactionId}`;
  if (event.step === "signal_delivered") return event.signal.summary ?? "信号返回";
  if (event.step === "audit_recorded") return event.audit.messageHash;
  if (event.stateStep) return summarizeOutput(event.output);
  return JSON.stringify(event);
}

function summarizeOutput(output) {
  if (!output || typeof output !== "object") return String(output);
  if (output.action) return `${output.action}: ${output.reason ?? ""}`;
  if (output.status && output.agent) return `${output.agent}: ${output.status}`;
  if (output.mode) return output.reason ?? output.mode;
  if (output.asset && output.regime) return `${output.asset} / ${output.regime}`;
  if (output.policyId) return `${output.policyId}`;
  return JSON.stringify(output).slice(0, 180);
}

function applyPolicyToControls(policy) {
  els.assetInput.value = policy.targetAsset;
  els.timeframeInput.value = policy.strategyIntent?.timeframe ?? "4h";
  els.budgetInput.value = tinybarToHbar(policy.dailyBudgetTinybar);
  els.perCallInput.value = tinybarToHbar(policy.maxPaymentPerCallTinybar);
  els.riskInput.value = policy.strategyIntent?.riskPreference ?? "conservative";
  els.executionInput.value = policy.executionMode;
}

function buildPolicyFromControls() {
  const intent = {
    ...(state.intent ?? {}),
    asset: els.assetInput.value.trim().toUpperCase(),
    timeframe: els.timeframeInput.value,
    riskPreference: els.riskInput.value,
    dailyResearchBudgetTinybar: hbarToTinybar(Number(els.budgetInput.value)),
    maxPaymentPerCallTinybar: hbarToTinybar(Number(els.perCallInput.value)),
    executionMode: els.executionInput.value
  };

  return {
    id: `policy_${intent.asset.toLowerCase()}_${intent.timeframe}_${intent.riskPreference}`,
    targetAsset: intent.asset,
    dailyBudgetTinybar: intent.dailyResearchBudgetTinybar,
    maxPaymentPerCallTinybar: intent.maxPaymentPerCallTinybar,
    allowedServices: intent.riskPreference === "aggressive" ? ["market-signal"] : ["market-signal", "risk-challenge"],
    serviceBudgetsTinybar: {
      "market-signal": Math.floor(intent.dailyResearchBudgetTinybar * 0.6),
      "risk-challenge": Math.floor(intent.dailyResearchBudgetTinybar * 0.3)
    },
    executionMode: "simulation",
    riskRules: [
      `${intent.riskPreference}_risk_profile`,
      "policy_guard_required_before_payment",
      "risk_guard_required_before_execution",
      "execution_agent_simulation_only"
    ],
    strategyIntent: intent
  };
}

function updateRunAvailability() {
  const canRun = Boolean(state.strategyDraft && state.policy && state.userApproval && els.policyApprovedInput.checked && !state.running);
  els.runButton.disabled = !canRun;
  els.policyStatus.textContent = state.userApproval ? "APPROVED" : state.policy ? "DRAFT" : "PENDING";
  if (state.userApproval && state.plan && !state.running) {
    els.paymentStatus.textContent = "APPROVED";
  } else if (state.plan && !state.running) {
    const calls = state.plan.agentPlan.plannedToolCalls;
    els.paymentStatus.textContent = calls.length > 0 ? "REVIEW REQUIRED" : "READY";
  }
}

async function handleApprovalChange() {
  if (!els.policyApprovedInput.checked) {
    state.userApproval = null;
    updateRunAvailability();
    return;
  }

  if (!state.policy) {
    els.policyApprovedInput.checked = false;
    updateRunAvailability();
    return;
  }

  try {
    els.paymentStatus.textContent = "APPROVING";
    state.userApproval = await postJson("/strategy/approval", {
      policy: buildPolicyFromControls(),
      intent: state.intent,
      strategyDraft: state.strategyDraft,
      plan: state.plan
    });
  } catch (error) {
    state.userApproval = null;
    els.policyApprovedInput.checked = false;
    showError(error);
  } finally {
    updateRunAvailability();
  }
}

function renderPaymentFlow(stage, details = {}) {
  const stageOrder = ["planned", "required", "policy", "signed", "settled", "delivered"];
  const activeIndex = Math.max(0, stageOrder.indexOf(stage));
  const items = [
    {
      id: "required",
      label: "HTTP 402",
      text: details.network
        ? `${details.service ?? "service"} asks ${details.price ?? ""} on ${details.network} / ${details.asset}`
        : "等待 gated service 返回报价"
    },
    {
      id: "policy",
      label: "Policy check",
      text: typeof details.allowed === "boolean"
        ? details.allowed ? `允许付款，剩余 ${details.remainingBudget}` : `拒绝付款：${details.reasons?.join("；")}`
        : "预算、单次上限、服务权限待检查"
    },
    {
      id: "signed",
      label: "X-PAYMENT",
      text: details.payer
        ? `${details.mode ?? "mock"} payer ${details.payer} -> ${details.facilitator}`
        : "等待 Agent 签名付款 payload"
    },
    {
      id: "settled",
      label: "Hedera settle",
      text: details.transactionId
        ? `tx ${details.transactionId}`
        : "等待 Blocky402 / Hedera testnet 结算"
    },
    {
      id: "delivered",
      label: "Result delivered",
      text: details.signal?.summary ?? "等待付费服务返回证据"
    }
  ];

  els.x402Flow.innerHTML = "";
  for (const item of items) {
    const itemIndex = stageOrder.indexOf(item.id);
    const row = document.createElement("li");
    row.className = itemIndex < activeIndex ? "is-done" : itemIndex === activeIndex ? "is-active" : "";
    row.innerHTML = `
      <strong>${escapeHtml(item.label)}</strong>
      <p>${escapeHtml(item.text)}</p>
    `;
    els.x402Flow.append(row);
  }
}

function setBusy(isBusy, text) {
  els.analyzeButton.disabled = isBusy;
  els.workspaceStatus.textContent = isBusy ? text : els.workspaceStatus.textContent;
}

function resetRunOutput() {
  els.timeline.innerHTML = "";
  els.committeeTranscript.innerHTML = "";
  renderPaymentFlow("planned");
  els.transcriptStatus.textContent = "WAITING";
  els.loopStatus.textContent = "READY";
  els.decisionBadge.textContent = "PENDING";
  els.decisionTitle.textContent = "等待运行";
  els.decisionReason.textContent = "批准 policy 后运行 Agent。";
  els.auditHash.textContent = "waiting";
  els.llmProvider.textContent = "waiting";
  els.marketSource.textContent = "waiting";
}

function showError(error) {
  els.workspaceStatus.textContent = error.message;
  els.loopStatus.textContent = "ERROR";
  els.decisionBadge.textContent = "FAILED";
  els.decisionTitle.textContent = "运行失败";
  els.decisionReason.textContent = error.message;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? `${url} failed`);
  }
  return payload;
}

function renderList(target, values) {
  target.innerHTML = "";
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    target.append(item);
  }
}

function describeAgentCall(call) {
  if (!call) return "未规划";
  return `${call.service}，报价 ${tinybarToHbar(call.quotedPriceTinybar)} HBAR`;
}

function hbarToTinybar(value) {
  return Math.round(Number(value) * 100_000_000);
}

function tinybarToHbar(value) {
  return Number(value) / 100_000_000;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const els = {
  intentInput: document.querySelector("#intentInput"),
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
  strategyLane: document.querySelector("#strategyLane"),
  marketLane: document.querySelector("#marketLane"),
  riskLane: document.querySelector("#riskLane"),
  executionLane: document.querySelector("#executionLane"),
  paymentStatus: document.querySelector("#paymentStatus"),
  paymentList: document.querySelector("#paymentList"),
  budgetFill: document.querySelector("#budgetFill"),
  budgetText: document.querySelector("#budgetText"),
  timeline: document.querySelector("#timeline"),
  loopStatus: document.querySelector("#loopStatus"),
  decisionBadge: document.querySelector("#decisionBadge"),
  decisionTitle: document.querySelector("#decisionTitle"),
  decisionReason: document.querySelector("#decisionReason"),
  signalScore: document.querySelector("#signalScore"),
  signalSummary: document.querySelector("#signalSummary"),
  auditHash: document.querySelector("#auditHash")
};

const state = {
  intent: null,
  policy: null,
  strategyDraft: null,
  plan: null,
  running: false
};

els.analyzeButton.addEventListener("click", analyzeIntent);
els.runButton.addEventListener("click", runStrategy);
els.policyApprovedInput.addEventListener("change", updateRunAvailability);

for (const input of [els.assetInput, els.timeframeInput, els.budgetInput, els.perCallInput, els.riskInput, els.executionInput]) {
  input.addEventListener("input", () => {
    if (!state.intent) return;
    state.policy = buildPolicyFromControls();
    renderPolicy(state.policy);
    updateRunAvailability();
  });
}

async function analyzeIntent() {
  setBusy(true, "解析用户目标");
  resetRunOutput();

  try {
    const intent = await postJson("/strategy/intent", { message: els.intentInput.value });
    state.intent = intent;

    if (intent.status === "needs_clarification" && intent.missingFields.length > 0) {
      els.workspaceStatus.textContent = intent.questions.join(" ");
    } else {
      els.workspaceStatus.textContent = "目标已解析";
    }

    const policyResponse = await postJson("/strategy/policy/draft", { intent });
    state.policy = policyResponse.policyDraft;
    applyPolicyToControls(state.policy);
    renderPolicy(state.policy);

    const strategyResponse = await postJson("/strategy/draft", {
      intent,
      policy: state.policy
    });
    state.strategyDraft = strategyResponse.strategyDraft;
    renderStrategyDraft(state.strategyDraft);

    state.plan = await postJson("/strategy/plan", {
      intent,
      policy: state.policy
    });
    renderPlan(state.plan);

    els.policyApprovedInput.checked = false;
    updateRunAvailability();
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
  els.decisionBadge.textContent = "RUNNING";
  els.decisionTitle.textContent = "运行中";
  els.decisionReason.textContent = "Strategy Agent 正在执行已批准的策略计划。";

  try {
    const result = await postJson("/strategy/run", {
      intent: state.intent,
      policy: buildPolicyFromControls(),
      strategyDraft: state.strategyDraft,
      approvalMode: "preapproved_budget"
    });

    await renderRuntime(result);
  } catch (error) {
    showError(error);
  } finally {
    state.running = false;
    updateRunAvailability();
  }
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

  els.paymentStatus.textContent = calls.length > 0 ? "REVIEW" : "SKIPPED";
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
}

async function renderRuntime(result) {
  for (const event of result.timeline) {
    await wait(120);
    addTimelineEvent(event);
    applyRuntimeEvent(event, result);
  }

  els.loopStatus.textContent = "DONE";
  els.decisionBadge.textContent = result.finalDecision;
  els.decisionTitle.textContent = result.finalDecision === "SIMULATED_BUY" ? "模拟买入" : result.finalDecision === "HOLD" ? "保持观察" : "不交易";
  els.decisionReason.textContent = result.reason;
  els.signalScore.textContent = result.evidence?.evidenceScore ?? "--";
  els.signalSummary.textContent = result.evidence?.contradictingEvidence?.[0] ?? result.evidence?.supportingEvidence?.[0] ?? "证据已合成";
  els.auditHash.textContent = result.audit?.messageHash ?? "not recorded";
  els.executionLane.textContent = result.executionProposal?.action ?? "NO ACTION";

  const spentRatio = result.budget.spentTinybar / result.policy.dailyBudgetTinybar;
  els.budgetFill.style.width = `${Math.round(spentRatio * 100)}%`;
  els.budgetText.textContent = `已使用 ${result.budget.spentHbar} HBAR，剩余 ${result.budget.remainingHbar} HBAR`;
}

function applyRuntimeEvent(event, result) {
  if (event.stateStep === "generate_hypothesis") {
    els.strategyLane.textContent = `${event.output.direction} ${event.output.setup}，置信度 ${event.output.initialConfidence}`;
  }

  if (event.step === "payment_settled") {
    els.paymentStatus.textContent = "SETTLED";
    els.marketLane.textContent = `支付完成，交易 ${event.transactionId}`;
  }

  if (event.step === "signal_delivered") {
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

function describeTimelineEvent(event) {
  if (event.step === "payment_required") return `${event.service} 报价 ${event.price}`;
  if (event.step === "policy_check") return event.allowed ? `policy 通过，剩余 ${event.remainingBudget}` : event.reasons.join("；");
  if (event.step === "payment_signed") return `payer ${event.payer} 已生成 X-PAYMENT`;
  if (event.step === "payment_settled") return `settled ${event.transactionId}`;
  if (event.step === "signal_delivered") return event.signal.summary ?? "信号返回";
  if (event.step === "audit_recorded") return event.audit.messageHash;
  if (event.stateStep) return summarizeOutput(event.output);
  return JSON.stringify(event);
}

function summarizeOutput(output) {
  if (!output || typeof output !== "object") return String(output);
  if (output.action) return `${output.action}: ${output.reason ?? ""}`;
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
  const canRun = Boolean(state.strategyDraft && state.policy && els.policyApprovedInput.checked && !state.running);
  els.runButton.disabled = !canRun;
  els.policyStatus.textContent = els.policyApprovedInput.checked ? "APPROVED" : state.policy ? "DRAFT" : "PENDING";
}

function setBusy(isBusy, text) {
  els.analyzeButton.disabled = isBusy;
  els.workspaceStatus.textContent = isBusy ? text : els.workspaceStatus.textContent;
}

function resetRunOutput() {
  els.timeline.innerHTML = "";
  els.loopStatus.textContent = "READY";
  els.decisionBadge.textContent = "PENDING";
  els.decisionTitle.textContent = "等待运行";
  els.decisionReason.textContent = "批准 policy 后运行 Agent。";
  els.auditHash.textContent = "waiting";
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

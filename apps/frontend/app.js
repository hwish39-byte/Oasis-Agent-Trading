const timeline = document.querySelector("#timeline");
const runButton = document.querySelector("#runButton");
const heroRunButton = document.querySelector("#heroRunButton");
const navRunButton = document.querySelector("#navRunButton");
const loopStatus = document.querySelector("#loopStatus");
const budgetFill = document.querySelector("#budgetFill");
const budgetText = document.querySelector("#budgetText");
const decisionBadge = document.querySelector("#decisionBadge");
const decisionTitle = document.querySelector("#decisionTitle");
const decisionReason = document.querySelector("#decisionReason");
const signalScore = document.querySelector("#signalScore");
const signalSummary = document.querySelector("#signalSummary");
const auditHash = document.querySelector("#auditHash");

const statusByStep = {
  strategy_candidate: "STRATEGY",
  payment_required: "402",
  policy_check: "POLICY",
  payment_signed: "SIGNING",
  payment_settled: "SETTLED",
  signal_delivered: "DELIVERED",
  audit_recorded: "AUDIT"
};

const viewByStep = {
  strategy_candidate: (event) => ({
    title: "Strategy Agent 提出候选",
    body: event.message
  }),
  payment_required: (event) => ({
    title: "Market Signal API 返回 402",
    body: `价格 ${event.price}，网络 ${event.network}，asset ${event.asset}，收款方 ${event.receiver}。`
  }),
  policy_check: (event) => ({
    title: event.allowed ? "用户策略检查通过" : "用户策略阻止付款",
    body: event.allowed
      ? `剩余预算 ${event.remainingBudget}，本次请求允许付款。`
      : event.reasons.join("；")
  }),
  payment_signed: (event) => ({
    title: "Agent 生成 X-PAYMENT",
    body: `payer ${event.payer} 使用 ${event.mode} payment payload，facilitator ${event.facilitator}。`
  }),
  payment_settled: (event) => ({
    title: "支付结算完成",
    body: `transaction id ${event.transactionId}，settled at ${event.settledAt}。`
  }),
  signal_delivered: (event) => ({
    title: "市场信号返回",
    body: `突破分 ${event.signal.breakoutScore}，confidence ${event.signal.confidence}，${event.signal.summary}`
  }),
  audit_recorded: (event) => ({
    title: "审计摘要记录",
    body: `${event.audit.hcsTopicId} / ${event.audit.messageHash}`
  })
};

const state = {
  running: false
};

for (const button of [runButton, heroRunButton, navRunButton]) {
  button.addEventListener("click", runDemo);
}

function resetUi() {
  timeline.innerHTML = "";
  loopStatus.textContent = "RUNNING";
  budgetFill.style.width = "0%";
  budgetText.textContent = "等待后端 Agent 返回 policy check";
  decisionBadge.textContent = "PENDING";
  decisionTitle.textContent = "运行中";
  decisionReason.textContent = "Agent 正在调用本地 demo runner。";
  signalScore.textContent = "--";
  signalSummary.textContent = "尚未购买市场信号。";
  auditHash.textContent = "mock-topic / waiting";
}

async function runDemo() {
  if (state.running) return;

  state.running = true;
  setButtonsDisabled(true);
  resetUi();
  document.querySelector("#replay").scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const response = await fetch("/demo/run", { method: "POST" });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message ?? "Demo API request failed");
    }

    await renderResult(result);
  } catch (error) {
    renderError(error);
  } finally {
    setButtonsDisabled(false);
    state.running = false;
  }
}

async function renderResult(result) {
  for (const event of result.timeline) {
    await wait(360);
    addTimelineEvent(event);
    loopStatus.textContent = statusByStep[event.step] ?? "EVENT";
    applyEventSideEffects(event, result);
  }

  loopStatus.textContent = "DONE";
  decisionBadge.textContent = result.finalDecision.replace("_", " ");
  decisionTitle.textContent = result.finalDecision === "SIMULATED_BUY" ? "模拟买入" : "拒绝加仓";
  decisionReason.textContent = result.reason;

  if (result.audit?.messageHash) {
    auditHash.textContent = result.audit.messageHash;
  }
}

function addTimelineEvent(event) {
  const item = document.createElement("li");
  const seconds = new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const view = viewByStep[event.step]?.(event) ?? {
    title: event.step,
    body: JSON.stringify(event)
  };

  item.innerHTML = `
    <time>${seconds}</time>
    <div>
      <strong>${escapeHtml(view.title)}</strong>
      <p>${escapeHtml(view.body)}</p>
    </div>
  `;
  timeline.append(item);
}

function applyEventSideEffects(event, result) {
  if (event.step === "policy_check") {
    budgetText.textContent = event.allowed
      ? "策略允许付款，等待 settlement"
      : "策略已阻止付款";
  }

  if (event.step === "payment_settled") {
    const spentRatio = result.budget.spentTinybar / result.policy.dailyBudgetTinybar;
    budgetFill.style.width = `${Math.round(spentRatio * 100)}%`;
    budgetText.textContent = `已使用 ${result.budget.spentHbar} HBAR，剩余 ${result.budget.remainingHbar} HBAR`;
    decisionReason.textContent = `支付已结算：${event.transactionId}`;
  }

  if (event.step === "signal_delivered") {
    signalScore.textContent = event.signal.breakoutScore;
    signalSummary.textContent = event.signal.summary;
  }

  if (event.step === "audit_recorded") {
    auditHash.textContent = event.audit.messageHash;
  }
}

function renderError(error) {
  loopStatus.textContent = "ERROR";
  decisionBadge.textContent = "FAILED";
  decisionTitle.textContent = "运行失败";
  decisionReason.textContent = error.message;
  addTimelineEvent({
    step: "error",
    message: error.message
  });
}

function setButtonsDisabled(disabled) {
  heroRunButton.disabled = disabled;
  navRunButton.disabled = disabled;
  runButton.disabled = disabled;

  heroRunButton.textContent = disabled ? "运行中..." : "运行 Agent →";
  navRunButton.textContent = disabled ? "运行中..." : "开始演示 →";
  runButton.textContent = disabled ? "运行中..." : "运行演示 →";
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

# AGENTS.md

## 项目概览

- 项目类型：Web3 黑客松项目；基于 Hedera x402 的 AI Agent 交易决策与按次付费服务 Demo。
- 主要语言：待项目脚手架确定。预期以 TypeScript / Node.js 为主，前端可能使用 React / Next.js，链上与支付逻辑围绕 Hedera SDK、x402、Blocky402 实现。
- 关键目录：
  - `apps/frontend/`：Oasis 前端界面，展示用户政策、预算、报价、支付状态和决策回放。
  - `apps/agent/`：Strategy Agent、Market Research Agent、Risk Agent、Execution Agent 的编排逻辑。
  - `apps/market-signal-api/`：x402-gated 市场信号服务。
  - `apps/risk-challenge-api/`：x402-gated 风险挑战服务。
  - `packages/hedera/`：Hedera 账户、HBAR 支付、Blocky402、HCS 审计相关工具。
  - `packages/policy/`：用户预算、单次服务限额、风险边界和权限检查。
  - `packages/shared/`：共享类型、常量和通用工具。
  - `data/snapshots/`：用于稳定演示的固定行情快照。
  - `docs/`：架构、支付流程、Demo 脚本和黑客松提交材料。
- 不要修改的目录：
  - `node_modules/`
  - `.next/`
  - `dist/`
  - `build/`
  - `coverage/`
  - 任何包含真实密钥、钱包助记词、私钥或生产凭据的本地文件。

## 常用命令

- 安装依赖：待项目脚手架确定后更新，例如 `pnpm install`。
- 本地开发：待项目脚手架确定后更新，例如 `pnpm dev`。
- 运行测试：待项目脚手架确定后更新，例如 `pnpm test`。
- 类型检查：待项目脚手架确定后更新，例如 `pnpm typecheck`。
- 格式化：待项目脚手架确定后更新，例如 `pnpm format`。

## 代码规范

- 遵循现有代码风格。
- 不做无关重构。
- 新增功能必须补充或更新测试。
- 优先保持 MVP 路径清晰：Agent 预算检查、x402 付款闭环、服务返回结果、HCS 审计记录。
- 前端展示要服务于 Demo 叙事：用户授权、服务报价、付款状态、Agent 协商过程、最终交易 / 不交易结论。
- Agent 不应绕过 User Policy；任何外部服务调用和付款都必须先检查剩余预算、单次服务限额和风险边界。
- Execution Agent 只能执行模拟订单；除非项目目标明确变更，不接入真实交易执行。

## 安全边界

- 不读取或提交 `.env`、密钥和私有凭据。
- 不执行删除生产数据的命令。
- 修改数据库迁移前先说明影响。
- 不提交 Hedera 私钥、助记词、真实 API key、交易所凭据或 facilitator 私有配置。
- 默认使用 Hedera testnet 和测试 HBAR；不要在未明确授权的情况下切换到 mainnet。
- 不引入真实下单逻辑，除非用户明确要求并重新定义安全策略。
- HCS 只写入审计摘要、哈希、交易 ID、策略版本和决策理由，不写入用户隐私数据或敏感凭据。

## 提交要求

- 说明改动文件。
- 说明验证命令和结果。
- 说明未验证项和剩余风险。
- 如果改动涉及支付流程，必须说明：
  - 使用的网络，例如 Hedera testnet。
  - 使用的资产，例如 HBAR。
  - 是否经过 Blocky402 facilitator。
  - 是否完成真实端到端付费请求。
  - 是否写入或模拟写入 HCS 审计记录。
- 如果改动涉及 Agent 行为，必须说明：
  - 哪些 Agent 被修改。
  - 预算和权限检查是否仍然生效。
  - 是否影响 Execution Agent 的模拟执行边界。

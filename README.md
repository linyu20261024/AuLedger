# AuLedger · 本地黄金价格趋势追踪与多账户盈亏工作台

基于 React + TypeScript + Tailwind CSS + TradingView Lightweight Charts v5 + Express 构建的黄金资产管理与分析工具，同时支持 **本地全栈运行（Node.js + 本地磁盘增量快照）** 与 **GitHub Pages 纯静态托管（浏览器直连行情 + localStorage 自动快照）**。

## 核心功能

- **实时行情与交互式图表**：聚合国际现货金价（COMEX `GC=F`）与 `USD/CNY` 汇率折算国内 `Au99.99` 克价，支持分时/日线/多周期 K 线与面积图、MA5/20/60 均线、持仓均价参考线与买卖点标注。
- **多账户盈亏核算引擎**：支持 **积存金**、**实物黄金（金条/首饰）** 与 **黄金 ETF**，可独立配置纯度、工费率与回收折价，支持 **移动加权平均法** 与 **先进先出法（FIFO）**、XIRR 年化收益核算。
- **历史价格回测引擎**：支持定期定额定投（DCA）、均线偏离智能定投、一次性买入持有、回撤加仓波段止盈及同周期基准对比。
- **多维度分析报告**：历史持仓净值重演曲线、摩擦成本（工费+回收折价）占比诊断、价格区间分位、月度涨跌与现金流矩阵，支持导出 `.md` 分析报告与 `.csv` 交易明细。
- **自动快照备份机制**：每次账户或交易变动自动留存增量快照，支持一键回滚、手动打标签快照与完整 JSON 导入/导出。

## 目录结构

```text
├── .github/workflows/
│   └── deploy-pages.yml         # GitHub Pages 自动构建与部署工作流
├── server.ts                    # 本地 Express 服务（行情代理 + ./data/ 持久化与滚动快照）
├── src/
│   ├── App.tsx                  # 主工作台外壳与全局状态管理
│   ├── types/gold.ts            # 领域模型类型定义
│   ├── data/seedLedger.ts       # 初始示例账本数据
│   ├── utils/
│   │   ├── pnlEngine.ts         # 多账户 FIFO / 加权平均盈亏与 XIRR 计算引擎
│   │   ├── backtestEngine.ts    # 历史策略回测引擎
│   │   ├── marketClient.ts      # 本地 API / 静态托管双模行情与备份适配层
│   │   └── formatters.ts        # 金额、克重、涨跌配色格式化工具
│   └── components/
│       ├── GoldPriceChart.tsx   # TradingView Lightweight Charts v5 主图组件
│       ├── AccountsAndLedgerView.tsx
│       ├── BacktestView.tsx
│       ├── AnalyticsReportView.tsx
│       ├── BackupAndSettingsView.tsx
│       ├── TransactionModal.tsx
│       └── AccountModal.tsx
├── package.json
└── vite.config.ts
```

## 本地运行（完整全栈模式，含磁盘自动备份）

```bash
npm install
npm run dev
# 访问 http://localhost:3000
```

生产环境启动：

```bash
npm run build
npm start
```

> 本地运行时，账本与自动快照保存在 `./data/ledger.json` 与 `./data/backups/` 目录（已在 `.gitignore` 中排除，不会泄露个人资产数据至 Git 仓库）。

## GitHub Pages 静态部署

仓库已内置 `.github/workflows/deploy-pages.yml`。推送至 `main` 分支并在 GitHub 仓库 `Settings -> Pages -> Source` 选择 **GitHub Actions** 后，即可自动构建并发布静态页面。在静态页面模式下，系统会自动切换至浏览器直连行情与 `localStorage` 增量快照备份模式。

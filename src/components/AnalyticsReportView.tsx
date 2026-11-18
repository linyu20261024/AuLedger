import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type Time,
} from 'lightweight-charts';
import { Download } from 'lucide-react';
import type {
  ColorConvention,
  GoldAccount,
  GoldTransaction,
  PortfolioSummary,
  PriceBar,
  ThemeMode,
} from '../types/gold';
import {
  buildPortfolioTimeline,
  computeMonthlyStats,
} from '../utils/pnlEngine';
import { fetchHistoryClient } from '../utils/marketClient';
import {
  formatCny,
  formatGrams,
  formatSignedCny,
  formatSignedPct,
  getTrendTextClass,
} from '../utils/formatters';

interface AnalyticsReportViewProps {
  summary: PortfolioSummary;
  accounts: GoldAccount[];
  transactions: GoldTransaction[];
  selectedAccountId: string | 'all';
  onSelectAccount: (id: string | 'all') => void;
  spotCnyPerGram: number;
  theme: ThemeMode;
  colorConvention: ColorConvention;
  sgePremiumCny: number;
}

export function AnalyticsReportView({
  summary,
  accounts,
  transactions,
  selectedAccountId,
  onSelectAccount,
  spotCnyPerGram,
  theme,
  colorConvention,
  sgePremiumCny,
}: AnalyticsReportViewProps) {
  const [historyRange, setHistoryRange] = useState<'1Y' | '3Y'>('1Y');
  const [bars, setBars] = useState<PriceBar[]>([]);
  const [loading, setLoading] = useState(true);
  const equityChartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHistoryClient(historyRange, sgePremiumCny)
      .then((data) => {
        if (!cancelled) setBars(data.bars);
      })
      .catch(() => {
        if (!cancelled) setBars([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [historyRange, sgePremiumCny]);

  const timeline = useMemo(
    () => buildPortfolioTimeline(bars, accounts, transactions, selectedAccountId),
    [bars, accounts, transactions, selectedAccountId]
  );

  const monthlyStats = useMemo(
    () => computeMonthlyStats(bars, transactions, selectedAccountId, accounts),
    [bars, transactions, selectedAccountId, accounts]
  );

  // Fee & spread erosion diagnostics
  const diagnostics = useMemo(() => {
    const filteredIds =
      selectedAccountId === 'all'
        ? new Set(accounts.map((a) => a.id))
        : new Set([selectedAccountId]);

    const txs = transactions.filter((t) => filteredIds.has(t.accountId));
    const buyTxs = txs.filter((t) => t.side === 'buy');
    const sellTxs = txs.filter((t) => t.side === 'sell');

    const totalFees = txs.reduce((acc, t) => acc + t.feeCny, 0);
    const spreadDiscountTotal = summary.totalMarketValueCny - summary.totalNetBuybackValueCny;
    const totalFriction = totalFees + spreadDiscountTotal;

    const prices = bars.map((b) => b.close);
    const minPrice = prices.length > 0 ? Math.min(...prices) : spotCnyPerGram;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : spotCnyPerGram;
    const currentPercentile =
      maxPrice > minPrice
        ? ((spotCnyPerGram - minPrice) / (maxPrice - minPrice)) * 100
        : 50;

    const avgCostPercentile =
      maxPrice > minPrice && summary.weightedAvgCostCny > 0
        ? ((summary.weightedAvgCostCny - minPrice) / (maxPrice - minPrice)) * 100
        : null;

    return {
      buyCount: buyTxs.length,
      sellCount: sellTxs.length,
      totalFees,
      spreadDiscountTotal,
      totalFriction,
      frictionPctOfCost:
        summary.totalBuyCostCny > 0 ? (totalFriction / summary.totalBuyCostCny) * 100 : 0,
      minPrice,
      maxPrice,
      currentPercentile,
      avgCostPercentile,
    };
  }, [accounts, transactions, selectedAccountId, summary, bars, spotCnyPerGram]);

  useEffect(() => {
    const el = equityChartRef.current;
    if (!el || timeline.length === 0) return;

    const isDark = theme === 'dark';
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 310,
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#111622' : '#FFFFFF' },
        textColor: isDark ? '#94A3B8' : '#64748B',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.05)' },
        horzLines: { color: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.05)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)',
      },
      timeScale: {
        borderColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)',
      },
    });

    const marketSeries = chart.addSeries(AreaSeries, {
      lineColor: '#D97706',
      topColor: isDark ? 'rgba(245, 158, 11, 0.25)' : 'rgba(217, 119, 6, 0.18)',
      bottomColor: isDark ? 'rgba(245, 158, 11, 0.01)' : 'rgba(217, 119, 6, 0.01)',
      lineWidth: 2,
      title: '持仓变现净值',
    });
    marketSeries.setData(
      timeline.map((p) => ({
        time: p.date as Time,
        value: Number(p.marketValueCny.toFixed(2)),
      }))
    );

    const investedSeries = chart.addSeries(LineSeries, {
      color: isDark ? '#60A5FA' : '#2563EB',
      lineWidth: 2,
      lineStyle: 2,
      title: '净投入本金',
    });
    investedSeries.setData(
      timeline.map((p) => ({
        time: p.date as Time,
        value: Number(p.netInvestedCny.toFixed(2)),
      }))
    );

    chart.timeScale().fitContent();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
        }
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [timeline, theme]);

  const handleExportReport = () => {
    const today = new Date().toISOString().slice(0, 10);
    const lines = [
      `# 黄金资产多维度分析报告 (${today})`,
      '',
      `## 1. 组合汇总 (${selectedAccountId === 'all' ? '全部账户' : accounts.find((a) => a.id === selectedAccountId)?.name ?? ''})`,
      `- 当前参考金价 (Au99.99): ${formatCny(spotCnyPerGram)}/g`,
      `- 持仓总克重: ${formatGrams(summary.totalHoldingGrams)} (折合纯金 ${formatGrams(summary.totalPureGrams)})`,
      `- 持仓加权均价: ${formatCny(summary.weightedAvgCostCny)}/g`,
      `- 变现净值: ${formatCny(summary.totalNetBuybackValueCny)} (牌价市值 ${formatCny(summary.totalMarketValueCny)})`,
      `- 浮动盈亏: ${formatSignedCny(summary.totalUnrealizedPnlCny)} (${formatSignedPct(summary.totalUnrealizedPnlPct)})`,
      `- 已落袋盈亏: ${formatSignedCny(summary.totalRealizedPnlCny)}`,
      `- 累计总盈亏: ${formatSignedCny(summary.totalPnlCny)} (${formatSignedPct(summary.totalReturnPct)})`,
      `- 交易工费及手续费: ${formatCny(diagnostics.totalFees)} · 实物回收折价影响: ${formatCny(diagnostics.spreadDiscountTotal)}`,
      '',
      '## 2. 分账户明细',
      '| 账户 | 类别 | 持仓(g) | 均价(¥/g) | 变现净值(¥) | 总盈亏(¥) | 收益率 |',
      '|---|---|---:|---:|---:|---:|---:|',
      ...summary.accountPnLs.map(
        (a) =>
          `| ${a.account.name} | ${a.account.type} | ${a.holdingGrams.toFixed(2)} | ${a.avgCostPerGram.toFixed(2)} | ${a.netBuybackValueCny.toFixed(2)} | ${a.totalPnlCny.toFixed(2)} | ${a.totalReturnPct.toFixed(2)}% |`
      ),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gold-analytics-report-${today}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const typeRows = Object.values(summary.byType).filter((b) => b.accountCount > 0 || b.holdingGrams > 0);

  return (
    <div className="space-y-6">
      {/* Report Toolbar */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            多维度数据分析报告
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            资产结构归因、历史持仓净值重演、手续费/回收折价损耗及月度行情统计
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedAccountId}
            onChange={(e) => onSelectAccount(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            <option value="all">全账户汇总视角</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-0.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
            {(['1Y', '3Y'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setHistoryRange(r)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                  historyRange === r
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {r === '1Y' ? '近1年' : '近3年'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            导出分析报告 (.md)
          </button>
        </div>
      </section>

      {/* Historical Portfolio Net Worth Curve + Asset Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        <section className="xl:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                持仓市值与净投入本金历史重演曲线
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                根据每笔买入/卖出日期与历史收盘金价逐日还原组合净值变动
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono-tabular">
              <span className="text-amber-600">持仓变现净值</span>
              <span className="text-blue-600 dark:text-blue-400">累计净投入本金</span>
            </div>
          </div>

          <div className="mt-3 h-[310px] w-full">
            {loading ? (
              <div className="w-full h-full rounded-lg bg-slate-100 dark:bg-slate-800/40 animate-pulse flex items-center justify-center text-xs text-slate-500">
                正在重构历史持仓净值...
              </div>
            ) : timeline.length === 0 ? (
              <div className="w-full h-full rounded-lg border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-xs text-slate-500">
                当前时间区间内暂无历史交易记录可用于重演
              </div>
            ) : (
              <div ref={equityChartRef} className="w-full h-full" />
            )}
          </div>
        </section>

        {/* Right: Allocation & Cost Erosion */}
        <section className="xl:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 flex flex-col justify-between space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">
              资产类别结构与盈亏贡献
            </h3>

            <div className="mt-4 space-y-4">
              {typeRows.length === 0 ? (
                <p className="text-xs text-slate-500">暂无持仓数据</p>
              ) : (
                typeRows.map((bucket) => (
                  <div key={bucket.type} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {bucket.label} ({bucket.accountCount}账户)
                      </span>
                      <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                        {formatGrams(bucket.holdingGrams)} · {bucket.sharePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-600"
                        style={{ width: `${Math.min(100, Math.max(2, bucket.sharePct))}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                      <span>净值 {formatCny(bucket.netBuybackValueCny, 0)}</span>
                      <span className={getTrendTextClass(bucket.totalPnlCny, colorConvention)}>
                        总盈亏 {formatSignedCny(bucket.totalPnlCny, 0)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-xs">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
              摩擦成本与价格分位诊断
            </h4>
            <div className="flex items-center justify-between font-mono-tabular">
              <span className="text-slate-500 dark:text-slate-400">累计工费/交易手续费</span>
              <span className="text-slate-900 dark:text-slate-100">{formatCny(diagnostics.totalFees)}</span>
            </div>
            <div className="flex items-center justify-between font-mono-tabular">
              <span className="text-slate-500 dark:text-slate-400">回收折价价差预估</span>
              <span className="text-slate-900 dark:text-slate-100">
                {formatCny(diagnostics.spreadDiscountTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between font-mono-tabular">
              <span className="text-slate-500 dark:text-slate-400">摩擦成本占总投入比例</span>
              <span className="text-amber-700 dark:text-amber-400 font-semibold">
                {diagnostics.frictionPctOfCost.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center justify-between font-mono-tabular pt-1 border-t border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500 dark:text-slate-400">
                当前金价处于{historyRange}区间分位
              </span>
              <span className="text-slate-900 dark:text-slate-100 font-semibold">
                {diagnostics.currentPercentile.toFixed(1)}%
              </span>
            </div>
            {diagnostics.avgCostPercentile !== null && (
              <div className="flex items-center justify-between font-mono-tabular">
                <span className="text-slate-500 dark:text-slate-400">您的持仓均价处于区间分位</span>
                <span className="text-blue-700 dark:text-blue-400 font-semibold">
                  {diagnostics.avgCostPercentile.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Monthly Gold Performance & User Cashflow Matrix */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
        <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            月度金价涨跌幅与交易节奏矩阵
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            复盘每个自然月金价表现与您的建仓/减仓克重分布
          </p>
        </div>

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-3">月份</th>
                <th className="py-2 px-3 text-right">月初开盘</th>
                <th className="py-2 px-3 text-right">月末收盘</th>
                <th className="py-2 px-3 text-right">月度涨跌幅</th>
                <th className="py-2 px-3 text-right">当月买入</th>
                <th className="py-2 px-3 text-right">当月卖出</th>
                <th className="py-2 pl-3 text-right">当月净现金流</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono-tabular">
              {monthlyStats
                .slice()
                .reverse()
                .slice(0, 14)
                .map((m) => (
                  <tr key={m.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-slate-100">
                      {m.month}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                      {formatCny(m.startPriceCny)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-900 dark:text-slate-100">
                      {formatCny(m.endPriceCny)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-semibold ${getTrendTextClass(
                        m.priceChangePct,
                        colorConvention
                      )}`}
                    >
                      {formatSignedPct(m.priceChangePct)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-amber-700 dark:text-amber-400">
                      {m.buyGrams > 0 ? `+${formatGrams(m.buyGrams)}` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-blue-700 dark:text-blue-400">
                      {m.sellGrams > 0 ? `-${formatGrams(m.sellGrams)}` : '—'}
                    </td>
                    <td className="py-2.5 pl-3 text-right text-slate-700 dark:text-slate-300">
                      {Math.abs(m.netFlowCny) > 0.01 ? formatCny(m.netFlowCny, 0) : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

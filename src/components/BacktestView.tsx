import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type Time,
} from 'lightweight-charts';
import { Play } from 'lucide-react';
import type {
  BacktestConfig,
  BacktestStrategyType,
  ColorConvention,
  PriceBar,
  ThemeMode,
} from '../types/gold';
import { STRATEGY_LABELS, runGoldBacktest } from '../utils/backtestEngine';
import { fetchHistoryClient } from '../utils/marketClient';
import {
  formatCny,
  formatGrams,
  formatSignedCny,
  formatSignedPct,
  getTrendTextClass,
} from '../utils/formatters';

interface BacktestViewProps {
  theme: ThemeMode;
  colorConvention: ColorConvention;
  sgePremiumCny: number;
}

export function BacktestView({
  theme,
  colorConvention,
  sgePremiumCny,
}: BacktestViewProps) {
  const [config, setConfig] = useState<BacktestConfig>({
    strategy: 'smart_ma',
    range: '3Y',
    initialCapitalCny: 10000,
    periodicAmountCny: 2000,
    frequency: 'monthly',
    feeRatePct: 0.3,
    maPeriod: 20,
    dipThresholdPct: 2.0,
    dipMultiplier: 2.0,
    takeProfitPct: 8.0,
  });

  const [bars, setBars] = useState<PriceBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceLabel, setSourceLabel] = useState('');
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHistoryClient(config.range, sgePremiumCny)
      .then((data) => {
        if (cancelled) return;
        setBars(data.bars);
        setSourceLabel(data.source);
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
  }, [config.range, sgePremiumCny]);

  const primaryResult = useMemo(() => runGoldBacktest(bars, config), [bars, config]);

  // Benchmark comparisons over the exact same window
  const dcaBenchmark = useMemo(
    () =>
      runGoldBacktest(bars, {
        ...config,
        strategy: 'dca',
      }),
    [bars, config]
  );

  const lumpSumBenchmark = useMemo(
    () =>
      runGoldBacktest(bars, {
        ...config,
        strategy: 'lump_sum',
        initialCapitalCny: Math.max(config.initialCapitalCny, primaryResult.totalInvestedCny),
      }),
    [bars, config, primaryResult.totalInvestedCny]
  );

  useEffect(() => {
    const el = chartRef.current;
    if (!el || primaryResult.points.length === 0) return;

    const isDark = theme === 'dark';
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 340,
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

    const valueSeries = chart.addSeries(AreaSeries, {
      lineColor: '#D97706',
      topColor: isDark ? 'rgba(245, 158, 11, 0.28)' : 'rgba(217, 119, 6, 0.2)',
      bottomColor: isDark ? 'rgba(245, 158, 11, 0.01)' : 'rgba(217, 119, 6, 0.01)',
      lineWidth: 2,
      title: '策略总资产 (¥)',
    });
    valueSeries.setData(
      primaryResult.points.map((p) => ({
        time: p.date as Time,
        value: p.portfolioValueCny,
      }))
    );

    const costSeries = chart.addSeries(LineSeries, {
      color: isDark ? '#60A5FA' : '#2563EB',
      lineWidth: 2,
      lineStyle: 2,
      title: '累计投入本金 (¥)',
    });
    costSeries.setData(
      primaryResult.points.map((p) => ({
        time: p.date as Time,
        value: p.investedCny,
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
  }, [primaryResult, theme]);

  const tradeEvents = useMemo(
    () => primaryResult.points.filter((p) => Boolean(p.action)).slice(-20).reverse(),
    [primaryResult.points]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Strategy Parameters */}
        <section className="xl:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                历史价格回测引擎
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                基于真实金价走势检验定投、均线加仓与波段策略
              </p>
            </div>
            <Play className="w-4 h-4 text-amber-600" />
          </div>

          {/* Strategy selector */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              回测策略模型
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(STRATEGY_LABELS) as BacktestStrategyType[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, strategy: key }))}
                  className={`px-2.5 py-2 text-xs font-medium rounded-lg border text-left transition-colors cursor-pointer ${
                    config.strategy === key
                      ? 'border-amber-600 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {STRATEGY_LABELS[key]}
                </button>
              ))}
            </div>
          </div>

          {/* Range */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              回测时间跨度
            </label>
            <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
              {(['6M', '1Y', '3Y', '5Y'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, range: r }))}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    config.range === r
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {r === '6M' ? '近6个月' : r === '1Y' ? '近1年' : r === '3Y' ? '近3年' : '近5年'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                初始建仓 (¥)
              </label>
              <input
                type="number"
                min="0"
                step="1000"
                value={config.initialCapitalCny}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, initialCapitalCny: Math.max(0, Number(e.target.value)) }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>

            {config.strategy !== 'lump_sum' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  每期定投金额 (¥)
                </label>
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={config.periodicAmountCny}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      periodicAmountCny: Math.max(0, Number(e.target.value)),
                    }))
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {config.strategy !== 'lump_sum' && config.strategy !== 'dip_grid' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  定投频率
                </label>
                <select
                  value={config.frequency}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      frequency: e.target.value as BacktestConfig['frequency'],
                    }))
                  }
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  <option value="weekly">每周一次</option>
                  <option value="biweekly">每两周一次</option>
                  <option value="monthly">每月一次</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                综合费率 (%)
              </label>
              <input
                type="number"
                min="0"
                step="0.05"
                value={config.feeRatePct}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, feeRatePct: Math.max(0, Number(e.target.value)) }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {(config.strategy === 'smart_ma' || config.strategy === 'dip_grid') && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3">
              {config.strategy === 'smart_ma' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    参考均线 (日)
                  </label>
                  <select
                    value={config.maPeriod}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, maPeriod: Number(e.target.value) }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    <option value={10}>MA10</option>
                    <option value={20}>MA20</option>
                    <option value={60}>MA60</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  低估/回调阈值 (%)
                </label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={config.dipThresholdPct}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      dipThresholdPct: Math.max(0.5, Number(e.target.value)),
                    }))
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  逢低加倍系数 (x)
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.5"
                  value={config.dipMultiplier}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      dipMultiplier: Math.max(1, Number(e.target.value)),
                    }))
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>

              {config.strategy === 'dip_grid' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    波段止盈阈值 (%)
                  </label>
                  <input
                    type="number"
                    min="2"
                    step="1"
                    value={config.takeProfitPct}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        takeProfitPct: Math.max(1, Number(e.target.value)),
                      }))
                    }
                    className="w-full px-3 py-1.5 text-xs font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>
          )}

          <div className="pt-2 text-[11px] text-slate-500 dark:text-slate-400">
            数据区间: {primaryResult.startDate} ~ {primaryResult.endDate} · {sourceLabel}
          </div>
        </section>

        {/* Right: Backtest Results & Equity Curve */}
        <div className="xl:col-span-8 space-y-6">
          {/* 4-column Summary Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">期末总资产 / 投入</div>
              <div className="mt-1.5 text-lg font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
                {formatCny(primaryResult.finalValueCny, 0)}
              </div>
              <div className="mt-0.5 text-[11px] font-mono-tabular text-slate-400">
                累计投入 {formatCny(primaryResult.totalInvestedCny, 0)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">累计收益 / 收益率</div>
              <div
                className={`mt-1.5 text-lg font-semibold font-mono-tabular ${getTrendTextClass(
                  primaryResult.totalProfitCny,
                  colorConvention
                )}`}
              >
                {formatSignedCny(primaryResult.totalProfitCny, 0)}
              </div>
              <div
                className={`mt-0.5 text-[11px] font-mono-tabular ${getTrendTextClass(
                  primaryResult.totalReturnPct,
                  colorConvention
                )}`}
              >
                累计 {formatSignedPct(primaryResult.totalReturnPct)} · 年化{' '}
                {formatSignedPct(primaryResult.annualizedReturnPct)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">持有克重 / 平均成本</div>
              <div className="mt-1.5 text-lg font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
                {formatGrams(primaryResult.totalGrams)}
              </div>
              <div className="mt-0.5 text-[11px] font-mono-tabular text-slate-400">
                均价 {formatCny(primaryResult.avgAcquisitionCostCny)} vs 现价{' '}
                {formatCny(primaryResult.finalPriceCny)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">最大净值回撤 / 成交</div>
              <div className="mt-1.5 text-lg font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
                {primaryResult.maxDrawdownPct.toFixed(2)}%
              </div>
              <div className="mt-0.5 text-[11px] font-mono-tabular text-slate-400">
                共触发 {primaryResult.tradeCount} 次买卖
              </div>
            </div>
          </div>

          {/* Equity Curve Chart */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  策略资金曲线与累计投入成本对照
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  橙色面积代表实时资产市值，蓝色虚线代表累计本金投入
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono-tabular">
                <span className="text-amber-600">策略总资产</span>
                <span className="text-blue-600 dark:text-blue-400">累计本金</span>
              </div>
            </div>

            <div className="mt-3 h-[340px] w-full">
              {loading ? (
                <div className="w-full h-full rounded-lg bg-slate-100 dark:bg-slate-800/40 animate-pulse flex items-center justify-center text-xs text-slate-500">
                  正在拉取回测历史金价...
                </div>
              ) : (
                <div ref={chartRef} className="w-full h-full" />
              )}
            </div>
          </section>

          {/* Strategy Benchmark Matrix */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">
              同周期策略横向对比（基准参考）
            </h3>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3">策略模型</th>
                    <th className="py-2 px-3 text-right">累计本金</th>
                    <th className="py-2 px-3 text-right">期末市值</th>
                    <th className="py-2 px-3 text-right">持仓均价</th>
                    <th className="py-2 px-3 text-right">累计收益率</th>
                    <th className="py-2 px-3 text-right">年化收益</th>
                    <th className="py-2 pl-3 text-right">最大回撤</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono-tabular">
                  {[
                    { label: `${primaryResult.strategyLabel} (当前)`, res: primaryResult, highlight: true },
                    { label: '标准定期定额 (对照)', res: dcaBenchmark, highlight: false },
                    { label: '期初一次性买入持有 (对照)', res: lumpSumBenchmark, highlight: false },
                  ].map((row, idx) => (
                    <tr
                      key={idx}
                      className={row.highlight ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}
                    >
                      <td className="py-2.5 pr-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                        {row.label}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                        {formatCny(row.res.totalInvestedCny, 0)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                        {formatCny(row.res.finalValueCny, 0)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                        {formatCny(row.res.avgAcquisitionCostCny)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${getTrendTextClass(
                          row.res.totalReturnPct,
                          colorConvention
                        )}`}
                      >
                        {formatSignedPct(row.res.totalReturnPct)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right ${getTrendTextClass(
                          row.res.annualizedReturnPct,
                          colorConvention
                        )}`}
                      >
                        {formatSignedPct(row.res.annualizedReturnPct)}
                      </td>
                      <td className="py-2.5 pl-3 text-right text-slate-600 dark:text-slate-400">
                        {row.res.maxDrawdownPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {tradeEvents.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  最近 {tradeEvents.length} 次策略调仓/定投触发记录
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] font-mono-tabular">
                  {tradeEvents.slice(0, 8).map((ev) => (
                    <div
                      key={ev.date}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex items-center justify-between"
                    >
                      <span className="text-slate-500">{ev.date}</span>
                      <span
                        className={
                          ev.action === 'take_profit'
                            ? 'text-blue-600 dark:text-blue-400'
                            : ev.action === 'dip_buy'
                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                            : 'text-slate-700 dark:text-slate-300'
                        }
                      >
                        {ev.action === 'take_profit'
                          ? '止盈'
                          : ev.action === 'dip_buy'
                          ? '加倍买'
                          : '定投'}{' '}
                        @{formatCny(ev.priceCny, 1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

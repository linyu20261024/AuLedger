import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { SlidersHorizontal } from 'lucide-react';
import type {
  ColorConvention,
  GoldTransaction,
  PriceBar,
  ThemeMode,
} from '../types/gold';
import { computeMovingAverage } from '../utils/backtestEngine';
import { formatCny, formatSignedPct, formatUsd, getTrendChartColors, getTrendTextClass } from '../utils/formatters';

export type ChartRange = '1D' | '1W' | '1M' | '3M' | '1Y' | '3Y' | '5Y';
export type ChartStyle = 'area' | 'candle';
export type PriceUnit = 'cny' | 'usd';

interface GoldPriceChartProps {
  bars: PriceBar[];
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  loading: boolean;
  transactions: GoldTransaction[];
  avgCostCny: number;
  theme: ThemeMode;
  colorConvention: ColorConvention;
  sourceLabel: string;
  isLive: boolean;
}

const RANGES: Array<{ key: ChartRange; label: string }> = [
  { key: '1D', label: '分时' },
  { key: '1W', label: '1周' },
  { key: '1M', label: '1月' },
  { key: '3M', label: '3月' },
  { key: '1Y', label: '1年' },
  { key: '3Y', label: '3年' },
  { key: '5Y', label: '5年' },
];

export function GoldPriceChart({
  bars,
  range,
  onRangeChange,
  loading,
  transactions,
  avgCostCny,
  theme,
  colorConvention,
  sourceLabel,
  isLive,
}: GoldPriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [chartStyle, setChartStyle] = useState<ChartStyle>('area');
  const [unit, setUnit] = useState<PriceUnit>('cny');
  const [showMA, setShowMA] = useState(true);
  const [showCostLine, setShowCostLine] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [hoveredBar, setHoveredBar] = useState<PriceBar | null>(null);

  const isIntraday = range === '1D' || range === '1W';
  const useUsd = unit === 'usd';

  const barByTimeKey = useMemo(() => {
    const map = new Map<string | number, PriceBar>();
    for (const b of bars) {
      const key = isIntraday ? b.timestamp : b.time.slice(0, 10);
      map.set(key, b);
    }
    return map;
  }, [bars, isIntraday]);

  const txByDate = useMemo(() => {
    const map = new Map<string, GoldTransaction[]>();
    for (const tx of transactions) {
      const list = map.get(tx.date) ?? [];
      list.push(tx);
      map.set(tx.date, list);
    }
    return map;
  }, [transactions]);

  const activeBar = hoveredBar ?? (bars.length > 0 ? bars[bars.length - 1] : null);
  const firstBar = bars.length > 0 ? bars[0] : null;

  const periodReturnPct = useMemo(() => {
    if (!firstBar || !activeBar) return 0;
    const start = useUsd ? firstBar.openUsd : firstBar.open;
    const end = useUsd ? activeBar.closeUsd : activeBar.close;
    return start > 0 ? ((end - start) / start) * 100 : 0;
  }, [firstBar, activeBar, useUsd]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isDark = theme === 'dark';
    const { upColor, downColor } = getTrendChartColors(colorConvention);

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 390,
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
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isDark ? 'rgba(245,158,11,0.45)' : 'rgba(180,83,9,0.35)',
          labelBackgroundColor: isDark ? '#1E293B' : '#111827',
        },
        horzLine: {
          color: isDark ? 'rgba(245,158,11,0.45)' : 'rgba(180,83,9,0.35)',
          labelBackgroundColor: isDark ? '#1E293B' : '#111827',
        },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)',
      },
      timeScale: {
        borderColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)',
        timeVisible: isIntraday,
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    chartRef.current = chart;

    if (bars.length > 0) {
      let mainSeries: ISeriesApi<'Area' | 'Candlestick'>;

      if (chartStyle === 'candle') {
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor,
          downColor,
          borderVisible: false,
          wickUpColor: upColor,
          wickDownColor: downColor,
        });
        candleSeries.setData(
          bars.map((b) => ({
            time: (isIntraday ? b.timestamp : b.time.slice(0, 10)) as Time,
            open: useUsd ? b.openUsd : b.open,
            high: useUsd ? b.highUsd : b.high,
            low: useUsd ? b.lowUsd : b.low,
            close: useUsd ? b.closeUsd : b.close,
          }))
        );
        mainSeries = candleSeries;
      } else {
        const areaSeries = chart.addSeries(AreaSeries, {
          lineColor: '#B45309',
          topColor: isDark ? 'rgba(245, 158, 11, 0.28)' : 'rgba(180, 83, 9, 0.18)',
          bottomColor: isDark ? 'rgba(245, 158, 11, 0.01)' : 'rgba(180, 83, 9, 0.01)',
          lineWidth: 2,
          priceLineVisible: true,
        });
        areaSeries.setData(
          bars.map((b) => ({
            time: (isIntraday ? b.timestamp : b.time.slice(0, 10)) as Time,
            value: useUsd ? b.closeUsd : b.close,
          }))
        );
        mainSeries = areaSeries;
      }

      // Cost basis horizontal price line (in CNY mode)
      if (showCostLine && !useUsd && avgCostCny > 0) {
        mainSeries.createPriceLine({
          price: Number(avgCostCny.toFixed(2)),
          color: '#2563EB',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: '持仓均价',
        });
      }

      // Buy / Sell markers on daily chart
      if (showMarkers && !isIntraday && transactions.length > 0) {
        const barDates = new Set(bars.map((b) => b.time.slice(0, 10)));
        const firstDate = bars[0].time.slice(0, 10);
        const lastDate = bars[bars.length - 1].time.slice(0, 10);

        const markers: SeriesMarker<Time>[] = [];
        for (const tx of transactions) {
          if (tx.date < firstDate || tx.date > lastDate) continue;
          // Find exact or nearest subsequent trading day
          let targetDate = tx.date;
          if (!barDates.has(targetDate)) {
            const nearest = bars.find((b) => b.time.slice(0, 10) >= tx.date);
            if (!nearest) continue;
            targetDate = nearest.time.slice(0, 10);
          }

          const isBuy = tx.side === 'buy';
          markers.push({
            time: targetDate as Time,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: isBuy ? '#D97706' : '#2563EB',
            shape: isBuy ? 'arrowUp' : 'arrowDown',
            text: `${isBuy ? '买' : '卖'} ${tx.grams}g`,
          });
        }

        markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
        if (markers.length > 0) {
          createSeriesMarkers(mainSeries, markers);
        }
      }

      // Moving Averages (only on daily bars with enough history)
      if (showMA && !isIntraday) {
        const maConfigs = [
          { period: 5, color: '#0EA5E9' },
          { period: 20, color: '#D97706' },
          { period: 60, color: '#8B5CF6' },
        ];
        for (const cfg of maConfigs) {
          const maData = computeMovingAverage(bars, cfg.period, useUsd);
          if (maData.length > 2) {
            const lineSeries = chart.addSeries(LineSeries, {
              color: cfg.color,
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            });
            lineSeries.setData(
              maData.map((d) => ({
                time: d.time.slice(0, 10) as Time,
                value: d.value,
              }))
            );
          }
        }
      }

      chart.timeScale().fitContent();
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoveredBar(null);
        return;
      }
      const key =
        typeof param.time === 'number'
          ? param.time
          : String(param.time);
      const found = barByTimeKey.get(key) ?? null;
      setHoveredBar(found);
    });

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
      chartRef.current = null;
    };
  }, [
    bars,
    chartStyle,
    useUsd,
    showMA,
    showCostLine,
    showMarkers,
    avgCostCny,
    transactions,
    theme,
    colorConvention,
    isIntraday,
    barByTimeKey,
  ]);

  const activeTxs = activeBar ? txByDate.get(activeBar.time.slice(0, 10)) ?? [] : [];

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
      {/* Header & Interactive Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/80">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {useUsd ? '国际现货黄金 (XAU/USD)' : '国内参考金价 (Au99.99 折算)'}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {sourceLabel} · {isLive ? '实时同步' : '本地基准'}
            </span>
          </div>

          {activeBar && (
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono-tabular">
              <span className="text-slate-500 dark:text-slate-400">{activeBar.time}</span>
              <span className="text-slate-700 dark:text-slate-300">
                开 <strong className="font-semibold">{useUsd ? formatUsd(activeBar.openUsd) : formatCny(activeBar.open)}</strong>
              </span>
              <span className="text-slate-700 dark:text-slate-300">
                高 <strong className="font-semibold">{useUsd ? formatUsd(activeBar.highUsd) : formatCny(activeBar.high)}</strong>
              </span>
              <span className="text-slate-700 dark:text-slate-300">
                低 <strong className="font-semibold">{useUsd ? formatUsd(activeBar.lowUsd) : formatCny(activeBar.low)}</strong>
              </span>
              <span className="text-slate-900 dark:text-slate-100">
                收 <strong className="font-semibold">{useUsd ? formatUsd(activeBar.closeUsd) : formatCny(activeBar.close)}</strong>
              </span>
              <span className={getTrendTextClass(periodReturnPct, colorConvention)}>
                区间 {formatSignedPct(periodReturnPct)}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                汇率 {activeBar.usdCny.toFixed(4)}
              </span>
            </div>
          )}
        </div>

        {/* Chart Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframes */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => onRangeChange(r.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  range === r.key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Unit toggle */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => setUnit('cny')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                unit === 'cny'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              ¥/克
            </button>
            <button
              type="button"
              onClick={() => setUnit('usd')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                unit === 'usd'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              $/oz
            </button>
          </div>

          {/* Chart style toggle */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => setChartStyle('area')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartStyle === 'area'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              趋势图
            </button>
            <button
              type="button"
              onClick={() => setChartStyle('candle')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartStyle === 'candle'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              K线图
            </button>
          </div>
        </div>
      </div>

      {/* Overlay Indicator Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            图表叠加:
          </span>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showMA}
              onChange={(e) => setShowMA(e.target.checked)}
              disabled={isIntraday}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span>均线 (MA5/20/60)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showCostLine}
              onChange={(e) => setShowCostLine(e.target.checked)}
              disabled={useUsd || avgCostCny <= 0}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span>持仓均价线 ({avgCostCny > 0 ? formatCny(avgCostCny) : '无持仓'})</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showMarkers}
              onChange={(e) => setShowMarkers(e.target.checked)}
              disabled={isIntraday}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span>买卖点位标注</span>
          </label>
        </div>

        {showMA && !isIntraday && (
          <div className="flex items-center gap-3 font-mono-tabular text-[11px]">
            <span className="text-[#0EA5E9]">MA5</span>
            <span className="text-[#D97706]">MA20</span>
            <span className="text-[#8B5CF6]">MA60</span>
            {showCostLine && avgCostCny > 0 && !useUsd && (
              <span className="text-[#2563EB]">均价 {formatCny(avgCostCny)}</span>
            )}
          </div>
        )}
      </div>

      {/* Chart Canvas Container */}
      <div className="relative w-full h-[390px]">
        {loading && bars.length === 0 ? (
          <div className="w-full h-full rounded-lg bg-slate-100 dark:bg-slate-800/40 animate-pulse flex items-center justify-center text-sm text-slate-500">
            正在同步历史行情序列...
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-full" />
        )}
      </div>

      {/* Crosshair Transaction Callout Strip (only shown when hovering a trading day with transactions) */}
      {activeTxs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            当日交易记录 ({activeBar?.time}):
          </span>
          {activeTxs.map((tx) => (
            <span
              key={tx.id}
              className="font-mono-tabular text-slate-600 dark:text-slate-300"
            >
              {tx.side === 'buy' ? '买入' : '卖出'} {tx.grams}g @ {formatCny(tx.unitPriceCny)}
              {tx.note ? ` (${tx.note})` : ''}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

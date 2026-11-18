import type {
  BacktestConfig,
  BacktestPoint,
  BacktestResult,
  BacktestStrategyType,
  PriceBar,
} from '../types/gold';

export const STRATEGY_LABELS: Record<BacktestStrategyType, string> = {
  dca: '定期定额定投 (DCA)',
  smart_ma: '均线偏离智能定投 (Smart MA)',
  lump_sum: '期初一次性买入持有',
  dip_grid: '回撤加仓波段止盈',
};

export function computeMovingAverage(
  bars: PriceBar[],
  period: number,
  useUsd = false
): Array<{ time: string; value: number }> {
  const result: Array<{ time: string; value: number }> = [];
  if (bars.length < period) return result;

  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    const val = useUsd ? bars[i].closeUsd : bars[i].close;
    sum += val;
    if (i >= period) {
      sum -= useUsd ? bars[i - period].closeUsd : bars[i - period].close;
    }
    if (i >= period - 1) {
      result.push({
        time: bars[i].time,
        value: Number((sum / period).toFixed(2)),
      });
    }
  }
  return result;
}

export function runGoldBacktest(bars: PriceBar[], config: BacktestConfig): BacktestResult {
  if (bars.length === 0) {
    return {
      strategyLabel: STRATEGY_LABELS[config.strategy],
      startDate: '-',
      endDate: '-',
      totalInvestedCny: 0,
      finalValueCny: 0,
      totalProfitCny: 0,
      totalReturnPct: 0,
      annualizedReturnPct: 0,
      maxDrawdownPct: 0,
      totalGrams: 0,
      avgAcquisitionCostCny: 0,
      finalPriceCny: 0,
      tradeCount: 0,
      points: [],
    };
  }

  const feeRatio = Math.max(0, config.feeRatePct) / 100;
  const freqDays =
    config.frequency === 'weekly' ? 5 : config.frequency === 'biweekly' ? 10 : 21;

  // Precompute simple moving average for each bar
  const maValues: Array<number | null> = bars.map((_, idx) => {
    if (idx < config.maPeriod - 1) return null;
    let sum = 0;
    for (let j = idx - config.maPeriod + 1; j <= idx; j++) {
      sum += bars[j].close;
    }
    return sum / config.maPeriod;
  });

  let gramsHeld = 0;
  let totalInvestedCny = 0;
  let realizedCashCny = 0;
  let tradeCount = 0;
  let peakReturnRatio = 0;
  let maxDrawdownPct = 0;
  let lastGridAnchorPrice = bars[0].close;

  const points: BacktestPoint[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const price = bar.close;
    const maPrice = maValues[i];
    let action: BacktestPoint['action'] | undefined;

    if (config.strategy === 'lump_sum') {
      if (i === 0 && config.initialCapitalCny > 0) {
        const netCap = config.initialCapitalCny / (1 + feeRatio);
        const boughtGrams = netCap / price;
        gramsHeld += boughtGrams;
        totalInvestedCny += config.initialCapitalCny;
        tradeCount++;
        action = 'buy';
      }
    } else if (config.strategy === 'dca') {
      if (i === 0 && config.initialCapitalCny > 0) {
        const netCap = config.initialCapitalCny / (1 + feeRatio);
        gramsHeld += netCap / price;
        totalInvestedCny += config.initialCapitalCny;
        tradeCount++;
        action = 'buy';
      }
      if (i > 0 && i % freqDays === 0 && config.periodicAmountCny > 0) {
        const netCap = config.periodicAmountCny / (1 + feeRatio);
        gramsHeld += netCap / price;
        totalInvestedCny += config.periodicAmountCny;
        tradeCount++;
        action = 'buy';
      }
    } else if (config.strategy === 'smart_ma') {
      if (i === 0 && config.initialCapitalCny > 0) {
        const netCap = config.initialCapitalCny / (1 + feeRatio);
        gramsHeld += netCap / price;
        totalInvestedCny += config.initialCapitalCny;
        tradeCount++;
        action = 'buy';
      } else if (i > 0 && i % freqDays === 0 && config.periodicAmountCny > 0) {
        let amountToBuy = config.periodicAmountCny;
        let isDipBuy = false;
        if (maPrice !== null) {
          const deviationPct = ((price - maPrice) / maPrice) * 100;
          if (deviationPct <= -Math.abs(config.dipThresholdPct)) {
            amountToBuy = config.periodicAmountCny * config.dipMultiplier;
            isDipBuy = true;
          } else if (deviationPct >= Math.abs(config.dipThresholdPct) * 1.8) {
            // Overheated above MA -> scale down to 50%
            amountToBuy = config.periodicAmountCny * 0.5;
          }
        }
        const netCap = amountToBuy / (1 + feeRatio);
        gramsHeld += netCap / price;
        totalInvestedCny += amountToBuy;
        tradeCount++;
        action = isDipBuy ? 'dip_buy' : 'buy';
      }
    } else if (config.strategy === 'dip_grid') {
      if (i === 0) {
        const seed = config.initialCapitalCny > 0 ? config.initialCapitalCny : config.periodicAmountCny * 4;
        const netCap = seed / (1 + feeRatio);
        gramsHeld += netCap / price;
        totalInvestedCny += seed;
        lastGridAnchorPrice = price;
        tradeCount++;
        action = 'buy';
      } else {
        const changeFromAnchorPct = ((price - lastGridAnchorPrice) / lastGridAnchorPrice) * 100;
        if (changeFromAnchorPct <= -Math.abs(config.dipThresholdPct)) {
          // Dip buy
          const buyAmt = config.periodicAmountCny * config.dipMultiplier;
          const netCap = buyAmt / (1 + feeRatio);
          gramsHeld += netCap / price;
          totalInvestedCny += buyAmt;
          lastGridAnchorPrice = price;
          tradeCount++;
          action = 'dip_buy';
        } else if (
          changeFromAnchorPct >= Math.abs(config.takeProfitPct) &&
          gramsHeld > 5
        ) {
          // Partial take profit (25% of current holdings)
          const sellGrams = gramsHeld * 0.25;
          const proceeds = sellGrams * price * (1 - feeRatio);
          gramsHeld -= sellGrams;
          realizedCashCny += proceeds;
          lastGridAnchorPrice = price;
          tradeCount++;
          action = 'take_profit';
        }
      }
    }

    const portfolioValueCny = gramsHeld * price + realizedCashCny;
    const profit = portfolioValueCny - totalInvestedCny;
    const returnPct = totalInvestedCny > 0 ? (profit / totalInvestedCny) * 100 : 0;

    // Drawdown measured on total equity-to-cost curve (value / invested)
    const equityRatio = totalInvestedCny > 0 ? portfolioValueCny / totalInvestedCny : 1;
    if (equityRatio > peakReturnRatio) {
      peakReturnRatio = equityRatio;
    }
    const drawdownPct =
      peakReturnRatio > 0 ? ((equityRatio - peakReturnRatio) / peakReturnRatio) * 100 : 0;
    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
    }

    points.push({
      date: bar.time.slice(0, 10),
      priceCny: price,
      maPriceCny: maPrice !== null ? Number(maPrice.toFixed(2)) : null,
      investedCny: Number(totalInvestedCny.toFixed(2)),
      portfolioValueCny: Number(portfolioValueCny.toFixed(2)),
      gramsHeld: Number(gramsHeld.toFixed(4)),
      avgCostCny:
        gramsHeld > 1e-6
          ? Number(((totalInvestedCny - realizedCashCny) / gramsHeld).toFixed(2))
          : 0,
      returnPct: Number(returnPct.toFixed(2)),
      drawdownPct: Number(drawdownPct.toFixed(2)),
      action,
    });
  }

  const last = points[points.length - 1];
  const startMs = new Date(bars[0].time.slice(0, 10)).getTime();
  const endMs = new Date(bars[bars.length - 1].time.slice(0, 10)).getTime();
  const years = Math.max(1 / 365, (endMs - startMs) / (365 * 86400 * 1000));
  const totalReturnRatio = totalInvestedCny > 0 ? last.portfolioValueCny / totalInvestedCny : 1;
  const annualizedReturnPct =
    totalReturnRatio > 0 ? (Math.pow(totalReturnRatio, 1 / years) - 1) * 100 : 0;

  return {
    strategyLabel: STRATEGY_LABELS[config.strategy],
    startDate: bars[0].time.slice(0, 10),
    endDate: bars[bars.length - 1].time.slice(0, 10),
    totalInvestedCny: last.investedCny,
    finalValueCny: last.portfolioValueCny,
    totalProfitCny: Number((last.portfolioValueCny - last.investedCny).toFixed(2)),
    totalReturnPct: last.returnPct,
    annualizedReturnPct: Number(annualizedReturnPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    totalGrams: last.gramsHeld,
    avgAcquisitionCostCny: last.avgCostCny,
    finalPriceCny: last.priceCny,
    tradeCount,
    points,
  };
}

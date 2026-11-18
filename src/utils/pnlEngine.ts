import type {
  AccountPnL,
  AccountType,
  FifoLot,
  GoldAccount,
  GoldTransaction,
  PortfolioSummary,
  PriceBar,
} from '../types/gold';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  accumulation: '积存金',
  physical: '实物黄金',
  etf: '纸黄金 / ETF',
};

export const ACCOUNTING_METHOD_LABELS: Record<'weighted_avg' | 'fifo', string> = {
  weighted_avg: '移动加权平均法',
  fifo: '先进先出法 (FIFO)',
};

/**
 * Approximate XIRR using Newton-Raphson with bounded fallback
 */
function calculateXIRR(
  cashflows: Array<{ date: string; amount: number }>,
  asOfDate: string
): number | null {
  if (cashflows.length < 2) return null;
  const hasPositive = cashflows.some((c) => c.amount > 0);
  const hasNegative = cashflows.some((c) => c.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const t0 = new Date(cashflows[0].date).getTime();
  const tEnd = new Date(asOfDate).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(tEnd) || tEnd - t0 < 14 * 86400 * 1000) {
    return null; // Too short (<14 days) for meaningful annualized return
  }

  const days = cashflows.map((c) => (new Date(c.date).getTime() - t0) / (365 * 86400 * 1000));

  let rate = 0.1;
  for (let iter = 0; iter < 50; iter++) {
    let npv = 0;
    let dNpv = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const base = 1 + rate;
      if (base <= 0.0001) {
        rate = -0.9;
        break;
      }
      const factor = Math.pow(base, -days[i]);
      npv += cashflows[i].amount * factor;
      if (days[i] !== 0) {
        dNpv -= days[i] * cashflows[i].amount * Math.pow(base, -days[i] - 1);
      }
    }
    if (Math.abs(npv) < 1e-4) {
      return Number.isFinite(rate) ? rate * 100 : null;
    }
    if (Math.abs(dNpv) < 1e-9) break;
    const nextRate = rate - npv / dNpv;
    if (!Number.isFinite(nextRate) || nextRate <= -0.99 || nextRate > 10) break;
    rate = nextRate;
  }

  return Number.isFinite(rate) && rate > -0.99 && rate < 10 ? rate * 100 : null;
}

export function computeAccountPnL(
  account: GoldAccount,
  transactions: GoldTransaction[],
  spotCnyPerGram: number,
  asOfDate = new Date().toISOString().slice(0, 10)
): AccountPnL {
  const accountTxs = transactions
    .filter((t) => t.accountId === account.id)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  let holdingGrams = 0;
  let totalBoughtGrams = 0;
  let totalSoldGrams = 0;
  let totalBuyCostCny = 0;
  let totalSellProceedsCny = 0;
  let totalFeesCny = 0;
  let realizedPnlCny = 0;

  // Weighted average running cost pool
  let runningCostBasisCny = 0;

  // FIFO lot queue
  const fifoLots: FifoLot[] = [];

  const cashflows: Array<{ date: string; amount: number }> = [];

  for (const tx of accountTxs) {
    totalFeesCny += tx.feeCny;

    if (tx.side === 'buy') {
      const grossCost = tx.grams * tx.unitPriceCny + tx.feeCny;
      const unitCostWithFee = tx.grams > 0 ? grossCost / tx.grams : tx.unitPriceCny;

      holdingGrams += tx.grams;
      totalBoughtGrams += tx.grams;
      totalBuyCostCny += grossCost;
      runningCostBasisCny += grossCost;

      fifoLots.push({
        txId: tx.id,
        date: tx.date,
        remainingGrams: tx.grams,
        unitCostCny: unitCostWithFee,
      });

      cashflows.push({ date: tx.date, amount: -grossCost });
    } else {
      const sellGrams = Math.min(tx.grams, Math.max(holdingGrams, 0));
      const netProceeds = tx.grams * tx.unitPriceCny - tx.feeCny;
      totalSoldGrams += tx.grams;
      totalSellProceedsCny += netProceeds;

      if (account.accountingMethod === 'weighted_avg') {
        const avgCost = holdingGrams > 0 ? runningCostBasisCny / holdingGrams : 0;
        const costOfSold = sellGrams * avgCost;
        realizedPnlCny += netProceeds - costOfSold;
        runningCostBasisCny = Math.max(0, runningCostBasisCny - costOfSold);
        holdingGrams = Math.max(0, holdingGrams - tx.grams);
      } else {
        // FIFO
        let remainingToSell = sellGrams;
        let fifoCostOfSold = 0;
        while (remainingToSell > 1e-8 && fifoLots.length > 0) {
          const head = fifoLots[0];
          const consumed = Math.min(head.remainingGrams, remainingToSell);
          fifoCostOfSold += consumed * head.unitCostCny;
          head.remainingGrams -= consumed;
          remainingToSell -= consumed;
          if (head.remainingGrams <= 1e-8) {
            fifoLots.shift();
          }
        }
        realizedPnlCny += netProceeds - fifoCostOfSold;
        holdingGrams = Math.max(0, holdingGrams - tx.grams);
        runningCostBasisCny = fifoLots.reduce(
          (acc, lot) => acc + lot.remainingGrams * lot.unitCostCny,
          0
        );
      }

      cashflows.push({ date: tx.date, amount: netProceeds });
    }
  }

  const remainingCostCny =
    account.accountingMethod === 'fifo'
      ? fifoLots.reduce((acc, lot) => acc + lot.remainingGrams * lot.unitCostCny, 0)
      : runningCostBasisCny;

  const avgCostPerGram = holdingGrams > 1e-6 ? remainingCostCny / holdingGrams : 0;
  const netInvestedCash = totalBuyCostCny - totalSellProceedsCny;
  const dilutedCostPerGram = holdingGrams > 1e-6 ? netInvestedCash / holdingGrams : 0;

  const spotReferencePriceCny = spotCnyPerGram * account.purity;
  const effectiveLiquidationPriceCny = Math.max(
    0,
    spotReferencePriceCny - account.buybackSpreadPerGram
  );

  const marketValueCny = holdingGrams * spotReferencePriceCny;
  const netBuybackValueCny = holdingGrams * effectiveLiquidationPriceCny;

  const unrealizedPnlCny = holdingGrams > 1e-6 ? netBuybackValueCny - remainingCostCny : 0;
  const unrealizedPnlPct =
    remainingCostCny > 1e-4 ? (unrealizedPnlCny / remainingCostCny) * 100 : 0;

  const totalPnlCny = realizedPnlCny + unrealizedPnlCny;
  const totalReturnPct =
    totalBuyCostCny > 1e-4 ? (totalPnlCny / totalBuyCostCny) * 100 : 0;

  if (netBuybackValueCny > 0) {
    cashflows.push({ date: asOfDate, amount: netBuybackValueCny });
  }
  const annualizedReturnPct = calculateXIRR(cashflows, asOfDate);

  return {
    account,
    holdingGrams,
    totalBoughtGrams,
    totalSoldGrams,
    avgCostPerGram,
    dilutedCostPerGram,
    totalBuyCostCny,
    totalSellProceedsCny,
    totalFeesCny,
    spotReferencePriceCny,
    effectiveLiquidationPriceCny,
    marketValueCny,
    netBuybackValueCny,
    unrealizedPnlCny,
    unrealizedPnlPct,
    realizedPnlCny,
    totalPnlCny,
    totalReturnPct,
    annualizedReturnPct,
    transactionCount: accountTxs.length,
    lastTxDate: accountTxs.length > 0 ? accountTxs[accountTxs.length - 1].date : null,
    fifoLots,
  };
}

export function computePortfolioSummary(
  accounts: GoldAccount[],
  transactions: GoldTransaction[],
  spotCnyPerGram: number,
  selectedAccountId: string | 'all' = 'all'
): PortfolioSummary {
  const filteredAccounts =
    selectedAccountId === 'all'
      ? accounts
      : accounts.filter((a) => a.id === selectedAccountId);

  const accountPnLs = filteredAccounts.map((acc) =>
    computeAccountPnL(acc, transactions, spotCnyPerGram)
  );

  let totalHoldingGrams = 0;
  let totalPureGrams = 0;
  let totalMarketValueCny = 0;
  let totalNetBuybackValueCny = 0;
  let totalRemainingCostCny = 0;
  let totalBuyCostCny = 0;
  let totalSellProceedsCny = 0;
  let totalFeesCny = 0;
  let totalUnrealizedPnlCny = 0;
  let totalRealizedPnlCny = 0;

  const byType: PortfolioSummary['byType'] = {
    accumulation: {
      type: 'accumulation',
      label: ACCOUNT_TYPE_LABELS.accumulation,
      accountCount: 0,
      holdingGrams: 0,
      marketValueCny: 0,
      netBuybackValueCny: 0,
      remainingCostCny: 0,
      unrealizedPnlCny: 0,
      realizedPnlCny: 0,
      totalPnlCny: 0,
      sharePct: 0,
    },
    physical: {
      type: 'physical',
      label: ACCOUNT_TYPE_LABELS.physical,
      accountCount: 0,
      holdingGrams: 0,
      marketValueCny: 0,
      netBuybackValueCny: 0,
      remainingCostCny: 0,
      unrealizedPnlCny: 0,
      realizedPnlCny: 0,
      totalPnlCny: 0,
      sharePct: 0,
    },
    etf: {
      type: 'etf',
      label: ACCOUNT_TYPE_LABELS.etf,
      accountCount: 0,
      holdingGrams: 0,
      marketValueCny: 0,
      netBuybackValueCny: 0,
      remainingCostCny: 0,
      unrealizedPnlCny: 0,
      realizedPnlCny: 0,
      totalPnlCny: 0,
      sharePct: 0,
    },
  };

  for (const item of accountPnLs) {
    const remCost = item.holdingGrams * item.avgCostPerGram;
    totalHoldingGrams += item.holdingGrams;
    totalPureGrams += item.holdingGrams * item.account.purity;
    totalMarketValueCny += item.marketValueCny;
    totalNetBuybackValueCny += item.netBuybackValueCny;
    totalRemainingCostCny += remCost;
    totalBuyCostCny += item.totalBuyCostCny;
    totalSellProceedsCny += item.totalSellProceedsCny;
    totalFeesCny += item.totalFeesCny;
    totalUnrealizedPnlCny += item.unrealizedPnlCny;
    totalRealizedPnlCny += item.realizedPnlCny;

    const bucket = byType[item.account.type];
    bucket.accountCount += 1;
    bucket.holdingGrams += item.holdingGrams;
    bucket.marketValueCny += item.marketValueCny;
    bucket.netBuybackValueCny += item.netBuybackValueCny;
    bucket.remainingCostCny += remCost;
    bucket.unrealizedPnlCny += item.unrealizedPnlCny;
    bucket.realizedPnlCny += item.realizedPnlCny;
    bucket.totalPnlCny += item.totalPnlCny;
  }

  for (const key of Object.keys(byType) as AccountType[]) {
    byType[key].sharePct =
      totalNetBuybackValueCny > 1e-4
        ? (byType[key].netBuybackValueCny / totalNetBuybackValueCny) * 100
        : 0;
  }

  const weightedAvgCostCny =
    totalHoldingGrams > 1e-6 ? totalRemainingCostCny / totalHoldingGrams : 0;
  const totalUnrealizedPnlPct =
    totalRemainingCostCny > 1e-4 ? (totalUnrealizedPnlCny / totalRemainingCostCny) * 100 : 0;
  const totalPnlCny = totalRealizedPnlCny + totalUnrealizedPnlCny;
  const totalReturnPct =
    totalBuyCostCny > 1e-4 ? (totalPnlCny / totalBuyCostCny) * 100 : 0;

  // Portfolio-level XIRR
  const filteredAccountIds = new Set(filteredAccounts.map((a) => a.id));
  const portfolioCashflows = transactions
    .filter((t) => filteredAccountIds.has(t.accountId))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      date: t.date,
      amount:
        t.side === 'buy'
          ? -(t.grams * t.unitPriceCny + t.feeCny)
          : t.grams * t.unitPriceCny - t.feeCny,
    }));

  const asOfDate = new Date().toISOString().slice(0, 10);
  if (totalNetBuybackValueCny > 0) {
    portfolioCashflows.push({ date: asOfDate, amount: totalNetBuybackValueCny });
  }
  const annualizedReturnPct = calculateXIRR(portfolioCashflows, asOfDate);

  return {
    totalHoldingGrams,
    totalPureGrams,
    totalMarketValueCny,
    totalNetBuybackValueCny,
    totalRemainingCostCny,
    totalBuyCostCny,
    totalSellProceedsCny,
    totalFeesCny,
    weightedAvgCostCny,
    totalUnrealizedPnlCny,
    totalUnrealizedPnlPct,
    totalRealizedPnlCny,
    totalPnlCny,
    totalReturnPct,
    annualizedReturnPct,
    accountPnLs,
    byType,
  };
}

export interface PortfolioTimelinePoint {
  date: string;
  priceCny: number;
  holdingGrams: number;
  netInvestedCny: number; // Cumulative buy - cumulative sell
  marketValueCny: number;
  totalPnlCny: number;
  returnPct: number;
}

/**
 * Reconstructs historical portfolio value & PnL over daily PriceBar[]
 */
export function buildPortfolioTimeline(
  bars: PriceBar[],
  accounts: GoldAccount[],
  transactions: GoldTransaction[],
  selectedAccountId: string | 'all' = 'all'
): PortfolioTimelinePoint[] {
  if (bars.length === 0) return [];

  const targetAccounts =
    selectedAccountId === 'all'
      ? accounts
      : accounts.filter((a) => a.id === selectedAccountId);
  const accountMap = new Map(targetAccounts.map((a) => [a.id, a]));

  const sortedTxs = transactions
    .filter((t) => accountMap.has(t.accountId))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sortedTxs.length === 0) return [];

  const firstTxDate = sortedTxs[0].date;
  const relevantBars = bars.filter((b) => b.time.slice(0, 10) >= firstTxDate);
  if (relevantBars.length === 0) return [];

  const timeline: PortfolioTimelinePoint[] = [];
  let txIdx = 0;

  // Track holdings per account for purity/spread weighting
  const accountGrams = new Map<string, number>();
  let cumulativeBuyCny = 0;
  let cumulativeSellCny = 0;

  for (const bar of relevantBars) {
    const barDate = bar.time.slice(0, 10);
    while (txIdx < sortedTxs.length && sortedTxs[txIdx].date <= barDate) {
      const tx = sortedTxs[txIdx];
      const prev = accountGrams.get(tx.accountId) ?? 0;
      if (tx.side === 'buy') {
        accountGrams.set(tx.accountId, prev + tx.grams);
        cumulativeBuyCny += tx.grams * tx.unitPriceCny + tx.feeCny;
      } else {
        accountGrams.set(tx.accountId, Math.max(0, prev - tx.grams));
        cumulativeSellCny += tx.grams * tx.unitPriceCny - tx.feeCny;
      }
      txIdx++;
    }

    let holdingGrams = 0;
    let marketValueCny = 0;
    for (const [accId, grams] of accountGrams.entries()) {
      const acc = accountMap.get(accId);
      if (!acc || grams <= 0) continue;
      holdingGrams += grams;
      const effPrice = Math.max(0, bar.close * acc.purity - acc.buybackSpreadPerGram);
      marketValueCny += grams * effPrice;
    }

    const netInvestedCny = cumulativeBuyCny - cumulativeSellCny;
    const totalPnlCny = marketValueCny - netInvestedCny;
    const returnPct = cumulativeBuyCny > 0 ? (totalPnlCny / cumulativeBuyCny) * 100 : 0;

    timeline.push({
      date: barDate,
      priceCny: bar.close,
      holdingGrams,
      netInvestedCny,
      marketValueCny,
      totalPnlCny,
      returnPct,
    });
  }

  return timeline;
}

export interface MonthlyReturnStat {
  month: string; // YYYY-MM
  startPriceCny: number;
  endPriceCny: number;
  priceChangePct: number;
  buyGrams: number;
  sellGrams: number;
  netFlowCny: number;
}

export function computeMonthlyStats(
  bars: PriceBar[],
  transactions: GoldTransaction[],
  selectedAccountId: string | 'all' = 'all',
  accounts: GoldAccount[] = []
): MonthlyReturnStat[] {
  const targetIds =
    selectedAccountId === 'all'
      ? new Set(accounts.map((a) => a.id))
      : new Set([selectedAccountId]);

  const monthMap = new Map<
    string,
    {
      startPrice: number;
      endPrice: number;
      buyGrams: number;
      sellGrams: number;
      netFlow: number;
    }
  >();

  for (const bar of bars) {
    const m = bar.time.slice(0, 7);
    const existing = monthMap.get(m);
    if (!existing) {
      monthMap.set(m, {
        startPrice: bar.open,
        endPrice: bar.close,
        buyGrams: 0,
        sellGrams: 0,
        netFlow: 0,
      });
    } else {
      existing.endPrice = bar.close;
    }
  }

  for (const tx of transactions) {
    if (accounts.length > 0 && !targetIds.has(tx.accountId)) continue;
    const m = tx.date.slice(0, 7);
    const bucket = monthMap.get(m);
    if (!bucket) continue;
    if (tx.side === 'buy') {
      bucket.buyGrams += tx.grams;
      bucket.netFlow += tx.grams * tx.unitPriceCny + tx.feeCny;
    } else {
      bucket.sellGrams += tx.grams;
      bucket.netFlow -= tx.grams * tx.unitPriceCny - tx.feeCny;
    }
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      startPriceCny: d.startPrice,
      endPriceCny: d.endPrice,
      priceChangePct: d.startPrice > 0 ? ((d.endPrice - d.startPrice) / d.startPrice) * 100 : 0,
      buyGrams: d.buyGrams,
      sellGrams: d.sellGrams,
      netFlowCny: d.netFlow,
    }));
}

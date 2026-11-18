export type AccountType = 'physical' | 'accumulation' | 'etf';

export type AccountingMethod = 'weighted_avg' | 'fifo';

export type ColorConvention = 'cn' | 'intl';

export type ThemeMode = 'light' | 'dark';

export interface GoldAccount {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  purity: number; // e.g., 0.9999 for Au9999, 0.999 for Au999, 0.75 for 18K
  buybackSpreadPerGram: number; // CNY/g discount when liquidating physical or bank spread
  defaultFeeRate: number; // percentage e.g., 0.5 means 0.5%
  accountingMethod: AccountingMethod;
  notes?: string;
  createdAt: string;
}

export interface GoldTransaction {
  id: string;
  accountId: string;
  side: 'buy' | 'sell';
  date: string; // YYYY-MM-DD
  grams: number;
  unitPriceCny: number; // price per gram before fee
  feeCny: number; // craftsmanship / transaction fee in CNY
  note?: string;
  createdAt: string;
}

export interface AppSettings {
  colorConvention: ColorConvention; // 'cn' = red up / green down, 'intl' = green up / red down
  theme: ThemeMode;
  autoSyncIntervalSec: number; // 0 = manual, 15, 30, 60
  autoBackupEnabled: boolean;
  maxBackupSnapshots: number;
  sgePremiumCny: number; // domestic Au99.99 spread vs international spot CNY/g
}

export interface LedgerState {
  version: number;
  updatedAt: string;
  accounts: GoldAccount[];
  transactions: GoldTransaction[];
  settings: AppSettings;
}

export interface PriceBar {
  time: string; // YYYY-MM-DD or YYYY-MM-DD HH:mm
  timestamp: number; // unix seconds
  open: number; // CNY/g
  high: number;
  low: number;
  close: number;
  openUsd: number; // USD/oz
  highUsd: number;
  lowUsd: number;
  closeUsd: number;
  usdCny: number;
}

export interface SpotQuote {
  cnyPerGram: number;
  usdPerOz: number;
  usdCnyRate: number;
  prevCloseCny: number;
  changeCny: number;
  changePct: number;
  high24hCny: number;
  low24hCny: number;
  updatedAt: string;
  source: string;
  isLive: boolean;
}

export interface FifoLot {
  txId: string;
  date: string;
  remainingGrams: number;
  unitCostCny: number; // includes pro-rata buy fee
}

export interface AccountPnL {
  account: GoldAccount;
  holdingGrams: number;
  totalBoughtGrams: number;
  totalSoldGrams: number;
  avgCostPerGram: number; // Remaining position cost basis (Cny/g)
  dilutedCostPerGram: number; // Net cash invested / remaining grams
  totalBuyCostCny: number;
  totalSellProceedsCny: number;
  totalFeesCny: number;
  spotReferencePriceCny: number; // Spot * purity
  effectiveLiquidationPriceCny: number; // Spot * purity - buybackSpread
  marketValueCny: number; // holdingGrams * spotReferencePriceCny
  netBuybackValueCny: number; // holdingGrams * effectiveLiquidationPriceCny
  unrealizedPnlCny: number; // netBuybackValueCny - remainingCostCny
  unrealizedPnlPct: number;
  realizedPnlCny: number;
  totalPnlCny: number;
  totalReturnPct: number;
  annualizedReturnPct: number | null;
  transactionCount: number;
  lastTxDate: string | null;
  fifoLots: FifoLot[];
}

export interface PortfolioSummary {
  totalHoldingGrams: number;
  totalPureGrams: number; // purity-adjusted equivalent Au9999 grams
  totalMarketValueCny: number;
  totalNetBuybackValueCny: number;
  totalRemainingCostCny: number;
  totalBuyCostCny: number;
  totalSellProceedsCny: number;
  totalFeesCny: number;
  weightedAvgCostCny: number;
  totalUnrealizedPnlCny: number;
  totalUnrealizedPnlPct: number;
  totalRealizedPnlCny: number;
  totalPnlCny: number;
  totalReturnPct: number;
  annualizedReturnPct: number | null;
  accountPnLs: AccountPnL[];
  byType: Record<
    AccountType,
    {
      type: AccountType;
      label: string;
      accountCount: number;
      holdingGrams: number;
      marketValueCny: number;
      netBuybackValueCny: number;
      remainingCostCny: number;
      unrealizedPnlCny: number;
      realizedPnlCny: number;
      totalPnlCny: number;
      sharePct: number;
    }
  >;
}

export interface BackupSnapshotMeta {
  filename: string;
  createdAt: string;
  reason: string;
  sizeBytes: number;
  accountCount: number;
  transactionCount: number;
  totalGrams: number;
}

export type BacktestStrategyType = 'dca' | 'smart_ma' | 'lump_sum' | 'dip_grid';

export interface BacktestConfig {
  strategy: BacktestStrategyType;
  range: '6M' | '1Y' | '3Y' | '5Y';
  initialCapitalCny: number;
  periodicAmountCny: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  feeRatePct: number;
  maPeriod: number;
  dipThresholdPct: number; // e.g., 2.5 means buy 2x when price is 2.5% below MA
  dipMultiplier: number; // e.g., 2.0
  takeProfitPct: number; // used in dip_grid
}

export interface BacktestPoint {
  date: string;
  priceCny: number;
  maPriceCny: number | null;
  investedCny: number;
  portfolioValueCny: number;
  gramsHeld: number;
  avgCostCny: number;
  returnPct: number;
  drawdownPct: number;
  action?: 'buy' | 'dip_buy' | 'take_profit';
}

export interface BacktestResult {
  strategyLabel: string;
  startDate: string;
  endDate: string;
  totalInvestedCny: number;
  finalValueCny: number;
  totalProfitCny: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  totalGrams: number;
  avgAcquisitionCostCny: number;
  finalPriceCny: number;
  tradeCount: number;
  points: BacktestPoint[];
}

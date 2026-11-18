import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CandlestickChart,
  DatabaseBackup,
  History,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import { AccountModal } from './components/AccountModal';
import { AccountsAndLedgerView } from './components/AccountsAndLedgerView';
import { AnalyticsReportView } from './components/AnalyticsReportView';
import { BacktestView } from './components/BacktestView';
import { BackupAndSettingsView } from './components/BackupAndSettingsView';
import { GoldPriceChart, type ChartRange } from './components/GoldPriceChart';
import { TransactionModal } from './components/TransactionModal';
import { DEFAULT_LEDGER_STATE } from './data/seedLedger';
import type {
  AppSettings,
  BackupSnapshotMeta,
  GoldAccount,
  GoldTransaction,
  LedgerState,
  PriceBar,
  SpotQuote,
} from './types/gold';
import {
  formatCny,
  formatGrams,
  formatSignedCny,
  formatSignedPct,
  formatUsd,
  getTrendTextClass,
} from './utils/formatters';
import {
  createManualSnapshotClient,
  deleteSnapshotClient,
  fetchHistoryClient,
  fetchSpotClient,
  loadBackupsClient,
  restoreSnapshotClient,
  saveLedgerClient,
} from './utils/marketClient';
import {
  ACCOUNT_TYPE_LABELS,
  computePortfolioSummary,
} from './utils/pnlEngine';

type NavTab = 'overview' | 'accounts' | 'backtest' | 'analytics' | 'backup';

const LOCAL_STORAGE_KEY = 'auledger_state_v2';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof CandlestickChart }> = [
  { id: 'overview', label: '行情与总览', icon: CandlestickChart },
  { id: 'accounts', label: '多账户与台账', icon: Wallet },
  { id: 'backtest', label: '历史价格回测', icon: History },
  { id: 'analytics', label: '多维分析报告', icon: BarChart3 },
  { id: 'backup', label: '自动备份与设置', icon: DatabaseBackup },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [ledger, setLedger] = useState<LedgerState>(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as LedgerState;
        if (Array.isArray(parsed.accounts) && Array.isArray(parsed.transactions)) {
          return parsed;
        }
      }
    } catch {
      // ignore localStorage read errors
    }
    return DEFAULT_LEDGER_STATE;
  });

  const [selectedAccountId, setSelectedAccountId] = useState<string | 'all'>('all');
  const [chartRange, setChartRange] = useState<ChartRange>('1Y');
  const [bars, setBars] = useState<PriceBar[]>([]);
  const [historyMeta, setHistoryMeta] = useState<{ source: string; isLive: boolean }>({
    source: '行情同步中',
    isLive: false,
  });
  const [historyLoading, setHistoryLoading] = useState(true);

  const [spot, setSpot] = useState<SpotQuote>({
    cnyPerGram: 0,
    usdPerOz: 0,
    usdCnyRate: 0,
    prevCloseCny: 0,
    changeCny: 0,
    changePct: 0,
    high24hCny: 0,
    low24hCny: 0,
    updatedAt: new Date().toISOString(),
    source: '正在同步实时行情...',
    isLive: false,
  });
  const [spotRefreshing, setSpotRefreshing] = useState(false);

  const [backups, setBackups] = useState<BackupSnapshotMeta[]>([]);
  const [lastBackupSavedAt, setLastBackupSavedAt] = useState<string | null>(null);

  // Modals
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txDefaultAccountId, setTxDefaultAccountId] = useState<string | undefined>(undefined);
  const [editingTx, setEditingTx] = useState<GoldTransaction | null>(null);

  const [accModalOpen, setAccModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<GoldAccount | null>(null);

  // Apply theme class cleanly on <html>
  useEffect(() => {
    const isDark = ledger.settings.theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
  }, [ledger.settings.theme]);

  const refreshBackups = useCallback(async () => {
    const list = await loadBackupsClient();
    setBackups(list);
  }, []);

  const persistLedger = useCallback(
    async (nextLedger: LedgerState, createAutoBackup: boolean, reason: string) => {
      setLedger(nextLedger);
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextLedger));
      } catch {
        // ignore storage quota errors
      }
      const res = await saveLedgerClient(nextLedger, createAutoBackup, reason);
      setLastBackupSavedAt(res.updatedAt);
      if (res.backupCreated) {
        await refreshBackups();
      }
    },
    [refreshBackups]
  );

  // Initial load from local disk (/api/ledger) if backend is running
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ledger');
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = (await res.json()) as { exists: boolean; ledger: LedgerState | null };
          if (!cancelled && data.exists && data.ledger) {
            setLedger(data.ledger);
            try {
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data.ledger));
            } catch {
              // ignore
            }
          } else if (!cancelled && !data.exists) {
            await persistLedger(ledger, true, 'init_seed');
          }
        } else if (!cancelled) {
          // Static GitHub Pages mode: ensure initial localStorage snapshot exists
          const existingBackups = await loadBackupsClient();
          if (existingBackups.length === 0) {
            await persistLedger(ledger, true, 'init_seed');
          }
        }
      } catch {
        // stay on localStorage/default
      } finally {
        if (!cancelled) {
          refreshBackups();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch spot price
  const fetchSpot = useCallback(async () => {
    setSpotRefreshing(true);
    try {
      const quote = await fetchSpotClient(ledger.settings.sgePremiumCny);
      setSpot(quote);
    } finally {
      setSpotRefreshing(false);
    }
  }, [ledger.settings.sgePremiumCny]);

  useEffect(() => {
    fetchSpot();
    const intervalSec = ledger.settings.autoSyncIntervalSec;
    if (!intervalSec || intervalSec <= 0) return;
    const id = window.setInterval(fetchSpot, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [fetchSpot, ledger.settings.autoSyncIntervalSec]);

  // Fetch historical chart series
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    fetchHistoryClient(chartRange, ledger.settings.sgePremiumCny)
      .then((data) => {
        if (cancelled) return;
        setBars(data.bars);
        setHistoryMeta({
          source: data.source,
          isLive: data.isLive,
        });
      })
      .catch(() => {
        if (!cancelled) setBars([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chartRange, ledger.settings.sgePremiumCny]);

  // Portfolio & scoped PnL calculations
  const fullPortfolioSummary = useMemo(
    () => computePortfolioSummary(ledger.accounts, ledger.transactions, spot.cnyPerGram, 'all'),
    [ledger.accounts, ledger.transactions, spot.cnyPerGram]
  );

  const scopedSummary = useMemo(
    () =>
      computePortfolioSummary(
        ledger.accounts,
        ledger.transactions,
        spot.cnyPerGram,
        selectedAccountId
      ),
    [ledger.accounts, ledger.transactions, spot.cnyPerGram, selectedAccountId]
  );

  const scopedTransactions = useMemo(() => {
    if (selectedAccountId === 'all') return ledger.transactions;
    return ledger.transactions.filter((t) => t.accountId === selectedAccountId);
  }, [ledger.transactions, selectedAccountId]);

  const accountNameMap = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a.name])),
    [ledger.accounts]
  );

  // CRUD handlers
  const handleSaveTransaction = (
    data: Omit<GoldTransaction, 'id' | 'createdAt'>,
    existingId?: string
  ) => {
    const now = new Date().toISOString();
    let nextTxs: GoldTransaction[];
    let reason = 'tx_add';

    if (existingId) {
      nextTxs = ledger.transactions.map((t) =>
        t.id === existingId ? { ...t, ...data } : t
      );
      reason = 'tx_edit';
    } else {
      const newTx: GoldTransaction = {
        ...data,
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
      };
      nextTxs = [newTx, ...ledger.transactions];
    }

    persistLedger(
      { ...ledger, updatedAt: now, transactions: nextTxs },
      true,
      reason
    );
  };

  const handleDeleteTransaction = (id: string) => {
    const now = new Date().toISOString();
    const nextTxs = ledger.transactions.filter((t) => t.id !== id);
    persistLedger(
      { ...ledger, updatedAt: now, transactions: nextTxs },
      true,
      'tx_delete'
    );
  };

  const handleSaveAccount = (
    data: Omit<GoldAccount, 'id' | 'createdAt'>,
    existingId?: string
  ) => {
    const now = new Date().toISOString();
    let nextAccounts: GoldAccount[];
    let reason = 'acc_add';

    if (existingId) {
      nextAccounts = ledger.accounts.map((a) =>
        a.id === existingId ? { ...a, ...data } : a
      );
      reason = 'acc_edit';
    } else {
      const newAcc: GoldAccount = {
        ...data,
        id: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
      };
      nextAccounts = [...ledger.accounts, newAcc];
    }

    persistLedger(
      { ...ledger, updatedAt: now, accounts: nextAccounts },
      true,
      reason
    );
  };

  const handleDeleteAccount = (id: string) => {
    const now = new Date().toISOString();
    const nextAccounts = ledger.accounts.filter((a) => a.id !== id);
    const nextTxs = ledger.transactions.filter((t) => t.accountId !== id);
    if (selectedAccountId === id) setSelectedAccountId('all');
    persistLedger(
      { ...ledger, updatedAt: now, accounts: nextAccounts, transactions: nextTxs },
      true,
      'acc_delete'
    );
  };

  const handleUpdateSettings = (patch: Partial<AppSettings>) => {
    const now = new Date().toISOString();
    const nextLedger: LedgerState = {
      ...ledger,
      updatedAt: now,
      settings: { ...ledger.settings, ...patch },
    };
    persistLedger(nextLedger, false, 'settings');
  };

  const handleCreateManualSnapshot = async (note: string) => {
    const nextBackups = await createManualSnapshotClient(note, ledger);
    setBackups(nextBackups);
  };

  const handleRestoreSnapshot = async (filename: string) => {
    const res = await restoreSnapshotClient(filename, ledger);
    if (res.ledger) {
      setLedger(res.ledger);
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(res.ledger));
      } catch {
        // ignore
      }
    }
    setBackups(res.backups);
  };

  const handleDeleteSnapshot = async (filename: string) => {
    const nextBackups = await deleteSnapshotClient(filename);
    setBackups(nextBackups);
  };

  const handleImportLedgerJson = async (imported: LedgerState) => {
    await persistLedger(imported, true, 'import_json');
  };

  const handleResetToDemo = async () => {
    await persistLedger(
      { ...DEFAULT_LEDGER_STATE, updatedAt: new Date().toISOString() },
      true,
      'reset_demo'
    );
  };

  const openNewTransaction = (accId?: string) => {
    setEditingTx(null);
    setTxDefaultAccountId(
      accId ?? (selectedAccountId !== 'all' ? selectedAccountId : ledger.accounts[0]?.id)
    );
    setTxModalOpen(true);
  };

  const activeNavTitle = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? '工作台';
  const colorConv = ledger.settings.colorConvention;

  return (
    <div className="min-h-screen flex bg-[#F7F7F5] dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F131D]">
        <div className="h-14 px-5 flex items-center border-b border-slate-100 dark:border-slate-800/80">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            AuLedger
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Quiet Local Persistence Summary */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400 space-y-1.5">
          <div className="flex items-center justify-between">
            <span>持有账户</span>
            <span className="font-mono-tabular text-slate-800 dark:text-slate-200">
              {ledger.accounts.length} 个
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>本地快照</span>
            <span className="font-mono-tabular text-slate-800 dark:text-slate-200">
              {backups.length} 份
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>自动备份</span>
            <span className="text-slate-700 dark:text-slate-300">
              {ledger.settings.autoBackupEnabled ? '已开启' : '已暂停'}
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-white dark:bg-[#0F131D] h-full border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <span className="font-display text-lg font-bold">AuLedger</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-500"
                aria-label="关闭菜单"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="mt-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium ${
                      active
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 font-semibold'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Context Left — Actions Right */}
        <header className="h-14 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F131D] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="打开导航菜单"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                黄金资产工作台
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {activeNavTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({
                  theme: ledger.settings.theme === 'dark' ? 'light' : 'dark',
                })
              }
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="切换深浅主题"
              title="切换深浅主题"
            >
              {ledger.settings.theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={fetchSpot}
              disabled={spotRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${spotRefreshing ? 'animate-spin' : ''}`} />
              <span>同步金价</span>
            </button>

            <button
              type="button"
              onClick={() => openNewTransaction()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>记一笔</span>
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {activeTab === 'overview' && (
            <>
              {/* 4-Column KPI Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Card 1: Spot Price */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>国内参考金价 (Au99.99)</span>
                    <span className="font-mono-tabular">
                      {new Date(spot.updatedAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2.5">
                    <span className="text-2xl font-bold font-mono-tabular text-slate-900 dark:text-slate-100">
                      {spot.cnyPerGram > 0 ? formatCny(spot.cnyPerGram) : '同步中...'}
                    </span>
                    {spot.cnyPerGram > 0 && <span className="text-xs text-slate-400">/g</span>}
                    {spot.cnyPerGram > 0 && (
                      <span
                        className={`text-xs font-semibold font-mono-tabular ${getTrendTextClass(
                          spot.changeCny,
                          colorConv
                        )}`}
                      >
                        {formatSignedCny(spot.changeCny)} ({formatSignedPct(spot.changePct)})
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                    {spot.usdPerOz > 0
                      ? `伦敦金 ${formatUsd(spot.usdPerOz)}/oz · 汇率 ${spot.usdCnyRate.toFixed(4)}`
                      : spot.source}
                  </div>
                </div>

                {/* Card 2: Net Holdings & Realizable Value */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      {selectedAccountId === 'all'
                        ? '全账户总持仓净值'
                        : `${accountNameMap.get(selectedAccountId) ?? ''} 净值`}
                    </span>
                    <span className="font-mono-tabular">
                      {scopedSummary.accountPnLs.length} 个账户
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-mono-tabular text-slate-900 dark:text-slate-100">
                      {formatCny(scopedSummary.totalNetBuybackValueCny)}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                    持仓 {formatGrams(scopedSummary.totalHoldingGrams)} · 牌价市值{' '}
                    {formatCny(scopedSummary.totalMarketValueCny, 0)}
                  </div>
                </div>

                {/* Card 3: Unrealized PnL & Avg Cost */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>持仓浮动盈亏（已扣折价）</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span
                      className={`text-2xl font-bold font-mono-tabular ${getTrendTextClass(
                        scopedSummary.totalUnrealizedPnlCny,
                        colorConv
                      )}`}
                    >
                      {formatSignedCny(scopedSummary.totalUnrealizedPnlCny)}
                    </span>
                    <span
                      className={`text-xs font-semibold font-mono-tabular ${getTrendTextClass(
                        scopedSummary.totalUnrealizedPnlPct,
                        colorConv
                      )}`}
                    >
                      {formatSignedPct(scopedSummary.totalUnrealizedPnlPct)}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                    持仓均价 {formatCny(scopedSummary.weightedAvgCostCny)}/g · 剩余本金{' '}
                    {formatCny(scopedSummary.totalRemainingCostCny, 0)}
                  </div>
                </div>

                {/* Card 4: Total PnL (Realized + Unrealized) */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>累计总盈亏（含已落袋）</span>
                    {scopedSummary.annualizedReturnPct !== null && (
                      <span className="font-mono-tabular">
                        XIRR {formatSignedPct(scopedSummary.annualizedReturnPct, 1)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span
                      className={`text-2xl font-bold font-mono-tabular ${getTrendTextClass(
                        scopedSummary.totalPnlCny,
                        colorConv
                      )}`}
                    >
                      {formatSignedCny(scopedSummary.totalPnlCny)}
                    </span>
                    <span
                      className={`text-xs font-semibold font-mono-tabular ${getTrendTextClass(
                        scopedSummary.totalReturnPct,
                        colorConv
                      )}`}
                    >
                      {formatSignedPct(scopedSummary.totalReturnPct)}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                    已落袋 {formatSignedCny(scopedSummary.totalRealizedPnlCny)} · 累计手续费{' '}
                    {formatCny(scopedSummary.totalFeesCny)}
                  </div>
                </div>
              </div>

              {/* Account Scope Selector Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#111622] border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId('all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      selectedAccountId === 'all'
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    全部账户汇总
                  </button>
                  {ledger.accounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => setSelectedAccountId(acc.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        selectedAccountId === acc.id
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {acc.name}
                    </button>
                  ))}
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400">
                  当前折算溢价校准: {ledger.settings.sgePremiumCny >= 0 ? '+' : ''}
                  {ledger.settings.sgePremiumCny} ¥/g · 数据源: {spot.source}
                </div>
              </div>

              {/* Main Interactive Chart */}
              <GoldPriceChart
                bars={bars}
                range={chartRange}
                onRangeChange={setChartRange}
                loading={historyLoading}
                transactions={scopedTransactions}
                avgCostCny={scopedSummary.weightedAvgCostCny}
                theme={ledger.settings.theme}
                colorConvention={colorConv}
                sourceLabel={historyMeta.source}
                isLive={historyMeta.isLive}
              />

              {/* Bottom 2-Column Overview: Account PnL Snapshot + Recent Transactions */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                <section className="xl:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        多账户持仓盈亏速览
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        实物黄金与积存金分别计提纯度与回收折价
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('accounts')}
                      className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      管理账户与台账
                    </button>
                  </div>

                  <div className="overflow-x-auto mt-3">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-3">账户</th>
                          <th className="py-2 px-2 text-right">持仓</th>
                          <th className="py-2 px-2 text-right">持仓均价</th>
                          <th className="py-2 px-2 text-right">变现净值</th>
                          <th className="py-2 px-2 text-right">总盈亏</th>
                          <th className="py-2 pl-2 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                        {fullPortfolioSummary.accountPnLs.map((item) => (
                          <tr
                            key={item.account.id}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                          >
                            <td className="py-2.5 pr-3">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {item.account.name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {ACCOUNT_TYPE_LABELS[item.account.type]} · {item.account.institution}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular text-slate-900 dark:text-slate-100">
                              {formatGrams(item.holdingGrams)}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular text-slate-600 dark:text-slate-300">
                              {item.holdingGrams > 0 ? formatCny(item.avgCostPerGram) : '—'}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular font-medium text-slate-900 dark:text-slate-100">
                              {formatCny(item.netBuybackValueCny)}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular">
                              <div
                                className={`font-semibold ${getTrendTextClass(
                                  item.totalPnlCny,
                                  colorConv
                                )}`}
                              >
                                {formatSignedCny(item.totalPnlCny)}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {formatSignedPct(item.totalReturnPct)}
                              </div>
                            </td>
                            <td className="py-2.5 pl-2 text-right">
                              <button
                                type="button"
                                onClick={() => openNewTransaction(item.account.id)}
                                className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                记账
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-amber-600" />
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        最近买卖记录
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => openNewTransaction()}
                      className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      新增交易
                    </button>
                  </div>

                  <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800/70">
                    {scopedTransactions
                      .slice()
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .slice(0, 6)
                      .map((tx) => {
                        const isBuy = tx.side === 'buy';
                        const total = isBuy
                          ? tx.grams * tx.unitPriceCny + tx.feeCny
                          : tx.grams * tx.unitPriceCny - tx.feeCny;
                        return (
                          <div
                            key={tx.id}
                            onClick={() => {
                              setEditingTx(tx);
                              setTxModalOpen(true);
                            }}
                            className="py-2.5 flex items-center justify-between gap-3 text-xs cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/30 px-1.5 rounded-md transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-semibold ${
                                    isBuy
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-blue-700 dark:text-blue-400'
                                  }`}
                                >
                                  {isBuy ? '买入' : '卖出'} {formatGrams(tx.grams)}
                                </span>
                                <span className="text-slate-400 font-mono-tabular">{tx.date}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {accountNameMap.get(tx.accountId) ?? '未知账户'}
                                {tx.note ? ` · ${tx.note}` : ''}
                              </div>
                            </div>

                            <div className="text-right font-mono-tabular shrink-0">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {formatCny(total)}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                @{formatCny(tx.unitPriceCny)}/g
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    {scopedTransactions.length === 0 && (
                      <div className="py-8 text-center text-xs text-slate-500">
                        暂无交易记录，点击右上角“记一笔”开始追踪。
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}

          {activeTab === 'accounts' && (
            <AccountsAndLedgerView
              summary={fullPortfolioSummary}
              accounts={ledger.accounts}
              transactions={ledger.transactions}
              colorConvention={colorConv}
              onAddAccount={() => {
                setEditingAccount(null);
                setAccModalOpen(true);
              }}
              onEditAccount={(acc) => {
                setEditingAccount(acc);
                setAccModalOpen(true);
              }}
              onDeleteAccount={handleDeleteAccount}
              onAddTransaction={openNewTransaction}
              onEditTransaction={(tx) => {
                setEditingTx(tx);
                setTxModalOpen(true);
              }}
              onDeleteTransaction={handleDeleteTransaction}
            />
          )}

          {activeTab === 'backtest' && (
            <BacktestView
              theme={ledger.settings.theme}
              colorConvention={colorConv}
              sgePremiumCny={ledger.settings.sgePremiumCny}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsReportView
              summary={scopedSummary}
              accounts={ledger.accounts}
              transactions={ledger.transactions}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
              spotCnyPerGram={spot.cnyPerGram}
              theme={ledger.settings.theme}
              colorConvention={colorConv}
              sgePremiumCny={ledger.settings.sgePremiumCny}
            />
          )}

          {activeTab === 'backup' && (
            <BackupAndSettingsView
              ledger={ledger}
              backups={backups}
              lastBackupSavedAt={lastBackupSavedAt}
              onUpdateSettings={handleUpdateSettings}
              onCreateManualSnapshot={handleCreateManualSnapshot}
              onRestoreSnapshot={handleRestoreSnapshot}
              onDeleteSnapshot={handleDeleteSnapshot}
              onImportLedgerJson={handleImportLedgerJson}
              onResetToDemo={handleResetToDemo}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <TransactionModal
        open={txModalOpen}
        onClose={() => setTxModalOpen(false)}
        accounts={ledger.accounts}
        defaultAccountId={txDefaultAccountId}
        editingTx={editingTx}
        currentSpotCny={spot.cnyPerGram}
        onSave={handleSaveTransaction}
      />

      <AccountModal
        open={accModalOpen}
        onClose={() => setAccModalOpen(false)}
        editingAccount={editingAccount}
        onSave={handleSaveAccount}
      />
    </div>
  );
}

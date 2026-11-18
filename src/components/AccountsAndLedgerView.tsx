import { useMemo, useState } from 'react';
import { Download, Edit3, Plus, Search, Trash2 } from 'lucide-react';
import type {
  ColorConvention,
  GoldAccount,
  GoldTransaction,
  PortfolioSummary,
} from '../types/gold';
import { ACCOUNTING_METHOD_LABELS, ACCOUNT_TYPE_LABELS } from '../utils/pnlEngine';
import {
  formatCny,
  formatGrams,
  formatSignedCny,
  formatSignedPct,
  getTrendTextClass,
} from '../utils/formatters';

interface AccountsAndLedgerViewProps {
  summary: PortfolioSummary;
  accounts: GoldAccount[];
  transactions: GoldTransaction[];
  colorConvention: ColorConvention;
  onAddAccount: () => void;
  onEditAccount: (acc: GoldAccount) => void;
  onDeleteAccount: (id: string) => void;
  onAddTransaction: (defaultAccountId?: string) => void;
  onEditTransaction: (tx: GoldTransaction) => void;
  onDeleteTransaction: (id: string) => void;
}

export function AccountsAndLedgerView({
  summary,
  accounts,
  transactions,
  colorConvention,
  onAddAccount,
  onEditAccount,
  onDeleteAccount,
  onAddTransaction,
  onEditTransaction,
  onDeleteTransaction,
}: AccountsAndLedgerViewProps) {
  const [filterAccountId, setFilterAccountId] = useState<string>('all');
  const [filterSide, setFilterSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFifoAccId, setExpandedFifoAccId] = useState<string | null>(null);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions
      .filter((tx) => {
        if (filterAccountId !== 'all' && tx.accountId !== filterAccountId) return false;
        if (filterSide !== 'all' && tx.side !== filterSide) return false;
        if (q) {
          const accName = accountMap.get(tx.accountId)?.name.toLowerCase() ?? '';
          const note = (tx.note ?? '').toLowerCase();
          if (!accName.includes(q) && !note.includes(q) && !tx.date.includes(q)) {
            return false;
          }
        }
        return true;
      })
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [transactions, filterAccountId, filterSide, searchQuery, accountMap]);

  const handleExportCsv = () => {
    const header = ['日期', '账户', '资产类型', '方向', '克重(g)', '单价(元/g)', '工费/手续费(元)', '净现金流(元)', '备注'];
    const rows = filteredTransactions.map((tx) => {
      const acc = accountMap.get(tx.accountId);
      const cash =
        tx.side === 'buy'
          ? -(tx.grams * tx.unitPriceCny + tx.feeCny)
          : tx.grams * tx.unitPriceCny - tx.feeCny;
      return [
        tx.date,
        acc?.name ?? tx.accountId,
        acc ? ACCOUNT_TYPE_LABELS[acc.type] : '-',
        tx.side === 'buy' ? '买入' : '卖出',
        tx.grams.toFixed(4),
        tx.unitPriceCny.toFixed(2),
        tx.feeCny.toFixed(2),
        cash.toFixed(2),
        (tx.note ?? '').replace(/,/g, ' '),
      ].join(',');
    });
    const csv = '\uFEFF' + [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gold-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Multi-Account Overview Header */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              多账户盈亏明细与持仓核算
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              支持实物黄金与积存金分别设定纯度、回收折价与核算方法（移动加权平均 / FIFO 先进先出）
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onAddAccount}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              新建账户
            </button>
            <button
              type="button"
              onClick={() => onAddTransaction()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              记一笔交易
            </button>
          </div>
        </div>

        {summary.accountPnLs.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">尚未创建任何黄金账户</p>
            <button
              type="button"
              onClick={onAddAccount}
              className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 cursor-pointer"
            >
              创建第一个黄金账户
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-4">账户名称与核算逻辑</th>
                  <th className="py-2.5 px-3 text-right">当前持仓</th>
                  <th className="py-2.5 px-3 text-right">持仓均价</th>
                  <th className="py-2.5 px-3 text-right">变现折算价</th>
                  <th className="py-2.5 px-3 text-right">变现净值</th>
                  <th className="py-2.5 px-3 text-right">浮动盈亏</th>
                  <th className="py-2.5 px-3 text-right">已落袋盈亏</th>
                  <th className="py-2.5 px-3 text-right">累计总盈亏 / XIRR</th>
                  <th className="py-2.5 pl-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                {summary.accountPnLs.map((item) => {
                  const { account } = item;
                  const isFifoOpen = expandedFifoAccId === account.id;
                  return (
                    <tr
                      key={account.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 pr-4 align-top">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {account.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {ACCOUNT_TYPE_LABELS[account.type]} · {account.institution} ·{' '}
                          {ACCOUNTING_METHOD_LABELS[account.accountingMethod]}
                        </div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono-tabular">
                          纯度 {(account.purity * 100).toFixed(2)}% · 回收折价{' '}
                          {formatCny(account.buybackSpreadPerGram)}/g
                          {account.accountingMethod === 'fifo' && item.fifoLots.length > 0 && (
                            <>
                              {' · '}
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedFifoAccId(isFifoOpen ? null : account.id)
                                }
                                className="text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                              >
                                {isFifoOpen ? '收起FIFO批次' : `查看${item.fifoLots.length}个剩余批次`}
                              </button>
                            </>
                          )}
                        </div>

                        {isFifoOpen && item.fifoLots.length > 0 && (
                          <div className="mt-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 space-y-1">
                            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                              FIFO 剩余未平仓批次明细：
                            </div>
                            {item.fifoLots.map((lot) => (
                              <div
                                key={lot.txId}
                                className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400"
                              >
                                <span>{lot.date}</span>
                                <span>余 {formatGrams(lot.remainingGrams)}</span>
                                <span>含费成本 {formatCny(lot.unitCostCny)}/g</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right align-top font-mono-tabular">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatGrams(item.holdingGrams)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {item.transactionCount} 笔交易
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right align-top font-mono-tabular">
                        <div className="text-slate-900 dark:text-slate-100">
                          {item.holdingGrams > 0 ? formatCny(item.avgCostPerGram) : '—'}
                        </div>
                        {item.holdingGrams > 0 && (
                          <div className="text-[11px] text-slate-400">
                            摊薄 {formatCny(item.dilutedCostPerGram)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right align-top font-mono-tabular text-slate-700 dark:text-slate-300">
                        {formatCny(item.effectiveLiquidationPriceCny)}
                      </td>

                      <td className="py-3 px-3 text-right align-top font-mono-tabular">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatCny(item.netBuybackValueCny)}
                        </div>
                        {account.buybackSpreadPerGram > 0 && item.holdingGrams > 0 && (
                          <div className="text-[11px] text-slate-400">
                            牌价 {formatCny(item.marketValueCny)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right align-top font-mono-tabular">
                        <div className={`font-semibold ${getTrendTextClass(item.unrealizedPnlCny, colorConvention)}`}>
                          {formatSignedCny(item.unrealizedPnlCny)}
                        </div>
                        <div className={`text-[11px] ${getTrendTextClass(item.unrealizedPnlPct, colorConvention)}`}>
                          {formatSignedPct(item.unrealizedPnlPct)}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right align-top font-mono-tabular">
                        <span className={getTrendTextClass(item.realizedPnlCny, colorConvention)}>
                          {formatSignedCny(item.realizedPnlCny)}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right align-top font-mono-tabular">
                        <div className={`font-semibold ${getTrendTextClass(item.totalPnlCny, colorConvention)}`}>
                          {formatSignedCny(item.totalPnlCny)}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatSignedPct(item.totalReturnPct)}
                          {item.annualizedReturnPct !== null
                            ? ` · 年化 ${formatSignedPct(item.annualizedReturnPct, 1)}`
                            : ''}
                        </div>
                      </td>

                      <td className="py-3 pl-3 text-right align-top">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onAddTransaction(account.id)}
                            className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            记账
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditAccount(account)}
                            className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            aria-label={`编辑账户 ${account.name}`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteAccount(account.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            aria-label={`删除账户 ${account.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Transaction Ledger */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              黄金买卖台账明细
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              共 {filteredTransactions.length} 条记录 · 支持按账户、方向、日期及备注检索
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索备注、账户、日期..."
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-44 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>

            <select
              value={filterAccountId}
              onChange={(e) => setFilterAccountId(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              <option value="all">全部账户</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-0.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
              {(
                [
                  { id: 'all', label: '全部' },
                  { id: 'buy', label: '买入' },
                  { id: 'sell', label: '卖出' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilterSide(item.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    filterSide === item.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              导出 CSV
            </button>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            没有符合当前筛选条件的交易记录
          </div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3">交易日期</th>
                  <th className="py-2.5 px-3">所属账户</th>
                  <th className="py-2.5 px-3">方向</th>
                  <th className="py-2.5 px-3 text-right">克重</th>
                  <th className="py-2.5 px-3 text-right">成交单价</th>
                  <th className="py-2.5 px-3 text-right">工费 / 手续费</th>
                  <th className="py-2.5 px-3 text-right">成交总额</th>
                  <th className="py-2.5 px-3">备注</th>
                  <th className="py-2.5 pl-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                {filteredTransactions.map((tx) => {
                  const acc = accountMap.get(tx.accountId);
                  const isBuy = tx.side === 'buy';
                  const total = isBuy
                    ? tx.grams * tx.unitPriceCny + tx.feeCny
                    : tx.grams * tx.unitPriceCny - tx.feeCny;
                  return (
                    <tr
                      key={tx.id}
                      className="h-10 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-2.5 pr-3 font-mono-tabular text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {tx.date}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {acc?.name ?? '未知账户'}
                        </span>
                        {acc && (
                          <span className="text-slate-400 ml-1.5 text-[11px]">
                            · {ACCOUNT_TYPE_LABELS[acc.type]}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            isBuy
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-blue-700 dark:text-blue-400'
                          }`}
                        >
                          {isBuy ? '买入' : '卖出'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-900 dark:text-slate-100">
                        {formatGrams(tx.grams)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                        {formatCny(tx.unitPriceCny)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-500 dark:text-slate-400">
                        {formatCny(tx.feeCny)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                        {formatCny(total)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 max-w-[220px] truncate">
                        {tx.note || '—'}
                      </td>
                      <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditTransaction(tx)}
                            className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            aria-label="编辑交易"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTransaction(tx.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            aria-label="删除交易"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

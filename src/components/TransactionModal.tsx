import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { GoldAccount, GoldTransaction } from '../types/gold';
import { ACCOUNT_TYPE_LABELS } from '../utils/pnlEngine';
import { formatCny } from '../utils/formatters';

interface TransactionModalProps {
  open: boolean;
  onClose: () => void;
  accounts: GoldAccount[];
  defaultAccountId?: string;
  editingTx?: GoldTransaction | null;
  currentSpotCny: number;
  onSave: (tx: Omit<GoldTransaction, 'id' | 'createdAt'>, existingId?: string) => void;
}

export function TransactionModal({
  open,
  onClose,
  accounts,
  defaultAccountId,
  editingTx,
  currentSpotCny,
  onSave,
}: TransactionModalProps) {
  const [accountId, setAccountId] = useState(defaultAccountId || accounts[0]?.id || '');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [grams, setGrams] = useState('10');
  const [unitPriceCny, setUnitPriceCny] = useState(currentSpotCny.toFixed(2));
  const [feeCny, setFeeCny] = useState('0');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editingTx) {
      setAccountId(editingTx.accountId);
      setSide(editingTx.side);
      setDate(editingTx.date);
      setGrams(String(editingTx.grams));
      setUnitPriceCny(String(editingTx.unitPriceCny));
      setFeeCny(String(editingTx.feeCny));
      setNote(editingTx.note ?? '');
    } else {
      const targetAcc = accounts.find((a) => a.id === defaultAccountId) ?? accounts[0];
      setAccountId(targetAcc?.id ?? '');
      setSide('buy');
      setDate(new Date().toISOString().slice(0, 10));
      setGrams('10');
      const spotAdj = targetAcc ? currentSpotCny * targetAcc.purity : currentSpotCny;
      setUnitPriceCny(spotAdj > 0 ? spotAdj.toFixed(2) : '630.00');
      const autoFee =
        targetAcc && targetAcc.defaultFeeRate > 0 && spotAdj > 0
          ? ((10 * spotAdj * targetAcc.defaultFeeRate) / 100).toFixed(2)
          : '0';
      setFeeCny(autoFee);
      setNote('');
    }
    setError('');
  }, [open, editingTx, defaultAccountId, accounts, currentSpotCny]);

  if (!open) return null;

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const parsedGrams = Number(grams) || 0;
  const parsedPrice = Number(unitPriceCny) || 0;
  const parsedFee = Number(feeCny) || 0;
  const gross = parsedGrams * parsedPrice;
  const totalCash = side === 'buy' ? gross + parsedFee : Math.max(0, gross - parsedFee);

  const handleAutoCalcFee = () => {
    if (!selectedAccount) return;
    const rate = selectedAccount.defaultFeeRate || 0;
    const estimated = (parsedGrams * parsedPrice * rate) / 100;
    setFeeCny(estimated.toFixed(2));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) {
      setError('请选择所属黄金账户');
      return;
    }
    if (parsedGrams <= 0 || parsedPrice <= 0) {
      setError('克重与成交单价必须大于 0');
      return;
    }
    if (parsedFee < 0) {
      setError('手续费/工费不能为负数');
      return;
    }
    if (!date) {
      setError('请选择交易日期');
      return;
    }

    onSave(
      {
        accountId,
        side,
        date,
        grams: Number(parsedGrams.toFixed(4)),
        unitPriceCny: Number(parsedPrice.toFixed(2)),
        feeCny: Number(parsedFee.toFixed(2)),
        note: note.trim() || undefined,
      },
      editingTx?.id
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editingTx ? '编辑交易记录' : '记一笔黄金交易'}
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {editingTx ? '编辑交易记录' : '记一笔黄金交易'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="关闭窗口"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Side Segmented Toggle */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => setSide('buy')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                side === 'buy'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              买入 / 定投 / 购入实物
            </button>
            <button
              type="button"
              onClick={() => setSide('sell')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                side === 'sell'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              卖出 / 赎回 / 实物变现
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                所属账户
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({ACCOUNT_TYPE_LABELS[acc.type]})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                交易日期
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                成交克重 (g)
              </label>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  金价 (¥/g)
                </label>
                {currentSpotCny > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setUnitPriceCny(
                        (currentSpotCny * (selectedAccount?.purity ?? 1)).toFixed(2)
                      )
                    }
                    className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    填入现价
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitPriceCny}
                onChange={(e) => setUnitPriceCny(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  工费 / 手续费 (¥)
                </label>
                {selectedAccount && selectedAccount.defaultFeeRate > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoCalcFee}
                    className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    按{selectedAccount.defaultFeeRate}%算
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={feeCny}
                onChange={(e) => setFeeCny(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              备注说明
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：银行积存定投、50g金条含工费、阶段止盈..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>

          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {side === 'buy' ? '实际投入总额（含工费/手续费）' : '实际回笼净额（已扣手续费）'}
            </span>
            <span className="text-sm font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
              {formatCny(totalCash)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
            >
              {editingTx ? '保存修改' : '确认记录并自动备份'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { AccountType, AccountingMethod, GoldAccount } from '../types/gold';

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
  editingAccount?: GoldAccount | null;
  onSave: (data: Omit<GoldAccount, 'id' | 'createdAt'>, existingId?: string) => void;
}

const PURITY_PRESETS = [
  { label: 'Au9999 (99.99%)', value: 0.9999 },
  { label: 'Au999 (99.90%)', value: 0.999 },
  { label: 'Au990 (99.00%)', value: 0.99 },
  { label: '18K金 (75.00%)', value: 0.75 },
];

export function AccountModal({
  open,
  onClose,
  editingAccount,
  onSave,
}: AccountModalProps) {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState<AccountType>('accumulation');
  const [purity, setPurity] = useState('0.9999');
  const [buybackSpreadPerGram, setBuybackSpreadPerGram] = useState('5.0');
  const [defaultFeeRate, setDefaultFeeRate] = useState('0.35');
  const [accountingMethod, setAccountingMethod] = useState<AccountingMethod>('weighted_avg');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editingAccount) {
      setName(editingAccount.name);
      setInstitution(editingAccount.institution);
      setType(editingAccount.type);
      setPurity(String(editingAccount.purity));
      setBuybackSpreadPerGram(String(editingAccount.buybackSpreadPerGram));
      setDefaultFeeRate(String(editingAccount.defaultFeeRate));
      setAccountingMethod(editingAccount.accountingMethod);
      setNotes(editingAccount.notes ?? '');
    } else {
      setName('');
      setInstitution('');
      setType('accumulation');
      setPurity('0.9999');
      setBuybackSpreadPerGram('5.0');
      setDefaultFeeRate('0.35');
      setAccountingMethod('weighted_avg');
      setNotes('');
    }
    setError('');
  }, [open, editingAccount]);

  if (!open) return null;

  const handleTypePreset = (nextType: AccountType) => {
    setType(nextType);
    if (!editingAccount) {
      if (nextType === 'physical') {
        setBuybackSpreadPerGram('6.0');
        setDefaultFeeRate('0');
        setAccountingMethod('fifo');
      } else if (nextType === 'accumulation') {
        setBuybackSpreadPerGram('5.0');
        setDefaultFeeRate('0.35');
        setAccountingMethod('weighted_avg');
      } else {
        setBuybackSpreadPerGram('0');
        setDefaultFeeRate('0.1');
        setAccountingMethod('weighted_avg');
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入账户名称');
      return;
    }
    const parsedPurity = Number(purity);
    if (!Number.isFinite(parsedPurity) || parsedPurity <= 0 || parsedPurity > 1) {
      setError('纯度系数需在 0.01 ~ 1.00 之间');
      return;
    }

    onSave(
      {
        name: name.trim(),
        institution: institution.trim() || '个人账户',
        type,
        purity: parsedPurity,
        buybackSpreadPerGram: Math.max(0, Number(buybackSpreadPerGram) || 0),
        defaultFeeRate: Math.max(0, Number(defaultFeeRate) || 0),
        accountingMethod,
        notes: notes.trim() || undefined,
      },
      editingAccount?.id
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editingAccount ? '编辑黄金账户' : '新建黄金账户'}
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {editingAccount ? '编辑黄金账户' : '新建黄金账户'}
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

          {/* Account Type Segmented Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              资产类别
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
              {(
                [
                  { id: 'accumulation', label: '积存金' },
                  { id: 'physical', label: '实物黄金' },
                  { id: 'etf', label: '纸黄金 / ETF' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTypePreset(item.id)}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    type === item.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                账户名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：工行积存金 / 家用金条库"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                托管机构 / 渠道
              </label>
              <input
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="例如：中国工商银行 / 线下金店"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                黄金纯度
              </label>
              <select
                value={purity}
                onChange={(e) => setPurity(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              >
                {PURITY_PRESETS.map((p) => (
                  <option key={p.value} value={String(p.value)}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                回收折价 (¥/g)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={buybackSpreadPerGram}
                onChange={(e) => setBuybackSpreadPerGram(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                默认费率 (%)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={defaultFeeRate}
                onChange={(e) => setDefaultFeeRate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              盈亏成本核算方式
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => setAccountingMethod('weighted_avg')}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  accountingMethod === 'weighted_avg'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                移动加权平均法
              </button>
              <button
                type="button"
                onClick={() => setAccountingMethod('fifo')}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  accountingMethod === 'fifo'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                先进先出法 (FIFO)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              备注
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="可选：保管位置、赎回规则或工费备注"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
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
              {editingAccount ? '保存账户配置' : '创建账户'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import {
  Download,
  HardDrive,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AppSettings,
  BackupSnapshotMeta,
  LedgerState,
} from '../types/gold';
import { formatBytes, formatGrams } from '../utils/formatters';

interface BackupAndSettingsViewProps {
  ledger: LedgerState;
  backups: BackupSnapshotMeta[];
  lastBackupSavedAt: string | null;
  onUpdateSettings: (next: Partial<AppSettings>) => void;
  onCreateManualSnapshot: (note: string) => Promise<void>;
  onRestoreSnapshot: (filename: string) => Promise<void>;
  onDeleteSnapshot: (filename: string) => Promise<void>;
  onImportLedgerJson: (imported: LedgerState) => Promise<void>;
  onResetToDemo: () => Promise<void>;
}

export function BackupAndSettingsView({
  ledger,
  backups,
  lastBackupSavedAt,
  onUpdateSettings,
  onCreateManualSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onImportLedgerJson,
  onResetToDemo,
}: BackupAndSettingsViewProps) {
  const [snapshotNote, setSnapshotNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleManualSnapshot = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      await onCreateManualSnapshot(snapshotNote.trim() || 'manual');
      setSnapshotNote('');
      setStatusMsg('已生成本地快照备份文件并保存至 ./data/backups/ 目录。');
    } catch {
      setStatusMsg('创建快照失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (filename: string) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      await onRestoreSnapshot(filename);
      setStatusMsg(`已回滚恢复快照 ${filename}，并在回滚前自动为您保留了一份安全备份。`);
    } catch {
      setStatusMsg('恢复快照失败，请检查文件格式。');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadSnapshot = async (filename: string) => {
    try {
      const res = await fetch(`/api/backups/download/${encodeURIComponent(filename)}`);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && !ct.includes('text/html')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // fall through to localStorage
    }

    try {
      const raw = localStorage.getItem('auledger_backups_v1');
      if (raw) {
        const entries = JSON.parse(raw) as Array<{ meta: { filename: string }; ledger: LedgerState }>;
        const hit = entries.find((e) => e.meta.filename === filename);
        if (hit) {
          const blob = new Blob([JSON.stringify(hit, null, 2)], {
            type: 'application/json;charset=utf-8;',
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch {
      setStatusMsg('下载快照失败，请使用“导出完整 JSON”功能。');
    }
  };

  const handleExportCurrentJson = () => {
    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        app: 'AuLedger',
      },
      ledger,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { ledger?: LedgerState } & Partial<LedgerState>;
      const candidate = parsed.ledger ?? parsed;
      if (!Array.isArray(candidate.accounts) || !Array.isArray(candidate.transactions)) {
        setStatusMsg('导入失败：JSON 中缺少 accounts 或 transactions 字段。');
        return;
      }
      await onImportLedgerJson({
        version: candidate.version ?? 1,
        updatedAt: new Date().toISOString(),
        accounts: candidate.accounts,
        transactions: candidate.transactions,
        settings: candidate.settings ?? ledger.settings,
      });
      setStatusMsg(`已从 ${file.name} 成功导入账本并自动创建回滚备份。`);
    } catch {
      setStatusMsg('JSON 文件解析失败，请确认备份文件格式正确。');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div className="px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Auto-Backup & Preferences */}
        <section className="xl:col-span-5 space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  自动备份与本地持久化机制
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  双层持久化：浏览器 localStorage + 本地磁盘 ./data/ledger.json 增量快照
                </p>
              </div>
              <HardDrive className="w-4 h-4 text-amber-600" />
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    交易变动自动生成快照
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    每次新增、修改或删除账户/交易时自动滚动留存历史版本
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={ledger.settings.autoBackupEnabled}
                  onChange={(e) =>
                    onUpdateSettings({ autoBackupEnabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    滚动保留最大自动快照数
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    超出上限后自动清理最早的自动快照（手动快照永久保留）
                  </div>
                </div>
                <select
                  value={ledger.settings.maxBackupSnapshots}
                  onChange={(e) =>
                    onUpdateSettings({ maxBackupSnapshots: Number(e.target.value) })
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono-tabular"
                >
                  <option value={10}>10 份</option>
                  <option value={25}>25 份</option>
                  <option value={50}>50 份</option>
                </select>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>最近一次同步写盘时间</span>
                <span className="font-mono-tabular">
                  {lastBackupSavedAt
                    ? new Date(lastBackupSavedAt).toLocaleString('zh-CN')
                    : new Date(ledger.updatedAt).toLocaleString('zh-CN')}
                </span>
              </div>
            </div>

            {/* Manual Snapshot & Import/Export */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={snapshotNote}
                  onChange={(e) => setSnapshotNote(e.target.value)}
                  placeholder="可选快照标签（如：调仓前）"
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleManualSnapshot}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  立即快照
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleExportCurrentJson}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出完整 JSON
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  导入 JSON 恢复
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={onResetToDemo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  恢复示例数据
                </button>
              </div>
            </div>
          </div>

          {/* Market & Display Preferences */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-100 dark:border-slate-800">
              行情校准与显示偏好
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    国内金价溢价校准 (¥/g)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    用于对齐国际折算价与国内 Au99.99 / 银行积存金实时牌价
                  </div>
                </div>
                <input
                  type="number"
                  step="0.5"
                  value={ledger.settings.sgePremiumCny}
                  onChange={(e) =>
                    onUpdateSettings({ sgePremiumCny: Number(e.target.value) || 0 })
                  }
                  className="w-24 px-2.5 py-1.5 text-right font-mono-tabular rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    自动行情同步频率
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    定时拉取最新 XAU/USD 与 USD/CNY 汇率
                  </div>
                </div>
                <select
                  value={ledger.settings.autoSyncIntervalSec}
                  onChange={(e) =>
                    onUpdateSettings({ autoSyncIntervalSec: Number(e.target.value) })
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  <option value={15}>每 15 秒</option>
                  <option value={30}>每 30 秒</option>
                  <option value={60}>每 60 秒</option>
                  <option value={0}>仅手动刷新</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-200">涨跌配色习惯</span>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ colorConvention: 'cn' })}
                    className={`px-2.5 py-1 rounded-md cursor-pointer ${
                      ledger.settings.colorConvention === 'cn'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    红涨绿跌
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ colorConvention: 'intl' })}
                    className={`px-2.5 py-1 rounded-md cursor-pointer ${
                      ledger.settings.colorConvention === 'intl'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    绿涨红跌
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-200">界面主题</span>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ theme: 'light' })}
                    className={`px-2.5 py-1 rounded-md cursor-pointer ${
                      ledger.settings.theme === 'light'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    浅色工作台
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ theme: 'dark' })}
                    className={`px-2.5 py-1 rounded-md cursor-pointer ${
                      ledger.settings.theme === 'dark'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    深色金库
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Backup Snapshot History + Open Source Reference Guide */}
        <div className="xl:col-span-7 space-y-6">
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  本地自动快照历史 ({backups.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  支持一键回滚到任意历史节点，回滚前自动备份当前状态防止误操作
                </p>
              </div>
            </div>

            {backups.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                暂无本地快照记录，点击左侧“立即快照”或编辑一笔交易即可自动创建
              </div>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3">备份时间</th>
                      <th className="py-2 px-3">触发类型</th>
                      <th className="py-2 px-3 text-right">账户 / 交易</th>
                      <th className="py-2 px-3 text-right">净持仓</th>
                      <th className="py-2 px-3 text-right">体积</th>
                      <th className="py-2 pl-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono-tabular">
                    {backups.map((b) => (
                      <tr key={b.filename} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 pr-3 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {new Date(b.createdAt).toLocaleString('zh-CN')}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-300">
                          {b.reason}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                          {b.accountCount}户 / {b.transactionCount}笔
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-800 dark:text-slate-200">
                          {formatGrams(b.totalGrams)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400">
                          {formatBytes(b.sizeBytes)}
                        </td>
                        <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRestore(b.filename)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-sans font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              恢复
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadSnapshot(b.filename)}
                              className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              aria-label={`下载 ${b.filename}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteSnapshot(b.filename)}
                              className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                              aria-label={`删除 ${b.filename}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Open-Source & GitHub References */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 space-y-3 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-100 dark:border-slate-800">
              类似 GitHub 开源项目与图表库选型参考
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-600 dark:text-slate-300 leading-relaxed">
              <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  lbruton/StakTrakr (贵金属本地追踪)
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  纯客户端隐私优先的金银铂钯持仓追踪器，不依赖云端账户，集成 TradingView Lightweight Charts 展示现货历史曲线，适合参考其本地账本结构。
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  iccir919/gold-digger (轻量自托管)
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  极简自托管黄金投资记账工具，使用扁平 JSON 文件持久化持仓成本与现货估值，本工具的 ./data/ledger.json 即借鉴了该轻量化存储思路。
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  tradingview/lightweight-charts (核心图表库)
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Apache 2.0 协议的 HTML5 Canvas 金融时序库，本工具已原生集成其 v5 版本用于渲染 K 线、面积图、均线叠加与买卖点标记。
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  apache/echarts / Recharts (统计图表补充)
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  如需扩展复杂的联动箱线图、多维雷达图或月度日历热力图，可搭配 Apache ECharts 5 实现富交互统计面板。
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

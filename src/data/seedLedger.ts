import type { LedgerState } from '../types/gold';

export const DEFAULT_LEDGER_STATE: LedgerState = {
  version: 2,
  updatedAt: new Date().toISOString(),
  settings: {
    colorConvention: 'cn',
    theme: 'light',
    autoSyncIntervalSec: 30,
    autoBackupEnabled: true,
    maxBackupSnapshots: 25,
    sgePremiumCny: 2.5,
  },
  accounts: [
    {
      id: 'acc-default-accum',
      name: '积存金账户',
      institution: '银行积存金',
      type: 'accumulation',
      purity: 0.9999,
      buybackSpreadPerGram: 5.0,
      defaultFeeRate: 0.35,
      accountingMethod: 'weighted_avg',
      notes: '支持按克或按金额定投积存',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'acc-default-physical',
      name: '实物黄金账户',
      institution: '投资金条 / 金店',
      type: 'physical',
      purity: 0.9999,
      buybackSpreadPerGram: 6.0,
      defaultFeeRate: 0,
      accountingMethod: 'fifo',
      notes: '记录实物金条、首饰购入克重与工费',
      createdAt: new Date().toISOString(),
    },
  ],
  transactions: [],
};

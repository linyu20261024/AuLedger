import type {
  BackupSnapshotMeta,
  LedgerState,
  PriceBar,
  SpotQuote,
} from '../types/gold';

const GRAMS_PER_TROY_OUNCE = 31.1034768;
const LOCAL_BACKUPS_KEY = 'auledger_backups_v1';

interface LocalBackupEntry {
  meta: BackupSnapshotMeta;
  ledger: LedgerState;
}

function generateClientFallbackHistory(range: string, sgePremiumCny: number): PriceBar[] {
  const now = new Date();
  const daysMap: Record<string, number> = {
    '1D': 1,
    '1W': 7,
    '1M': 30,
    '3M': 90,
    '6M': 180,
    '1Y': 365,
    '3Y': 1095,
    '5Y': 1825,
  };
  const totalDays = daysMap[range] ?? 365;

  if (range === '1D' || range === '1W') {
    const stepSeconds = range === '1D' ? 900 : 3600;
    const totalPoints = range === '1D' ? 96 : 168;
    const endTs = Math.floor(now.getTime() / stepSeconds / 1000) * stepSeconds;
    const bars: PriceBar[] = [];
    let usdPrice = 3795.0;
    const usdCny = 6.67;

    for (let i = totalPoints; i >= 0; i--) {
      const ts = endTs - i * stepSeconds;
      const seed = Math.sin(ts * 0.00017) * 0.55 + Math.cos(ts * 0.00043) * 0.35;
      const openUsd = usdPrice;
      const delta = seed * 4.5 + Math.sin(i * 0.31) * 2.1;
      const closeUsd = Math.max(3200, openUsd + delta);
      const highUsd = Math.max(openUsd, closeUsd) + Math.abs(Math.sin(i * 1.7)) * 3.1;
      const lowUsd = Math.min(openUsd, closeUsd) - Math.abs(Math.cos(i * 1.3)) * 3.1;
      usdPrice = closeUsd;

      const factor = usdCny / GRAMS_PER_TROY_OUNCE;
      bars.push({
        time: new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' '),
        timestamp: ts,
        open: Number((openUsd * factor + sgePremiumCny).toFixed(2)),
        high: Number((highUsd * factor + sgePremiumCny).toFixed(2)),
        low: Number((lowUsd * factor + sgePremiumCny).toFixed(2)),
        close: Number((closeUsd * factor + sgePremiumCny).toFixed(2)),
        openUsd: Number(openUsd.toFixed(2)),
        highUsd: Number(highUsd.toFixed(2)),
        lowUsd: Number(lowUsd.toFixed(2)),
        closeUsd: Number(closeUsd.toFixed(2)),
        usdCny,
      });
    }
    return bars;
  }

  const bars: PriceBar[] = [];
  const startDate = new Date(now.getTime() - totalDays * 86400 * 1000);
  const startYearRatio = Math.max(0, 1 - totalDays / 1825);
  let usdPrice = 1850 + startYearRatio * 1950;
  const seenDates = new Set<string>();

  for (let d = 0; d <= totalDays; d++) {
    const dt = new Date(startDate.getTime() + d * 86400 * 1000);
    const dayOfWeek = dt.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = dt.toISOString().slice(0, 10);
    if (seenDates.has(dateStr)) continue;
    seenDates.add(dateStr);

    const progress = d / Math.max(1, totalDays);
    const secularTrend = (3820 - (1850 + startYearRatio * 1950)) / Math.max(1, totalDays * 0.71);
    const macroWave =
      Math.sin(d * 0.045) * 28 + Math.cos(d * 0.13) * 14 + Math.sin(d * 0.41) * 7;

    const openUsd = usdPrice;
    const target = 1850 + startYearRatio * 1950 + secularTrend * d + macroWave + progress * 35;
    const closeUsd = Math.max(1750, openUsd * 0.65 + target * 0.35 + Math.sin(d * 1.13) * 16);
    const highUsd = Math.max(openUsd, closeUsd) + 6 + Math.abs(Math.sin(d * 2.1)) * 18;
    const lowUsd = Math.min(openUsd, closeUsd) - 6 - Math.abs(Math.cos(d * 1.7)) * 16;
    usdPrice = closeUsd;

    const usdCny = Number((7.15 - progress * 0.45 + Math.sin(d * 0.015) * 0.08).toFixed(4));
    const factor = usdCny / GRAMS_PER_TROY_OUNCE;

    bars.push({
      time: dateStr,
      timestamp: Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000),
      open: Number((openUsd * factor + sgePremiumCny).toFixed(2)),
      high: Number((highUsd * factor + sgePremiumCny).toFixed(2)),
      low: Number((lowUsd * factor + sgePremiumCny).toFixed(2)),
      close: Number((closeUsd * factor + sgePremiumCny).toFixed(2)),
      openUsd: Number(openUsd.toFixed(2)),
      highUsd: Number(highUsd.toFixed(2)),
      lowUsd: Number(lowUsd.toFixed(2)),
      closeUsd: Number(closeUsd.toFixed(2)),
      usdCny,
    });
  }

  return bars;
}

async function fetchJsonIfApiAvailable<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchSpotClient(sgePremiumCny: number): Promise<SpotQuote> {
  const apiSpot = await fetchJsonIfApiAvailable<SpotQuote>(
    `/api/gold/spot?premium=${encodeURIComponent(sgePremiumCny)}`
  );
  if (apiSpot && typeof apiSpot.cnyPerGram === 'number') {
    return apiSpot;
  }

  // Direct browser-side public feed fallback for static hosting (e.g., GitHub Pages)
  try {
    const res = await fetch('https://data-asg.goldprice.org/dbXRates/USD,CNY');
    if (res.ok) {
      const gp = (await res.json()) as {
        items?: Array<{ curr: string; xauPrice: number; xauClose: number }>;
      };
      const usdItem = gp.items?.find((i) => i.curr === 'USD');
      const cnyItem = gp.items?.find((i) => i.curr === 'CNY');
      if (usdItem && cnyItem) {
        const usdPerOz = usdItem.xauPrice;
        const cnyPerOz = cnyItem.xauPrice;
        const usdCnyRate = Number((cnyPerOz / usdPerOz).toFixed(4));
        const cnyPerGram = Number((cnyPerOz / GRAMS_PER_TROY_OUNCE + sgePremiumCny).toFixed(2));
        const prevCloseCny = Number((cnyItem.xauClose / GRAMS_PER_TROY_OUNCE + sgePremiumCny).toFixed(2));
        const changeCny = Number((cnyPerGram - prevCloseCny).toFixed(2));
        const changePct = prevCloseCny > 0 ? Number(((changeCny / prevCloseCny) * 100).toFixed(2)) : 0;

        return {
          cnyPerGram,
          usdPerOz: Number(usdPerOz.toFixed(2)),
          usdCnyRate,
          prevCloseCny,
          changeCny,
          changePct,
          high24hCny: Number((cnyPerGram + Math.abs(changeCny) * 0.4).toFixed(2)),
          low24hCny: Number((cnyPerGram - Math.abs(changeCny) * 0.4).toFixed(2)),
          updatedAt: new Date().toISOString(),
          source: 'GoldPrice Spot Feed (浏览器直连)',
          isLive: true,
        };
      }
    }
  } catch {
    // Fall back to deterministic quote
  }

  const bars = generateClientFallbackHistory('1D', sgePremiumCny);
  const last = bars[bars.length - 1];
  const first = bars[0];
  const changeCny = Number((last.close - first.close).toFixed(2));
  return {
    cnyPerGram: last.close,
    usdPerOz: last.closeUsd,
    usdCnyRate: last.usdCny,
    prevCloseCny: first.close,
    changeCny,
    changePct: Number(((changeCny / first.close) * 100).toFixed(2)),
    high24hCny: Math.max(...bars.map((b) => b.high)),
    low24hCny: Math.min(...bars.map((b) => b.low)),
    updatedAt: new Date().toISOString(),
    source: '纯前端基准引擎 (静态托管模式)',
    isLive: false,
  };
}

export async function fetchHistoryClient(
  range: string,
  sgePremiumCny: number
): Promise<{ bars: PriceBar[]; source: string; isLive: boolean }> {
  const apiRes = await fetchJsonIfApiAvailable<{
    bars?: PriceBar[];
    source?: string;
    isLive?: boolean;
  }>(`/api/gold/history?range=${encodeURIComponent(range)}&premium=${encodeURIComponent(sgePremiumCny)}`);

  if (apiRes && Array.isArray(apiRes.bars) && apiRes.bars.length > 0) {
    return {
      bars: apiRes.bars,
      source: apiRes.source ?? '服务端实时行情',
      isLive: Boolean(apiRes.isLive),
    };
  }

  return {
    bars: generateClientFallbackHistory(range, sgePremiumCny),
    source: '纯前端基准序列 (静态托管模式)',
    isLive: false,
  };
}

// Browser localStorage snapshot fallback for static GitHub Pages mode
function readLocalBackups(): LocalBackupEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalBackupEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalBackups(entries: LocalBackupEntry[]) {
  try {
    localStorage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify(entries));
  } catch {
    // ignore quota errors
  }
}

function createLocalBackupEntry(reason: string, ledger: LedgerState): LocalBackupEntry {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  const filename = `${safeReason}_${stamp}.json`;
  const serialized = JSON.stringify({ meta: { reason, createdAt }, ledger });
  let totalGrams = 0;
  for (const t of ledger.transactions) {
    totalGrams += t.side === 'sell' ? -t.grams : t.grams;
  }
  return {
    meta: {
      filename,
      createdAt,
      reason,
      sizeBytes: new Blob([serialized]).size,
      accountCount: ledger.accounts.length,
      transactionCount: ledger.transactions.length,
      totalGrams: Number(Math.max(0, totalGrams).toFixed(3)),
    },
    ledger,
  };
}

export async function loadBackupsClient(): Promise<BackupSnapshotMeta[]> {
  const apiRes = await fetchJsonIfApiAvailable<{ backups?: BackupSnapshotMeta[] }>('/api/backups');
  if (apiRes && Array.isArray(apiRes.backups)) {
    return apiRes.backups;
  }
  return readLocalBackups().map((e) => e.meta);
}

export async function saveLedgerClient(
  ledger: LedgerState,
  createAutoBackup: boolean,
  reason: string
): Promise<{ updatedAt: string; backupCreated: boolean }> {
  const apiRes = await fetchJsonIfApiAvailable<{
    updatedAt?: string;
    backupCreated?: string | null;
  }>('/api/ledger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ledger, createAutoBackup, reason }),
  });

  if (apiRes && apiRes.updatedAt) {
    return {
      updatedAt: apiRes.updatedAt,
      backupCreated: Boolean(apiRes.backupCreated),
    };
  }

  // Static mode fallback: roll localStorage snapshot
  const updatedAt = new Date().toISOString();
  let backupCreated = false;
  if (createAutoBackup && ledger.settings.autoBackupEnabled) {
    const existing = readLocalBackups();
    const entry = createLocalBackupEntry(
      reason.startsWith('auto') ? reason : `auto_${reason}`,
      ledger
    );
    const maxSnapshots = Math.max(5, ledger.settings.maxBackupSnapshots || 25);
    const autos: LocalBackupEntry[] = [];
    const manuals: LocalBackupEntry[] = [];
    for (const item of [entry, ...existing]) {
      if (item.meta.filename.startsWith('auto_')) autos.push(item);
      else manuals.push(item);
    }
    const merged = [...autos.slice(0, maxSnapshots), ...manuals].sort((a, b) =>
      b.meta.createdAt.localeCompare(a.meta.createdAt)
    );
    writeLocalBackups(merged);
    backupCreated = true;
  }
  return { updatedAt, backupCreated };
}

export async function createManualSnapshotClient(
  reason: string,
  ledger: LedgerState
): Promise<BackupSnapshotMeta[]> {
  const apiRes = await fetchJsonIfApiAvailable<{ backups?: BackupSnapshotMeta[] }>(
    '/api/backups/create',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, ledger }),
    }
  );
  if (apiRes && Array.isArray(apiRes.backups)) {
    return apiRes.backups;
  }

  const existing = readLocalBackups();
  const entry = createLocalBackupEntry(`manual_${reason || 'snapshot'}`, ledger);
  const next = [entry, ...existing];
  writeLocalBackups(next);
  return next.map((e) => e.meta);
}

export async function restoreSnapshotClient(
  filename: string,
  currentLedger: LedgerState
): Promise<{ ledger: LedgerState | null; backups: BackupSnapshotMeta[] }> {
  const apiRes = await fetchJsonIfApiAvailable<{
    ledger?: LedgerState;
    backups?: BackupSnapshotMeta[];
  }>('/api/backups/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });

  if (apiRes && apiRes.ledger) {
    return {
      ledger: apiRes.ledger,
      backups: apiRes.backups ?? [],
    };
  }

  const existing = readLocalBackups();
  const target = existing.find((e) => e.meta.filename === filename);
  if (!target) return { ledger: null, backups: existing.map((e) => e.meta) };

  const safety = createLocalBackupEntry('pre_restore', currentLedger);
  const next = [safety, ...existing];
  writeLocalBackups(next);
  return { ledger: target.ledger, backups: next.map((e) => e.meta) };
}

export async function deleteSnapshotClient(filename: string): Promise<BackupSnapshotMeta[]> {
  const apiRes = await fetchJsonIfApiAvailable<{ backups?: BackupSnapshotMeta[] }>(
    `/api/backups/${encodeURIComponent(filename)}`,
    { method: 'DELETE' }
  );
  if (apiRes && Array.isArray(apiRes.backups)) {
    return apiRes.backups;
  }

  const next = readLocalBackups().filter((e) => e.meta.filename !== filename);
  writeLocalBackups(next);
  return next.map((e) => e.meta);
}

import type {
  BackupSnapshotMeta,
  LedgerState,
  PriceBar,
  SpotQuote,
} from '../types/gold';

const GRAMS_PER_TROY_OUNCE = 31.1034768;
export const LOCAL_BACKUPS_KEY = 'auledger_backups_v2';

interface LocalBackupEntry {
  meta: BackupSnapshotMeta;
  ledger: LedgerState;
}

const spotClientCache = new Map<number, { expiresAt: number; data: SpotQuote }>();
const historyClientCache = new Map<
  string,
  { expiresAt: number; data: { bars: PriceBar[]; source: string; isLive: boolean } }
>();

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 6000, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json') && !ct.includes('text/plain')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

async function fetchFxRatesRange(startDate: string, endDate: string): Promise<{
  byDate: Map<string, number>;
  latestRate: number;
}> {
  const byDate = new Map<string, number>();
  let latestRate = 6.67;

  // Primary: Frankfurter ECB historical FX API (CORS *)
  const frankfurter = await fetchJsonWithTimeout<{
    rates?: Record<string, { CNY?: number }>;
  }>(`https://api.frankfurter.app/${startDate}..${endDate}?from=USD&to=CNY`, 6000);

  if (frankfurter?.rates) {
    const dates = Object.keys(frankfurter.rates).sort();
    for (const d of dates) {
      const rate = frankfurter.rates[d]?.CNY;
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 4) {
        byDate.set(d, rate);
        latestRate = rate;
      }
    }
    if (byDate.size > 0) {
      return { byDate, latestRate };
    }
  }

  // Fallback: latest rate
  const latestEr = await fetchJsonWithTimeout<{ rates?: { CNY?: number } }>(
    'https://open.er-api.com/v6/latest/USD',
    5000
  );
  if (typeof latestEr?.rates?.CNY === 'number') {
    latestRate = latestEr.rates.CNY;
  }
  return { byDate, latestRate };
}

async function fetchLatestUsdCny(): Promise<number> {
  const f = await fetchJsonWithTimeout<{ rates?: { CNY?: number } }>(
    'https://api.frankfurter.app/latest?from=USD&to=CNY',
    4500
  );
  if (typeof f?.rates?.CNY === 'number' && f.rates.CNY > 4) {
    return f.rates.CNY;
  }
  const er = await fetchJsonWithTimeout<{ rates?: { CNY?: number } }>(
    'https://open.er-api.com/v6/latest/USD',
    4500
  );
  if (typeof er?.rates?.CNY === 'number' && er.rates.CNY > 4) {
    return er.rates.CNY;
  }
  return 6.67;
}

type BinanceKline = [
  number, // openTime ms
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // closeTime ms
];

async function fetchBinanceKlines(
  interval: string,
  limit: number,
  endTime?: number
): Promise<BinanceKline[] | null> {
  const qs = `symbol=PAXGUSDT&interval=${interval}&limit=${limit}${
    endTime ? `&endTime=${endTime}` : ''
  }`;
  const hosts = ['https://data-api.binance.vision', 'https://api.binance.com'];
  for (const host of hosts) {
    const data = await fetchJsonWithTimeout<BinanceKline[]>(
      `${host}/api/v3/klines?${qs}`,
      6000
    );
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  }
  return null;
}

async function fetchRealBrowserHistory(
  range: string,
  sgePremiumCny: number
): Promise<{ bars: PriceBar[]; source: string; isLive: boolean } | null> {
  const rangeCfg: Record<string, { interval: string; totalBars: number; intraday: boolean }> = {
    '1D': { interval: '15m', totalBars: 96, intraday: true },
    '1W': { interval: '1h', totalBars: 168, intraday: true },
    '1M': { interval: '1d', totalBars: 31, intraday: false },
    '3M': { interval: '1d', totalBars: 92, intraday: false },
    '6M': { interval: '1d', totalBars: 183, intraday: false },
    '1Y': { interval: '1d', totalBars: 365, intraday: false },
    '3Y': { interval: '1d', totalBars: 1095, intraday: false },
    '5Y': { interval: '1d', totalBars: 1825, intraday: false },
  };
  const cfg = rangeCfg[range] ?? rangeCfg['1Y'];

  let rawKlines: BinanceKline[] = [];
  if (cfg.totalBars <= 1000) {
    const batch = await fetchBinanceKlines(cfg.interval, cfg.totalBars);
    if (!batch) return null;
    rawKlines = batch;
  } else {
    // Paginate backwards in 2 chunks for 3Y / 5Y real daily candles
    const latestBatch = await fetchBinanceKlines(cfg.interval, 1000);
    if (!latestBatch || latestBatch.length === 0) return null;
    const remaining = cfg.totalBars - latestBatch.length;
    const earliestOpenMs = latestBatch[0][0];
    const olderBatch =
      remaining > 0
        ? await fetchBinanceKlines(cfg.interval, Math.min(1000, remaining), earliestOpenMs - 1)
        : null;
    rawKlines = [...(olderBatch ?? []), ...latestBatch];
  }

  if (rawKlines.length === 0) return null;

  const firstDate = new Date(rawKlines[0][0]).toISOString().slice(0, 10);
  const lastDate = new Date(rawKlines[rawKlines.length - 1][0]).toISOString().slice(0, 10);
  const fx = cfg.intraday
    ? { byDate: new Map<string, number>(), latestRate: await fetchLatestUsdCny() }
    : await fetchFxRatesRange(firstDate, lastDate);

  // Build sorted FX lookup so weekend/holiday candles use nearest prior FX rate
  const sortedFxDates = Array.from(fx.byDate.keys()).sort();
  let lastKnownFx = sortedFxDates.length > 0 ? fx.byDate.get(sortedFxDates[0])! : fx.latestRate;

  const bars: PriceBar[] = [];
  const seenKeys = new Set<string | number>();

  for (const k of rawKlines) {
    const ts = Math.floor(k[0] / 1000);
    const oUsd = Number(k[1]);
    const hUsd = Number(k[2]);
    const lUsd = Number(k[3]);
    const cUsd = Number(k[4]);
    if (!Number.isFinite(oUsd) || !Number.isFinite(cUsd)) continue;

    const dt = new Date(k[0]);
    const dateStr = dt.toISOString().slice(0, 10);
    const timeKey = cfg.intraday ? ts : dateStr;
    if (seenKeys.has(timeKey)) continue;
    seenKeys.add(timeKey);

    if (fx.byDate.has(dateStr)) {
      lastKnownFx = fx.byDate.get(dateStr)!;
    }
    const usdCny = cfg.intraday ? fx.latestRate : lastKnownFx;
    const factor = usdCny / GRAMS_PER_TROY_OUNCE;

    bars.push({
      time: cfg.intraday ? dt.toISOString().slice(0, 16).replace('T', ' ') : dateStr,
      timestamp: ts,
      open: Number((oUsd * factor + sgePremiumCny).toFixed(2)),
      high: Number((hUsd * factor + sgePremiumCny).toFixed(2)),
      low: Number((lUsd * factor + sgePremiumCny).toFixed(2)),
      close: Number((cUsd * factor + sgePremiumCny).toFixed(2)),
      openUsd: Number(oUsd.toFixed(2)),
      highUsd: Number(hUsd.toFixed(2)),
      lowUsd: Number(lUsd.toFixed(2)),
      closeUsd: Number(cUsd.toFixed(2)),
      usdCny: Number(usdCny.toFixed(4)),
    });
  }

  bars.sort((a, b) => a.timestamp - b.timestamp);
  return {
    bars,
    source: 'Binance PAXG (伦敦现货黄金1:1映射) · Frankfurter 汇率',
    isLive: true,
  };
}

export async function fetchSpotClient(sgePremiumCny: number): Promise<SpotQuote> {
  const cached = spotClientCache.get(sgePremiumCny);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 1. Try local Express backend first
  const apiSpot = await fetchJsonIfApiAvailable<SpotQuote>(
    `/api/gold/spot?premium=${encodeURIComponent(sgePremiumCny)}`
  );
  if (apiSpot && typeof apiSpot.cnyPerGram === 'number') {
    spotClientCache.set(sgePremiumCny, { expiresAt: Date.now() + 15_000, data: apiSpot });
    return apiSpot;
  }

  // 2. Direct browser CORS-enabled real gold feeds (for GitHub Pages static mode)
  const [usdCnyRate, goldApi, paxgTicker] = await Promise.all([
    fetchLatestUsdCny(),
    fetchJsonWithTimeout<{ price?: number; updatedAt?: string }>(
      'https://api.gold-api.com/price/XAU',
      5000
    ),
    fetchJsonWithTimeout<{
      lastPrice?: string;
      prevClosePrice?: string;
      highPrice?: string;
      lowPrice?: string;
    }>('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=PAXGUSDT', 5000),
  ]);

  const factor = usdCnyRate / GRAMS_PER_TROY_OUNCE;

  if (typeof goldApi?.price === 'number' && goldApi.price > 500) {
    const usdPerOz = goldApi.price;
    const prevUsd = Number(paxgTicker?.prevClosePrice) || usdPerOz;
    const highUsd = Number(paxgTicker?.highPrice) || usdPerOz;
    const lowUsd = Number(paxgTicker?.lowPrice) || usdPerOz;
    const cnyPerGram = Number((usdPerOz * factor + sgePremiumCny).toFixed(2));
    const prevCloseCny = Number((prevUsd * factor + sgePremiumCny).toFixed(2));
    const changeCny = Number((cnyPerGram - prevCloseCny).toFixed(2));
    const changePct = prevCloseCny > 0 ? Number(((changeCny / prevCloseCny) * 100).toFixed(2)) : 0;

    const quote: SpotQuote = {
      cnyPerGram,
      usdPerOz: Number(usdPerOz.toFixed(2)),
      usdCnyRate: Number(usdCnyRate.toFixed(4)),
      prevCloseCny,
      changeCny,
      changePct,
      high24hCny: Number((highUsd * factor + sgePremiumCny).toFixed(2)),
      low24hCny: Number((lowUsd * factor + sgePremiumCny).toFixed(2)),
      updatedAt: goldApi.updatedAt || new Date().toISOString(),
      source: 'Gold-API 实时现货 (XAU/USD · Frankfurter 汇率)',
      isLive: true,
    };
    spotClientCache.set(sgePremiumCny, { expiresAt: Date.now() + 15_000, data: quote });
    return quote;
  }

  if (paxgTicker?.lastPrice && Number(paxgTicker.lastPrice) > 500) {
    const usdPerOz = Number(paxgTicker.lastPrice);
    const prevUsd = Number(paxgTicker.prevClosePrice) || usdPerOz;
    const highUsd = Number(paxgTicker.highPrice) || usdPerOz;
    const lowUsd = Number(paxgTicker.lowPrice) || usdPerOz;
    const cnyPerGram = Number((usdPerOz * factor + sgePremiumCny).toFixed(2));
    const prevCloseCny = Number((prevUsd * factor + sgePremiumCny).toFixed(2));
    const changeCny = Number((cnyPerGram - prevCloseCny).toFixed(2));
    const changePct = prevCloseCny > 0 ? Number(((changeCny / prevCloseCny) * 100).toFixed(2)) : 0;

    const quote: SpotQuote = {
      cnyPerGram,
      usdPerOz: Number(usdPerOz.toFixed(2)),
      usdCnyRate: Number(usdCnyRate.toFixed(4)),
      prevCloseCny,
      changeCny,
      changePct,
      high24hCny: Number((highUsd * factor + sgePremiumCny).toFixed(2)),
      low24hCny: Number((lowUsd * factor + sgePremiumCny).toFixed(2)),
      updatedAt: new Date().toISOString(),
      source: 'Binance PAXG 现货映射 · Frankfurter 汇率',
      isLive: true,
    };
    spotClientCache.set(sgePremiumCny, { expiresAt: Date.now() + 15_000, data: quote });
    return quote;
  }

  return {
    cnyPerGram: 0,
    usdPerOz: 0,
    usdCnyRate,
    prevCloseCny: 0,
    changeCny: 0,
    changePct: 0,
    high24hCny: 0,
    low24hCny: 0,
    updatedAt: new Date().toISOString(),
    source: '无法连接实时行情接口，请检查网络后重试',
    isLive: false,
  };
}

export async function fetchHistoryClient(
  range: string,
  sgePremiumCny: number
): Promise<{ bars: PriceBar[]; source: string; isLive: boolean }> {
  const cacheKey = `${range}_${sgePremiumCny}`;
  const cached = historyClientCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 1. Try local Express backend (Yahoo Finance GC=F + CNY=X)
  const apiRes = await fetchJsonIfApiAvailable<{
    bars?: PriceBar[];
    source?: string;
    isLive?: boolean;
  }>(`/api/gold/history?range=${encodeURIComponent(range)}&premium=${encodeURIComponent(sgePremiumCny)}`);

  if (apiRes && Array.isArray(apiRes.bars) && apiRes.bars.length > 0 && apiRes.isLive) {
    const result = {
      bars: apiRes.bars,
      source: apiRes.source ?? 'Yahoo Finance (COMEX GC=F · USD/CNY)',
      isLive: true,
    };
    historyClientCache.set(cacheKey, {
      expiresAt: Date.now() + (range === '1D' || range === '1W' ? 60_000 : 300_000),
      data: result,
    });
    return result;
  }

  // 2. Direct browser CORS-enabled real historical candles (GitHub Pages mode)
  const browserReal = await fetchRealBrowserHistory(range, sgePremiumCny);
  if (browserReal && browserReal.bars.length > 0) {
    historyClientCache.set(cacheKey, {
      expiresAt: Date.now() + (range === '1D' || range === '1W' ? 60_000 : 300_000),
      data: browserReal,
    });
    return browserReal;
  }

  // 3. If backend returned cached bars even with isLive=false, use them rather than empty
  if (apiRes && Array.isArray(apiRes.bars) && apiRes.bars.length > 0) {
    return {
      bars: apiRes.bars,
      source: apiRes.source ?? '离线缓存行情',
      isLive: false,
    };
  }

  return {
    bars: [],
    source: '未能获取真实历史行情数据，请检查网络或开启本地服务代理',
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

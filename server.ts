import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

interface PriceBar {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  openUsd: number;
  highUsd: number;
  lowUsd: number;
  closeUsd: number;
  usdCny: number;
}

interface SpotQuote {
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

const spotCache = new Map<number, { expiresAt: number; data: SpotQuote }>();
const historyCache = new Map<string, { expiresAt: number; bars: PriceBar[]; source: string; isLive: boolean }>();

let lastLedgerHash = '';

function hashData(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// Deterministic realistic fallback gold series when outbound network is unavailable
function generateFallbackHistory(range: string, sgePremiumCny: number): PriceBar[] {
  const now = new Date();
  const daysMap: Record<string, number> = {
    '1D': 1,
    '1W': 7,
    '1M': 30,
    '3M': 90,
    '1Y': 365,
    '3Y': 1095,
    '5Y': 1825,
  };
  const totalDays = daysMap[range] ?? 365;

  // Intraday points for 1D or 1W
  if (range === '1D' || range === '1W') {
    const stepSeconds = range === '1D' ? 900 : 3600; // 15m or 1h
    const totalPoints = range === '1D' ? 96 : 168;
    const endTs = Math.floor(now.getTime() / stepSeconds / 1000) * stepSeconds;
    const bars: PriceBar[] = [];
    let usdPrice = 2718.5;
    const usdCny = 7.235;

    for (let i = totalPoints; i >= 0; i--) {
      const ts = endTs - i * stepSeconds;
      const seed = Math.sin(ts * 0.00017) * 0.55 + Math.cos(ts * 0.00043) * 0.35;
      const openUsd = usdPrice;
      const delta = seed * 3.8 + (Math.sin(i * 0.31) * 1.9);
      const closeUsd = Math.max(2550, openUsd + delta);
      const highUsd = Math.max(openUsd, closeUsd) + Math.abs(Math.sin(i * 1.7)) * 2.4;
      const lowUsd = Math.min(openUsd, closeUsd) - Math.abs(Math.cos(i * 1.3)) * 2.4;
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

  // Daily series anchored across 2021-2026 bull cycle
  const bars: PriceBar[] = [];
  const startDate = new Date(now.getTime() - totalDays * 86400 * 1000);
  const startYearRatio = Math.max(0, 1 - totalDays / 1825);
  let usdPrice = 1780 + startYearRatio * 920; // ~1780 in 2021 -> ~2700+ in 2026
  const seenDates = new Set<string>();

  for (let d = 0; d <= totalDays; d++) {
    const dt = new Date(startDate.getTime() + d * 86400 * 1000);
    const dayOfWeek = dt.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = dt.toISOString().slice(0, 10);
    if (seenDates.has(dateStr)) continue;
    seenDates.add(dateStr);

    const progress = d / Math.max(1, totalDays);
    const secularTrend = (2735 - (1780 + startYearRatio * 920)) / Math.max(1, totalDays * 0.71);
    const macroWave =
      Math.sin(d * 0.045) * 14 +
      Math.cos(d * 0.13) * 7.5 +
      Math.sin(d * 0.41) * 4.2;

    const openUsd = usdPrice;
    const target = (1780 + startYearRatio * 920) + secularTrend * d + macroWave + progress * 25;
    const closeUsd = Math.max(1650, openUsd * 0.65 + target * 0.35 + Math.sin(d * 1.13) * 9.5);
    const highUsd = Math.max(openUsd, closeUsd) + 4 + Math.abs(Math.sin(d * 2.1)) * 12;
    const lowUsd = Math.min(openUsd, closeUsd) - 4 - Math.abs(Math.cos(d * 1.7)) * 11;
    usdPrice = closeUsd;

    const usdCny = Number((7.08 + Math.sin(d * 0.015) * 0.14 + progress * 0.08).toFixed(4));
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

interface YahooChartResult {
  meta?: {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
    }>;
  };
}

async function fetchYahooChart(symbol: string, range: string, interval: string): Promise<YahooChartResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AuLedger/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { chart?: { result?: YahooChartResult[] } };
    return json.chart?.result?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getLiveSpotQuote(sgePremiumCny: number): Promise<SpotQuote> {
  const cached = spotCache.get(sgePremiumCny);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Try Yahoo Finance GC=F + CNY=X
  const [goldRes, fxRes] = await Promise.all([
    fetchYahooChart('GC=F', '2d', '15m'),
    fetchYahooChart('CNY=X', '2d', '1h'),
  ]);

  if (goldRes?.meta?.regularMarketPrice) {
    const usdPerOz = goldRes.meta.regularMarketPrice;
    const usdCnyRate = fxRes?.meta?.regularMarketPrice ?? 7.23;
    const prevCloseUsd = goldRes.meta.chartPreviousClose ?? goldRes.meta.previousClose ?? usdPerOz;
    const factor = usdCnyRate / GRAMS_PER_TROY_OUNCE;

    const cnyPerGram = Number((usdPerOz * factor + sgePremiumCny).toFixed(2));
    const prevCloseCny = Number((prevCloseUsd * factor + sgePremiumCny).toFixed(2));
    const changeCny = Number((cnyPerGram - prevCloseCny).toFixed(2));
    const changePct = prevCloseCny > 0 ? Number(((changeCny / prevCloseCny) * 100).toFixed(2)) : 0;

    const high24hUsd = goldRes.meta.regularMarketDayHigh ?? usdPerOz;
    const low24hUsd = goldRes.meta.regularMarketDayLow ?? usdPerOz;

    const quote: SpotQuote = {
      cnyPerGram,
      usdPerOz: Number(usdPerOz.toFixed(2)),
      usdCnyRate: Number(usdCnyRate.toFixed(4)),
      prevCloseCny,
      changeCny,
      changePct,
      high24hCny: Number((high24hUsd * factor + sgePremiumCny).toFixed(2)),
      low24hCny: Number((low24hUsd * factor + sgePremiumCny).toFixed(2)),
      updatedAt: new Date().toISOString(),
      source: 'Yahoo Finance (COMEX GC=F · USD/CNY)',
      isLive: true,
    };

    spotCache.set(sgePremiumCny, { expiresAt: Date.now() + 20_000, data: quote });
    return quote;
  }

  // Secondary fallback: goldprice.org
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const gpRes = await fetch('https://data-asg.goldprice.org/dbXRates/USD,CNY', {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeout);
    if (gpRes.ok) {
      const gp = (await gpRes.json()) as {
        items?: Array<{ curr: string; xauPrice: number; xauClose: number; chgXau: number; pcXau: number }>;
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

        const quote: SpotQuote = {
          cnyPerGram,
          usdPerOz: Number(usdPerOz.toFixed(2)),
          usdCnyRate,
          prevCloseCny,
          changeCny,
          changePct,
          high24hCny: Number((cnyPerGram + Math.abs(changeCny) * 0.4).toFixed(2)),
          low24hCny: Number((cnyPerGram - Math.abs(changeCny) * 0.4).toFixed(2)),
          updatedAt: new Date().toISOString(),
          source: 'GoldPrice Spot Feed (XAU/CNY)',
          isLive: true,
        };
        spotCache.set(sgePremiumCny, { expiresAt: Date.now() + 20_000, data: quote });
        return quote;
      }
    }
  } catch {
    // Fall through to deterministic benchmark
  }

  // Local benchmark fallback with gentle realistic intraday micro-tick
  const fallbackBars = generateFallbackHistory('1D', sgePremiumCny);
  const last = fallbackBars[fallbackBars.length - 1];
  const first = fallbackBars[0];
  const jitter = Number((Math.sin(Date.now() / 15000) * 0.35).toFixed(2));
  const cnyPerGram = Number((last.close + jitter).toFixed(2));
  const usdPerOz = Number((last.closeUsd + jitter * 4.2).toFixed(2));
  const prevCloseCny = first.close;
  const changeCny = Number((cnyPerGram - prevCloseCny).toFixed(2));
  const changePct = Number(((changeCny / prevCloseCny) * 100).toFixed(2));

  const quote: SpotQuote = {
    cnyPerGram,
    usdPerOz,
    usdCnyRate: last.usdCny,
    prevCloseCny,
    changeCny,
    changePct,
    high24hCny: Math.max(...fallbackBars.map((b) => b.high)),
    low24hCny: Math.min(...fallbackBars.map((b) => b.low)),
    updatedAt: new Date().toISOString(),
    source: '本地行情基准引擎 (离线模式)',
    isLive: false,
  };
  spotCache.set(sgePremiumCny, { expiresAt: Date.now() + 10_000, data: quote });
  return quote;
}

async function getGoldHistory(range: string, sgePremiumCny: number): Promise<{ bars: PriceBar[]; source: string; isLive: boolean }> {
  const cacheKey = `${range}_${sgePremiumCny}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { bars: cached.bars, source: cached.source, isLive: cached.isLive };
  }

  const yahooMapping: Record<string, { yRange: string; interval: string; intraday: boolean }> = {
    '1D': { yRange: '1d', interval: '15m', intraday: true },
    '1W': { yRange: '5d', interval: '1h', intraday: true },
    '1M': { yRange: '1mo', interval: '1d', intraday: false },
    '3M': { yRange: '3mo', interval: '1d', intraday: false },
    '1Y': { yRange: '1y', interval: '1d', intraday: false },
    '3Y': { yRange: '3y', interval: '1d', intraday: false },
    '5Y': { yRange: '5y', interval: '1d', intraday: false },
  };

  const cfg = yahooMapping[range] ?? yahooMapping['1Y'];
  const [goldRes, fxRes] = await Promise.all([
    fetchYahooChart('GC=F', cfg.yRange, cfg.interval),
    fetchYahooChart('CNY=X', cfg.yRange, cfg.intraday ? '1h' : '1d'),
  ]);

  if (goldRes?.timestamp && goldRes.indicators?.quote?.[0]) {
    const timestamps = goldRes.timestamp;
    const q = goldRes.indicators.quote[0];

    // Build FX lookup by date or nearest timestamp
    const fxByDate = new Map<string, number>();
    let latestFx = fxRes?.meta?.regularMarketPrice ?? 7.23;
    if (fxRes?.timestamp && fxRes.indicators?.quote?.[0]?.close) {
      const fxTs = fxRes.timestamp;
      const fxClose = fxRes.indicators.quote[0].close;
      for (let i = 0; i < fxTs.length; i++) {
        const c = fxClose[i];
        if (typeof c === 'number' && Number.isFinite(c) && c > 5) {
          const dStr = new Date(fxTs[i] * 1000).toISOString().slice(0, 10);
          fxByDate.set(dStr, c);
          latestFx = c;
        }
      }
    }

    const bars: PriceBar[] = [];
    const seenKeys = new Set<string | number>();

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      if (
        typeof o !== 'number' ||
        typeof h !== 'number' ||
        typeof l !== 'number' ||
        typeof c !== 'number' ||
        !Number.isFinite(o) ||
        !Number.isFinite(c)
      ) {
        continue;
      }

      const dt = new Date(ts * 1000);
      const dateStr = dt.toISOString().slice(0, 10);
      const timeKey = cfg.intraday ? ts : dateStr;
      if (seenKeys.has(timeKey)) continue;
      seenKeys.add(timeKey);

      const usdCny = fxByDate.get(dateStr) ?? latestFx;
      const factor = usdCny / GRAMS_PER_TROY_OUNCE;

      bars.push({
        time: cfg.intraday ? dt.toISOString().slice(0, 16).replace('T', ' ') : dateStr,
        timestamp: ts,
        open: Number((o * factor + sgePremiumCny).toFixed(2)),
        high: Number((h * factor + sgePremiumCny).toFixed(2)),
        low: Number((l * factor + sgePremiumCny).toFixed(2)),
        close: Number((c * factor + sgePremiumCny).toFixed(2)),
        openUsd: Number(o.toFixed(2)),
        highUsd: Number(h.toFixed(2)),
        lowUsd: Number(l.toFixed(2)),
        closeUsd: Number(c.toFixed(2)),
        usdCny: Number(usdCny.toFixed(4)),
      });
    }

    if (bars.length > 5) {
      bars.sort((a, b) => a.timestamp - b.timestamp);
      const result = {
        bars,
        source: 'Yahoo Finance (COMEX GC=F · USD/CNY)',
        isLive: true,
      };
      historyCache.set(cacheKey, {
        expiresAt: Date.now() + (cfg.intraday ? 60_000 : 600_000),
        ...result,
      });
      return result;
    }
  }

  const fallbackBars = generateFallbackHistory(range, sgePremiumCny);
  const result = {
    bars: fallbackBars,
    source: '本地行情基准引擎 (离线模式)',
    isLive: false,
  };
  historyCache.set(cacheKey, { expiresAt: Date.now() + 120_000, ...result });
  return result;
}

interface StoredLedger {
  accounts?: Array<unknown>;
  transactions?: Array<{ grams?: number; side?: string }>;
  settings?: { autoBackupEnabled?: boolean; maxBackupSnapshots?: number };
}

function createBackupFile(reason: string, contentObj: StoredLedger): string {
  ensureDataDirs();
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${safeReason}_${stamp}.json`;
  const payload = {
    meta: {
      reason,
      createdAt: new Date().toISOString(),
    },
    ledger: contentObj,
  };
  fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(payload, null, 2), 'utf-8');
  return filename;
}

function pruneAutoBackups(maxSnapshots: number) {
  ensureDataDirs();
  const limit = Math.max(5, Math.min(100, maxSnapshots || 25));
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json') && f.startsWith('auto_'))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (let i = limit; i < files.length; i++) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, files[i].name));
    } catch {
      // ignore unlink failures
    }
  }
}

function listBackups() {
  ensureDataDirs();
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((filename) => {
      const fullPath = path.join(BACKUP_DIR, filename);
      const stat = fs.statSync(fullPath);
      let reason = 'auto';
      let createdAt = stat.mtime.toISOString();
      let accountCount = 0;
      let transactionCount = 0;
      let totalGrams = 0;

      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as {
          meta?: { reason?: string; createdAt?: string };
          ledger?: StoredLedger;
        };
        const ledger = parsed.ledger ?? (parsed as unknown as StoredLedger);
        reason = parsed.meta?.reason ?? (filename.startsWith('manual') ? 'manual' : 'auto');
        createdAt = parsed.meta?.createdAt ?? createdAt;
        accountCount = Array.isArray(ledger.accounts) ? ledger.accounts.length : 0;
        const txs = Array.isArray(ledger.transactions) ? ledger.transactions : [];
        transactionCount = txs.length;
        for (const t of txs) {
          if (typeof t.grams === 'number') {
            totalGrams += t.side === 'sell' ? -t.grams : t.grams;
          }
        }
      } catch {
        // fallback metadata
      }

      return {
        filename,
        createdAt,
        reason,
        sizeBytes: stat.size,
        accountCount,
        transactionCount,
        totalGrams: Number(Math.max(0, totalGrams).toFixed(3)),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return files;
}

async function startServer() {
  ensureDataDirs();
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Market data endpoints
  app.get('/api/gold/spot', async (req, res) => {
    const premium = Number(req.query.premium ?? 2.5);
    const sgePremium = Number.isFinite(premium) ? premium : 2.5;
    const quote = await getLiveSpotQuote(sgePremium);
    res.json(quote);
  });

  app.get('/api/gold/history', async (req, res) => {
    const range = String(req.query.range ?? '1Y').toUpperCase();
    const premium = Number(req.query.premium ?? 2.5);
    const sgePremium = Number.isFinite(premium) ? premium : 2.5;
    const data = await getGoldHistory(range, sgePremium);
    res.json(data);
  });

  // Local ledger persistence
  app.get('/api/ledger', (_req, res) => {
    ensureDataDirs();
    if (!fs.existsSync(LEDGER_FILE)) {
      res.json({ exists: false, ledger: null });
      return;
    }
    try {
      const raw = fs.readFileSync(LEDGER_FILE, 'utf-8');
      const ledger = JSON.parse(raw);
      lastLedgerHash = hashData({
        accounts: ledger.accounts,
        transactions: ledger.transactions,
      });
      res.json({ exists: true, ledger });
    } catch {
      res.status(500).json({ error: '读取本地账本失败' });
    }
  });

  app.post('/api/ledger', (req, res) => {
    ensureDataDirs();
    const { ledger, createAutoBackup = true, reason = 'auto_sync' } = req.body as {
      ledger: StoredLedger;
      createAutoBackup?: boolean;
      reason?: string;
    };
    if (!ledger || typeof ledger !== 'object') {
      res.status(400).json({ error: '无效的账本数据' });
      return;
    }

    const tmpFile = `${LEDGER_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(ledger, null, 2), 'utf-8');
    fs.renameSync(tmpFile, LEDGER_FILE);

    const contentHash = hashData({
      accounts: ledger.accounts,
      transactions: ledger.transactions,
    });

    let backupCreated: string | null = null;
    const autoEnabled = ledger.settings?.autoBackupEnabled !== false;
    if (createAutoBackup && autoEnabled && contentHash !== lastLedgerHash) {
      backupCreated = createBackupFile(reason.startsWith('auto') ? reason : `auto_${reason}`, ledger);
      pruneAutoBackups(ledger.settings?.maxBackupSnapshots ?? 25);
      lastLedgerHash = contentHash;
    }

    res.json({
      saved: true,
      updatedAt: new Date().toISOString(),
      backupCreated,
    });
  });

  // Auto & manual backup endpoints
  app.get('/api/backups', (_req, res) => {
    res.json({ backups: listBackups() });
  });

  app.post('/api/backups/create', (req, res) => {
    ensureDataDirs();
    const { reason = 'manual_snapshot', ledger } = req.body as {
      reason?: string;
      ledger?: StoredLedger;
    };

    let targetLedger = ledger;
    if (!targetLedger && fs.existsSync(LEDGER_FILE)) {
      targetLedger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')) as StoredLedger;
    }
    if (!targetLedger) {
      res.status(400).json({ error: '当前没有可备份的账本数据' });
      return;
    }

    const filename = createBackupFile(`manual_${reason}`, targetLedger);
    res.json({ filename, backups: listBackups() });
  });

  app.post('/api/backups/restore', (req, res) => {
    ensureDataDirs();
    const { filename } = req.body as { filename: string };
    const safeName = path.basename(String(filename || ''));
    const fullPath = path.join(BACKUP_DIR, safeName);
    if (!safeName || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: '未找到指定快照文件' });
      return;
    }

    // Pre-restore safety snapshot
    if (fs.existsSync(LEDGER_FILE)) {
      try {
        const current = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')) as StoredLedger;
        createBackupFile('pre_restore', current);
      } catch {
        // continue restore
      }
    }

    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as {
      ledger?: StoredLedger;
    };
    const restoredLedger = parsed.ledger ?? (parsed as unknown as StoredLedger);
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(restoredLedger, null, 2), 'utf-8');
    lastLedgerHash = hashData({
      accounts: restoredLedger.accounts,
      transactions: restoredLedger.transactions,
    });

    res.json({ restored: true, ledger: restoredLedger, backups: listBackups() });
  });

  app.delete('/api/backups/:filename', (req, res) => {
    ensureDataDirs();
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(BACKUP_DIR, safeName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    res.json({ deleted: true, backups: listBackups() });
  });

  app.get('/api/backups/download/:filename', (req, res) => {
    ensureDataDirs();
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(BACKUP_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: '文件不存在' });
      return;
    }
    res.download(fullPath, safeName);
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AuLedger server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

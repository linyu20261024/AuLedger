import type { ColorConvention } from '../types/gold';

export function formatCny(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '¥0.00';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value < 0 ? `-¥${formatted}` : `¥${formatted}`;
}

export function formatSignedCny(value: number, decimals = 2): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return '¥0.00';
  const abs = Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value > 0 ? `+¥${abs}` : `-¥${abs}`;
}

export function formatGrams(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0.00 g';
  return `${value.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} g`;
}

export function formatSignedPct(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '$0.00';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Returns semantic trend color classes respecting Chinese (Red Up / Green Down)
 * or International (Green Up / Red Down) convention.
 */
export function getTrendTextClass(value: number, convention: ColorConvention): string {
  if (Math.abs(value) < 1e-6) return 'text-slate-500 dark:text-slate-400';
  const isUp = value > 0;
  if (convention === 'cn') {
    return isUp
      ? 'text-[#DC2626] dark:text-[#F87171]'
      : 'text-[#16A34A] dark:text-[#4ADE80]';
  }
  return isUp
    ? 'text-[#16A34A] dark:text-[#4ADE80]'
    : 'text-[#DC2626] dark:text-[#F87171]';
}

export function getTrendSurfaceClass(value: number, convention: ColorConvention): string {
  if (Math.abs(value) < 1e-6) {
    return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }
  const isUp = value > 0;
  if (convention === 'cn') {
    return isUp
      ? 'bg-red-50 text-[#B91C1C] dark:bg-red-950/50 dark:text-[#FCA5A5]'
      : 'bg-emerald-50 text-[#15803D] dark:bg-emerald-950/50 dark:text-[#86EFAC]';
  }
  return isUp
    ? 'bg-emerald-50 text-[#15803D] dark:bg-emerald-950/50 dark:text-[#86EFAC]'
    : 'bg-red-50 text-[#B91C1C] dark:bg-red-950/50 dark:text-[#FCA5A5]';
}

export function getTrendChartColors(convention: ColorConvention): {
  upColor: string;
  downColor: string;
} {
  if (convention === 'cn') {
    return { upColor: '#DC2626', downColor: '#16A34A' };
  }
  return { upColor: '#16A34A', downColor: '#DC2626' };
}

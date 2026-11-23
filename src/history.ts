import type { SyncHistoryEntry, SyncItem } from './types';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

export function retainHistory(entries: SyncHistoryEntry[], now = Date.now()): SyncHistoryEntry[] {
  return entries.filter(entry => (entry.finishedAt || entry.startedAt) >= now - RETENTION_MS);
}

export function normalizeHistory(value: unknown, now = Date.now()): SyncHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value.flatMap(raw => {
    const entry = record(raw);
    if (typeof entry.id !== 'string' || typeof entry.startedAt !== 'number') return [];
    const finishedAt = typeof entry.finishedAt === 'number' && entry.finishedAt > 0 ? entry.finishedAt : now;
    const interrupted = entry.status === 'running';
    const status = interrupted ? 'cancelled' : ['success', 'partial', 'failed', 'cancelled'].includes(String(entry.status)) ? entry.status as SyncHistoryEntry['status'] : 'failed';
    const items: SyncItem[] = Array.isArray(entry.items) ? entry.items.flatMap(rawItem => {
      const item = record(rawItem);
      if (typeof item.id !== 'string' || !['created', 'updated', 'skipped', 'failed'].includes(String(item.status))) return [];
      return [{ id: item.id, title: typeof item.title === 'string' ? item.title : item.id, status: item.status as SyncItem['status'], ...(typeof item.error === 'string' ? { error: item.error } : {}) }];
    }) : [];
    return [{
      id: entry.id, startedAt: entry.startedAt, finishedAt,
      durationMs: Math.max(0, finishedAt - entry.startedAt), source: entry.source === 'auto' ? 'auto' : 'manual', status,
      created: count(entry.created), updated: count(entry.updated), skipped: count(entry.skipped), failed: count(entry.failed), total: count(entry.total),
      items, limited: entry.limited === true,
      ...(typeof entry.scopeLabel === 'string' ? { scopeLabel: entry.scopeLabel } : {}),
      ...(interrupted ? { error: '上次任务因插件重载或退出而中断，已保留完成结果' } : typeof entry.error === 'string' ? { error: entry.error } : {}),
    } satisfies SyncHistoryEntry];
  });
  return retainHistory(entries, now);
}

import { expect, it } from 'vitest';
import { normalizeHistory, retainHistory } from '../src/history';

const now = Date.UTC(2026, 9, 15);
const entry = { id: 'one', startedAt: now - 1000, finishedAt: now, source: 'manual', status: 'success', created: 1, updated: 0, skipped: 0, failed: 0, total: 1, items: [{ id: '123', title: '示例', status: 'created' }], limited: false };

it('keeps recent useful records and expires records older than 30 days', () => {
  const records = normalizeHistory([entry, { ...entry, id: 'old', finishedAt: now - 31 * 86400000 }], now);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ id: 'one', durationMs: 1000, items: [{ id: '123', title: '示例', status: 'created' }] });
  expect(retainHistory(records, now + 31 * 86400000)).toEqual([]);
});

it('recovers an interrupted running job as cancelled instead of leaving it active forever', () => {
  const records = normalizeHistory([{ ...entry, status: 'running', finishedAt: 0 }], now);
  expect(records[0]).toMatchObject({ status: 'cancelled', created: 1 });
});

it('retains a full month of hourly records instead of silently dropping recent records after 200 jobs', () => {
  const entries = Array.from({ length: 720 }, (_, index) => ({ ...entry, id: String(index), startedAt: now - index * 3600000 - 1000, finishedAt: now - index * 3600000 }));
  expect(normalizeHistory(entries, now)).toHaveLength(720);
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { SyncHistoryEntry } from '../src/types';
import { openSyncHistoryModal } from '../src/ui/sync-history-modal';

const modals = vi.hoisted(() => [] as { contentEl: HTMLElement; onClose?: () => void }[]);
vi.mock('obsidian', () => ({ Modal: class {
  contentEl = document.createElement('div');
  constructor() { modals.push(this); }
  onOpen() {}
  open() { document.body.append(this.contentEl); this.onOpen(); }
} }));
afterEach(() => { modals.splice(0); document.body.replaceChildren(); });

function entry(overrides: Partial<SyncHistoryEntry> = {}): SyncHistoryEntry {
  return { id: 'a', startedAt: 1000, finishedAt: 2000, durationMs: 1000,
    source: 'manual', status: 'success', created: 0, updated: 0, skipped: 0, failed: 0,
    total: 0, items: [], limited: false, ...overrides };
}

it('separates run context, counts, writes and failure reasons using the sister-plugin layout', () => {
  openSyncHistoryModal({} as App, [entry({ status: 'partial', created: 1, updated: 1, skipped: 1, failed: 1,
    total: 4, items: [
      { id: '1', title: '新对话', status: 'created' }, { id: '2', title: '更新对话', status: 'updated' },
      { id: '3', title: '无变化对话', status: 'skipped' },
      { id: '4', title: '<script>坏标题</script>', status: 'failed', error: '正文边界缺失' },
    ] })]);
  const root = document.body;
  expect(root.querySelector('.doubao-history-header-context')?.textContent).toContain('手动 · 同步对话');
  expect(root.querySelector('.doubao-history-status-text')?.textContent).toBe('部分失败');
  expect(root.querySelectorAll('.doubao-history-meta-item')).toHaveLength(4);
  expect(root.querySelector('.doubao-history-meta-grid')?.textContent).toContain('最近会话范围');
  expect(Array.from(root.querySelectorAll('.doubao-history-summary-card')).map(el => el.textContent))
    .toEqual(['新增 1', '更新 1', '跳过 1', '失败 1']);
  expect(Array.from(root.querySelectorAll('.doubao-history-status-pill')).map(el => el.textContent)).toEqual(['新增', '更新']);
  expect(root.querySelector('.doubao-history-item-summary.failed')?.textContent).toBe('失败 1');
  expect(root.querySelector('.doubao-history-item-summary.skipped')?.textContent).toBe('跳过 1');
  expect(root.querySelector('.doubao-history-error')?.textContent).toBe('正文边界缺失');
  expect(root.querySelector('script')).toBeNull();
  expect(root.textContent).toContain('<script>坏标题</script>');
});

it('keeps unchanged skip counts and labels the real automatic scope without invented filters', () => {
  openSyncHistoryModal({} as App, [entry({ source: 'auto', skipped: 49, total: 49, limited: true })]);
  expect(document.querySelector('summary')?.textContent).toContain('无需同步');
  expect(document.querySelector('summary')?.textContent).toContain('跳过 49');
  expect(document.querySelector('.doubao-history-meta-grid')?.textContent).toContain('自动 · 自动同步');
  expect(document.body.textContent).toContain('200 条上限');
  expect(document.body.textContent).toContain('最近 30 天');
  expect(document.body.textContent).toContain('不保存对话正文');
  expect(document.body.textContent).not.toContain('笔记类型');
});

it('paginates five runs, opens the newest and abnormal runs, and cleans content on close', () => {
  const history = Array.from({ length: 7 }, (_, index) => entry({ id: String(index), startedAt: index * 1000,
    finishedAt: index * 1000 + 999, status: index === 4 ? 'failed' : 'success' }));
  openSyncHistoryModal({} as App, history);
  const runs = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('.doubao-history-entry'));
  expect(runs()).toHaveLength(5);
  expect(runs().map(el => el.open)).toEqual([true, false, true, false, false]);
  const next = Array.from(document.querySelectorAll('button')).find(el => el.textContent === '下一页')!;
  next.click();
  expect(runs()).toHaveLength(2);
  expect(runs().every(el => !el.open)).toBe(true);
  expect(document.querySelector('.doubao-history-page-label')?.textContent).toBe('第 2 / 2 页');
  expect(Array.from(document.querySelectorAll('button')).find(el => el.textContent === '下一页')?.disabled).toBe(true);
  modals[0].onClose?.();
  expect(modals[0].contentEl.childElementCount).toBe(0);
  expect(history[0].id).toBe('0');
});

it('shows the shared empty-log wording', () => {
  openSyncHistoryModal({} as App, []);
  expect(document.querySelector('.doubao-history-empty')?.textContent).toBe('暂无同步日志');
});

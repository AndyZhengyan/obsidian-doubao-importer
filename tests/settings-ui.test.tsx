// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import type { App, Plugin } from 'obsidian';
import type { SettingsActions, SettingsView, SyncHistoryEntry } from '../src/types';
import { DoubaoSettingsTab } from '../src/settings-tab';
import { openSyncHistoryModal } from '../src/ui/sync-history-modal';

// Obsidian ships runtime DOM containers inside the host app, not its npm types.
vi.mock('obsidian', () => ({
  PluginSettingTab: class { containerEl = document.createElement('div'); constructor(public app: unknown) {} },
  AbstractInputSuggest: class { close() {} },
  Modal: class {
    contentEl = document.createElement('div');
    onOpen() {}
    open() { document.body.append(this.contentEl); this.onOpen(); }
  },
}));

const tabs: DoubaoSettingsTab[] = [];
afterEach(() => { act(() => { tabs.splice(0).forEach(tab => tab.hide()); }); document.body.replaceChildren(); });

function setup(connection: SettingsView['connection'] = 'connected') {
  const view: SettingsView = {
    settings: { folder: '豆包/对话', intervalMinutes: 60, scheduledEnabled: false, syncOnStart: false,
      checkpoints: {}, messageVersions: {}, lastSyncAt: '', lastSummary: '', syncHistory: [] },
    connection, connectionMessage: '', task: { running: false, phase: 'idle', message: '', processed: 0 },
  };
  let cancelled = false;
  let syncs = 0;
  const actions: SettingsActions = { login() {}, async logout() {}, async checkConnection() {},
    async sync() { syncs++; }, cancel() { cancelled = true; },
    async update(key, value) { Object.assign(view.settings, { [key]: value }); },
    folders: () => ['豆包/对话', '已有目录'], showHistory() {},
  };
  const tab = new DoubaoSettingsTab({} as App, {} as Plugin, () => view, actions);
  tabs.push(tab);
  document.body.append(tab.containerEl);
  act(() => tab.display());
  return { view, actions, tab, cancelled: () => cancelled, syncs: () => syncs };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find(el => el.textContent === text);
  expect(found, `button ${text}`).toBeDefined();
  return found!;
}

it('refreshes progress without losing input, focus, caret, disclosure or scroll', async () => {
  const { tab, view } = setup();
  const root = tab.containerEl;
  const folder = root.querySelector('input[aria-label="目标文件夹"]') as HTMLInputElement;
  expect(folder).not.toBeNull();
  await act(() => { folder.value = '尚未保存的新目录'; folder.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => (root.querySelector('[data-schedule-disclosure]') as HTMLButtonElement).click());
  folder.focus(); folder.setSelectionRange(2, 5); root.scrollTop = 320;
  view.task = { running: true, phase: 'reading', message: '正在读取', processed: 2, total: 49,
    currentTitle: '长对话', page: 314, messageCount: 15704 };
  act(() => { tab.updateRuntimeState(); tab.display(); });
  expect(root.querySelector('input[aria-label="目标文件夹"]')).toBe(folder);
  expect(folder.value).toBe('尚未保存的新目录');
  expect(document.activeElement).toBe(folder);
  expect(folder.selectionStart).toBe(2);
  expect(root.scrollTop).toBe(320);
  expect(root.querySelector('[data-schedule-disclosure]')?.getAttribute('aria-expanded')).toBe('true');
  expect(root.textContent).toContain('第 314 页');
  expect(root.textContent).toContain('15704 条消息');
  expect(root.textContent).toContain('2 / 49');
  expect(root.querySelector('[role="status"]')?.textContent).toBeTruthy();
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('4');
});

it('keeps credentials collapsed after connection and exposes them through the status bar', () => {
  const { tab, view } = setup();
  const panel = tab.containerEl.querySelector('[data-credential-details]') as HTMLElement;
  expect(panel).not.toBeNull();
  expect(panel.hidden).toBe(true);
  act(() => button(tab.containerEl, '更改凭证').click());
  expect(panel.hidden).toBe(false);
  view.connection = 'expired';
  act(() => tab.updateRuntimeState());
  expect(panel.hidden).toBe(false);
  expect(button(tab.containerEl, '同步对话').disabled).toBe(true);
  expect(tab.containerEl.textContent).toContain('重新登录');
});

it('preserves collapsed sync and advanced sections while task state refreshes', () => {
  const { tab, view } = setup();
  const sync = tab.containerEl.querySelector('[data-sync-disclosure]') as HTMLButtonElement;
  const advanced = tab.containerEl.querySelector('[data-advanced-disclosure]') as HTMLButtonElement;
  expect(sync?.getAttribute('aria-expanded')).toBe('true');
  expect(advanced?.getAttribute('aria-expanded')).toBe('false');
  act(() => { sync.click(); advanced.click(); });
  view.task = { running: true, phase: 'listing', message: '获取会话列表…', processed: 0 };
  act(() => tab.updateRuntimeState());
  expect(sync.getAttribute('aria-expanded')).toBe('false');
  expect(advanced.getAttribute('aria-expanded')).toBe('true');
  expect(tab.containerEl.querySelector('[data-sync-settings]')?.hasAttribute('hidden')).toBe(true);
  const progress = tab.containerEl.querySelector('[role="progressbar"]');
  expect(progress).not.toBeNull();
  expect(progress?.hasAttribute('aria-valuenow')).toBe(false);
});

it('edits any valid minute interval without replacing it with a fixed choice', async () => {
  const { tab, view } = setup();
  view.settings.intervalMinutes = 45;
  act(() => tab.updateRuntimeState());
  const toggle = tab.containerEl.querySelector('[aria-controls][data-schedule-disclosure]') as HTMLButtonElement;
  expect(toggle).not.toBeNull();
  act(() => toggle.click());
  const period = tab.containerEl.querySelector('input[type="number"]') as HTMLInputElement;
  expect(period?.value).toBe('45');
  await act(async () => { period.value = '15'; period.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(view.settings.intervalMinutes).toBe(15);
  await act(async () => { period.value = ''; period.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(view.settings.intervalMinutes).toBe(15);
  expect(period.getAttribute('aria-invalid')).toBe('true');
});

it('allows reopening a dismissed login window instead of leaving login permanently disabled', () => {
  const { tab, view, actions } = setup('unverified');
  let reopened = false;
  actions.login = () => { reopened = true; };
  view.connectionMessage = '请在豆包窗口完成登录';
  act(() => tab.updateRuntimeState());
  const login = button(tab.containerEl, '继续网页登录');
  expect(login.disabled).toBe(false);
  act(() => login.click());
  expect(reopened).toBe(true);
});

it('prevents repeated sync while running, exposes cancel and renders the cancelled result', async () => {
  const context = setup();
  await act(async () => { button(context.tab.containerEl, '同步对话').click(); });
  expect(context.syncs()).toBe(1);
  context.view.task = { running: true, phase: 'reading', message: '正在读取', processed: 1 };
  act(() => context.tab.updateRuntimeState());
  expect(button(context.tab.containerEl, '同步对话').disabled).toBe(true);
  expect(button(context.tab.containerEl, '网页登录').disabled).toBe(true);
  expect(button(context.tab.containerEl, '测试连接').disabled).toBe(true);
  act(() => button(context.tab.containerEl, '取消同步').click());
  expect(context.cancelled()).toBe(true);
  context.view.task = { running: false, phase: 'cancelled', message: '已取消，已完成的对话已保留', processed: 1 };
  act(() => context.tab.updateRuntimeState());
  expect(context.tab.containerEl.textContent).toContain('已取消，已完成的对话已保留');
  expect(Array.from(context.tab.containerEl.querySelectorAll('button')).some(el => el.textContent === '取消同步')).toBe(false);
  expect(button(context.tab.containerEl, '同步对话').disabled).toBe(false);
  expect(button(context.tab.containerEl, '网页登录').disabled).toBe(false);
  expect(button(context.tab.containerEl, '测试连接').disabled).toBe(false);
});

it('treats connection errors separately from signed-out and allows manual-only use', () => {
  const { tab, view } = setup('error');
  view.connectionMessage = '网络暂不可用';
  act(() => tab.updateRuntimeState());
  expect(tab.containerEl.textContent).toContain('连接异常');
  expect(tab.containerEl.textContent).toContain('网络暂不可用');
  expect(button(tab.containerEl, '同步对话').disabled).toBe(false);
  expect(tab.containerEl.textContent).toContain('仅手动同步');
  view.connection = 'signed-out';
  act(() => tab.updateRuntimeState());
  expect(button(tab.containerEl, '同步对话').disabled).toBe(true);
});

it('unmounts settings on hide and mounts a clean view when reopened', () => {
  const { tab } = setup();
  const input = tab.containerEl.querySelector('input');
  act(() => tab.hide());
  expect(tab.containerEl.childElementCount).toBe(0);
  act(() => tab.updateRuntimeState());
  expect(tab.containerEl.childElementCount).toBe(0);
  act(() => tab.display());
  expect(tab.containerEl.querySelector('input')).not.toBe(input);
});

it('guards rapid sync clicks before the next runtime render', async () => {
  const { tab, actions, syncs } = setup();
  let finish!: () => void;
  actions.sync = async () => { await new Promise<void>(resolve => { finish = resolve; }); };
  let requests = 0;
  const pending = actions.sync;
  actions.sync = async () => { requests++; await pending(); };
  act(() => {
    const sync = button(tab.containerEl, '同步对话');
    sync.click(); sync.click();
  });
  expect(requests).toBe(1);
  expect(syncs()).toBe(0);
  await act(async () => { finish(); });
});

it('changes automatic settings and shows their summary without requiring automatic sync for readiness', async () => {
  const { tab, view } = setup();
  const automatic = tab.containerEl.querySelector('input[aria-label="启用自动同步"]') as HTMLInputElement;
  await act(async () => automatic.click());
  act(() => tab.updateRuntimeState());
  expect(view.settings.scheduledEnabled).toBe(true);
  expect(tab.containerEl.textContent).toContain('每 60 分钟');
  act(() => (tab.containerEl.querySelector('[data-schedule-disclosure]') as HTMLButtonElement).click());
  const period = tab.containerEl.querySelector('input[aria-label="同步间隔（分钟）"]') as HTMLInputElement;
  await act(async () => { period.value = '120'; period.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => tab.updateRuntimeState());
  expect(view.settings.intervalMinutes).toBe(120);
  expect(tab.containerEl.textContent).toContain('每 120 分钟');
});

it('shows real history counts, no-change results and each failed conversation without message bodies', () => {
  const base: SyncHistoryEntry = { id: 'a', startedAt: 1, finishedAt: 1001, durationMs: 1000,
    source: 'manual', status: 'success', created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [], limited: false };
  openSyncHistoryModal({} as App, [base, { ...base, id: 'b', status: 'partial', created: 2, updated: 3, skipped: 7, failed: 2, total: 14,
    limited: true, items: [
      { id: '1', title: '对话甲', status: 'failed', error: '原笔记正文边界缺失' },
      { id: '2', title: '对话乙', status: 'failed', error: '超过 1000 页' },
    ] }]);
  const text = document.body.textContent;
  expect(text).toContain('无需同步');
  expect(text).toContain('新增 2 · 更新 3 · 跳过 7 · 失败 2');
  expect(text).toContain('对话甲'); expect(text).toContain('原笔记正文边界缺失');
  expect(text).toContain('对话乙'); expect(text).toContain('超过 1000 页');
  expect(text).toContain('200');
  const entries = Array.from(document.querySelectorAll('details'));
  expect(entries[0]?.open).toBe(true);
});

it('labels an unchanged successful run as no changes while retaining all 49 skipped conversations', () => {
  openSyncHistoryModal({} as App, [{ id: 'unchanged', startedAt: 1, finishedAt: 1001, durationMs: 1000,
    source: 'manual', status: 'success', created: 0, updated: 0, skipped: 49, failed: 0, total: 49,
    items: [], limited: false }]);
  const summary = document.querySelector('summary')?.textContent;
  expect(summary).toContain('无需同步');
  expect(summary).toContain('新增 0 · 更新 0 · 跳过 49 · 失败 0');
});

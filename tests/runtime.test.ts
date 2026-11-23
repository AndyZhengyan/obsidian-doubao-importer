// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import DoubaoPlugin from '../src/main';
import type { SettingsActions, SettingsView } from '../src/types';

const state = vi.hoisted(() => ({
  data: null as unknown,
  saves: [] as unknown[],
  list: [] as Array<{ id: string; title: string; created: string; modified: string }>,
  stallId: '', calls: 0, authId: '', version: 'v1', loggedIn: true, listFails: false,
  view: null as null | (() => SettingsView), actions: null as SettingsActions | null,
  notices: [] as Array<{ message: string; timeout?: number }>,
}));

vi.mock('obsidian', () => ({
  TFile: class { constructor(public path: string) {} },
  Notice: class {
    messageEl = { addClass() {} };
    constructor(message: string, timeout?: number) { state.notices.push({ message, timeout }); }
  },
  normalizePath: (path: string) => path,
  Plugin: class {
    constructor(public app: unknown) {}
    async loadData() { return state.data; }
    async saveData(value: unknown) { state.data = structuredClone(value); state.saves.push(structuredClone(value)); }
    addSettingTab() {}
    addCommand() {}
    addRibbonIcon() {}
    addStatusBarItem() { return { setText() {} }; }
  },
}));
vi.mock('../src/settings-tab', () => ({ DoubaoSettingsTab: class {
  constructor(_app: unknown, _plugin: unknown, getView: () => SettingsView, actions: SettingsActions) { state.view = getView; state.actions = actions; }
  updateRuntimeState() {}
  hide() {}
} }));
vi.mock('../src/ui/sync-history-modal', () => ({ openSyncHistoryModal() {} }));
vi.mock('../src/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api')>();
  return { ...actual, DoubaoApiClient: class {
    async isLoggedIn() { return state.loggedIn; }
    async logout() {}
    dispose() {}
    async withAuthenticatedPage<T>(action: (page: unknown) => Promise<T>, signal?: AbortSignal): Promise<T> {
      const { abortable, checkCancelled } = await import('../src/cancellation');
      checkCancelled(signal);
      return action({
        conversations: async () => { if (state.listFails) throw new Error('网络断开'); return state.list; },
        allConversations: async () => state.list,
        version: async (id: string) => { if (id === state.authId) throw new actual.DoubaoAuthError(); return state.version; },
        messages: async (id: string, progress?: (page: number, count: number) => void) => {
          state.calls++;
          if (id === state.stallId) return abortable(new Promise(() => {}), signal);
          progress?.(1, 1);
          return [{ id: `m-${id}`, index: '1', role: 'user', text: `内容-${state.version}`, created: '1700000000' }];
        },
      });
    }
  } };
});

let plugin: DoubaoPlugin;
let files: Map<string, string>;
const conversation = { id: '123', title: '第一会话', created: '1700000000', modified: '1700000100' };

beforeEach(async () => {
  state.data = { intervalMinutes: 0, folder: '豆包/对话' };
  state.saves = []; state.list = [conversation]; state.stallId = ''; state.calls = 0; state.authId = ''; state.version = 'v1'; state.loggedIn = true; state.listFails = false;
  state.notices = [];
  files = new Map();
  const folders = new Set<string>();
  const app = {
    vault: {
      configDir: '.obsidian',
      getAllFolders: () => [...folders].map(path => ({ path })),
      getMarkdownFiles: () => [...files.keys()].map(path => Object.assign(new TFile(), { path })),
      getAbstractFileByPath: (path: string) => files.has(path) ? Object.assign(new TFile(), { path }) : folders.has(path) ? { path } : null,
      cachedRead: async (file: TFile) => files.get(file.path) ?? '',
      read: async (file: TFile) => files.get(file.path) ?? '',
      create: async (path: string, content: string) => { files.set(path, content); },
      modify: async (file: TFile, content: string) => { files.set(file.path, content); },
      createFolder: async (path: string) => { folders.add(path); },
    },
    metadataCache: { getFileCache: () => null },
    workspace: { onLayoutReady() {} },
  };
  plugin = new DoubaoPlugin(app as never, { id: 'doubao-sync' } as never);
  await plugin.onload();
});
afterEach(() => { plugin.onunload(); vi.useRealTimers(); });

it('writes only conversations matched by the manual date scope and records it in history', async () => {
  state.list = [conversation, { ...conversation, id: '456', modified: '1690000000' }];
  await plugin.syncNow(false, { label: '自指定日期起', cutoff: 1700000000000 });
  expect(state.calls).toBe(1);
  expect(files.size).toBe(1);
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({
    scopeLabel: '自指定日期起', total: 1, items: [{ id: '123' }],
  });
});

it('clears the manual result after three seconds and keeps it in history', async () => {
  vi.useFakeTimers();
  await plugin.syncNow();
  expect(state.view!().task).toMatchObject({ phase: 'success', running: false });
  expect(state.view!().task.currentTitle).toBeUndefined();
  await vi.advanceTimersByTimeAsync(3000);
  expect(state.view!().task.phase).toBe('idle');
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({ status: 'success', created: 1 });
});

it('returns directly to idle after a scheduled run without changes', async () => {
  await plugin.syncNow();
  await plugin.syncNow(true);
  expect(state.view!().task.phase).toBe('idle');
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({ status: 'success', source: 'auto', skipped: 1 });
});

it('shows success only for explicit connection tests and clears it on failure', async () => {
  await plugin.checkConnection();
  expect(state.view!()).toMatchObject({ connection: 'connected', connectionMessage: '' });
  await state.actions!.checkConnection();
  expect(state.view!()).toMatchObject({ connection: 'connected', connectionMessage: '连接成功' });
  state.listFails = true;
  await state.actions!.checkConnection();
  expect(state.view!()).toMatchObject({ connection: 'error', connectionMessage: '网络断开' });
});

it('persists message versions and per-conversation history across restarts without duplicates', async () => {
  await plugin.syncNow();
  expect(files.size).toBe(1);
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({ status: 'success', created: 1, source: 'manual', items: [{ id: '123', status: 'created' }] });
  await plugin.syncNow();
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({ created: 0, skipped: 1 });
  expect(state.calls).toBe(1);
  state.version = 'v2';
  await plugin.syncNow();
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({ updated: 1 });
  expect([...files.values()][0]).toContain('内容-v2');
  expect(state.saves.at(-1)).toMatchObject({ messageVersions: { '123': 'v2' }, checkpoints: { '123': '1700000100' } });
});

it('cancels an in-flight conversation and keeps already committed results on disk', async () => {
  state.list = [conversation, { ...conversation, id: '456', title: '第二会话' }];
  state.stallId = '456';
  const task = plugin.syncNow();
  expect(plugin.syncNow()).toBe(task);
  await vi.waitFor(() => expect(state.calls).toBe(2));
  state.actions!.cancel();
  await task;
  expect(state.view!().task).toMatchObject({ running: false, phase: 'cancelled' });
  expect(state.notices.at(-1)?.message).toContain('已保留完成的笔记');
  expect(files.size).toBe(1);
  expect(state.saves.at(-1)).toMatchObject({
    checkpoints: { '123': '1700000100' },
    syncHistory: [{ status: 'cancelled', created: 1, failed: 0, items: [{ id: '123', status: 'created' }] }],
  });
});

it('records partial results and expired connection state on mid-batch auth failure', async () => {
  state.list = [conversation, { ...conversation, id: '456', title: '第二会话' }];
  state.authId = '456';
  await plugin.syncNow();
  expect(state.view!().connection).toBe('expired');
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({ status: 'partial', created: 1, failed: 1, items: [{ id: '123', status: 'created' }, { id: '456', status: 'failed' }] });
  expect(plugin.settings.checkpoints).toEqual({ '123': '1700000100' });
});

it('stops writing and records cancellation when the plugin unloads during a request', async () => {
  state.stallId = '123';
  const task = plugin.syncNow();
  await vi.waitFor(() => expect(state.calls).toBe(1));
  plugin.onunload();
  await task;
  expect(files.size).toBe(0);
  expect(state.saves.at(-1)).toMatchObject({ syncHistory: [{ status: 'cancelled', created: 0 }] });
});

it('distinguishes an absent login from a verified connection and a network failure', async () => {
  state.loggedIn = false;
  await plugin.syncNow();
  expect(state.view!().connection).toBe('signed-out');
  state.loggedIn = true;
  state.listFails = true;
  await plugin.syncNow();
  expect(state.view!().connection).toBe('error');
  expect(files.size).toBe(0);
});

it('records automatic timer runs and stops scheduling when the user disables auto-sync', async () => {
  vi.useFakeTimers();
  await state.actions!.update('intervalMinutes', 30);
  await state.actions!.update('scheduledEnabled', true);
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect(plugin.settings.syncHistory.at(-1)).toMatchObject({ source: 'auto', status: 'success', created: 1 });
  expect(files.size).toBe(1);
  const count = plugin.settings.syncHistory.length;
  await state.actions!.update('scheduledEnabled', false);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(plugin.settings.syncHistory).toHaveLength(count);
});

it('notifies automatic changes but stays quiet when nothing changed', async () => {
  await plugin.syncNow(true);
  expect(state.notices.at(-1)?.message).toContain('新增 1');
  const count = state.notices.length;
  await plugin.syncNow(true);
  expect(state.notices).toHaveLength(count);
});

it('reports automatic auth failures with recovery advice and suppresses the same unresolved failure', async () => {
  state.loggedIn = false;
  await plugin.syncNow(true);
  expect(state.notices.at(-1)?.message).toContain('重新登录');
  expect(state.notices.at(-1)?.message).toContain('豆包登录已失效，请重新登录');
  const count = state.notices.length;
  await plugin.syncNow(true);
  expect(state.notices).toHaveLength(count);
  state.loggedIn = true;
  await plugin.syncNow(true);
  state.loggedIn = false;
  await plugin.syncNow(true);
  expect(state.notices.at(-1)?.message).toContain('重新登录');
  expect(state.notices.length).toBe(count + 2);
});

it('preserves the original automatic network error and gives an actionable retry suggestion', async () => {
  state.listFails = true;
  await plugin.syncNow(true);
  expect(state.notices.at(-1)?.message).toContain('网络断开');
  expect(state.notices.at(-1)?.message).toContain('检查网络');
  expect(state.notices.at(-1)?.message).toContain('同步日志');
});

it('warns when an automatic result reaches the list limit and does not repeat an unresolved limit warning', async () => {
  state.list = Array.from({ length: 200 }, (_, index) => ({ ...conversation, id: String(index) }));
  await plugin.syncNow(true);
  expect(state.notices.at(-1)?.message).toContain('200 条上限');
  expect(state.notices.at(-1)?.message).toContain('可能不完整');
  const count = state.notices.length;
  await plugin.syncNow(true);
  expect(state.notices).toHaveLength(count);
});

it('reports a new automatic failure after a manual sync has recovered the connection', async () => {
  state.listFails = true;
  await plugin.syncNow(true);
  state.listFails = false;
  await plugin.syncNow();
  const count = state.notices.length;
  state.listFails = true;
  await plugin.syncNow(true);
  expect(state.notices).toHaveLength(count + 1);
  expect(state.notices.at(-1)?.message).toContain('网络断开');
});

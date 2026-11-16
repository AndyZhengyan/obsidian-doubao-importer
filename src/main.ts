import { Plugin, TFile, normalizePath } from 'obsidian';
import { DoubaoApiClient, DoubaoAuthError } from './api';
import { buildDoubaoIndex } from './vault-index';
import { emptySyncResult, syncConversations, SyncInterruptedError, type SyncPort, type SyncResult } from './sync';
import { checkCancelled, isAbortError } from './cancellation';
import { normalizeSettings } from './settings-data';
import { retainHistory } from './history';
import { DoubaoSettingsTab } from './settings-tab';
import { openSyncHistoryModal } from './ui/sync-history-modal';
import { showError, showInfo, showSuccess } from './ui/notice';
import { CONNECTION_LABELS, PHASE_LABELS } from './ui/text';
import type { ConnectionState, Settings, SettingsActions, SettingsView, SyncHistoryEntry, TaskState } from './types';

export default class DoubaoSyncPlugin extends Plugin {
  settings: Settings = normalizeSettings(null);
  private api: DoubaoApiClient | null = null;
  private controller: AbortController | null = null;
  private connectionController: AbortController | null = null;
  private currentJob: Promise<void> | null = null;
  private interval: number | null = null;
  private statusEl: HTMLElement | null = null;
  private settingsTab: DoubaoSettingsTab | null = null;
  private connection: ConnectionState = 'unverified';
  private connectionMessage = '';
  private task: TaskState = { running: false, phase: 'idle', message: PHASE_LABELS.idle, processed: 0 };
  private lastAutomaticIssue = '';
  private saveQueue: Promise<void> = Promise.resolve();
  private unloaded = false;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    const actions: SettingsActions = {
      login: () => this.openLogin(), logout: () => this.logout(), checkConnection: () => this.checkConnection(true),
      sync: () => this.syncNow(), cancel: () => this.cancelSync(), update: (key, value) => this.updateSetting(key, value),
      folders: query => this.app.vault.getAllFolders().map(folder => folder.path).filter(path => path.toLowerCase().includes(query.toLowerCase())),
      showHistory: () => openSyncHistoryModal(this.app, this.settings.syncHistory),
    };
    this.settingsTab = new DoubaoSettingsTab(this.app, this, () => this.view(), actions);
    this.addSettingTab(this.settingsTab);
    this.addCommand({ id: 'sync-now', name: '立即同步豆包对话', callback: () => { void this.syncNow(); } });
    this.addCommand({ id: 'open-login', name: '登录豆包', callback: () => this.openLogin() });
    this.addCommand({ id: 'cancel-sync', name: '取消豆包同步', callback: () => this.cancelSync() });
    this.addCommand({ id: 'sync-history', name: '查看豆包同步日志', callback: () => actions.showHistory() });
    this.addRibbonIcon('messages-square', '同步豆包对话', () => { void this.syncNow(); });
    this.statusEl = this.addStatusBarItem();
    this.updateView();
    this.resetTimer();
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      if (this.settings.scheduledEnabled && this.settings.syncOnStart) void this.syncNow(true);
      else void this.checkConnection();
    });
  }

  onunload(): void {
    this.unloaded = true;
    if (this.interval !== null) window.clearInterval(this.interval);
    this.controller?.abort();
    this.connectionController?.abort();
    this.api?.dispose();
    this.settingsTab?.hide();
  }

  private view(): SettingsView {
    return { settings: this.settings, connection: this.connection, connectionMessage: this.connectionMessage, task: this.task };
  }

  private updateView(): void {
    if (this.unloaded) return;
    const label = CONNECTION_LABELS[this.connection];
    this.statusEl?.setText(`豆包同步：${this.task.running ? this.task.message : this.task.phase === 'idle' ? label : this.task.message}`);
    this.settingsTab?.updateRuntimeState();
  }

  private client(): DoubaoApiClient {
    return this.api ??= new DoubaoApiClient(() => {
      if (this.unloaded) return;
      this.connection = 'connected';
      this.connectionMessage = '';
      this.updateView();
      showSuccess('登录成功，点击「同步对话」即可保存对话。');
    });
  }

  openLogin(): void {
    if (this.task.running || this.unloaded) return;
    this.connectionController?.abort();
    this.connectionController = null;
    this.connection = 'unverified';
    this.connectionMessage = '请在豆包窗口完成登录；如果窗口已关闭，可点击「继续网页登录」重新打开。';
    this.updateView();
    try { this.client().openLogin(); } catch (error) {
      this.connection = 'error';
      this.connectionMessage = error instanceof Error ? error.message : String(error);
      this.updateView();
      showError(`打开登录窗口失败：${this.connectionMessage}。请重试「网页登录」；若仍失败，请检查 Obsidian 桌面端环境。`);
    }
  }

  async logout(): Promise<void> {
    this.cancelSync();
    await this.currentJob;
    this.connectionController?.abort();
    this.connectionController = null;
    try {
      await this.client().logout();
      this.connection = 'signed-out';
      this.connectionMessage = '';
    } catch (error) {
      this.connection = 'error';
      this.connectionMessage = error instanceof Error ? error.message : String(error);
    }
    this.updateView();
  }

  async checkConnection(manual = false): Promise<void> {
    if (this.task.running || this.connectionController || this.unloaded) return;
    const controller = new AbortController();
    this.connectionController = controller;
    this.connection = 'checking';
    this.connectionMessage = '';
    this.updateView();
    try {
      const client = this.client();
      const loggedIn = await client.isLoggedIn();
      checkCancelled(controller.signal);
      if (!loggedIn) { this.connection = 'signed-out'; return; }
      await client.withAuthenticatedPage(page => page.conversations(), controller.signal);
      checkCancelled(controller.signal);
      this.connection = 'connected';
      if (manual) this.connectionMessage = '连接成功';
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      this.connection = error instanceof DoubaoAuthError ? 'expired' : 'error';
      this.connectionMessage = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.connectionController === controller) this.connectionController = null;
      this.updateView();
    }
  }

  private persist(): Promise<void> {
    const snapshot: Settings = JSON.parse(JSON.stringify(this.settings)) as Settings;
    const operation = this.saveQueue.catch(() => {}).then(() => this.saveData(snapshot));
    this.saveQueue = operation;
    return operation;
  }

  private async updateSetting<K extends 'folder' | 'intervalMinutes' | 'scheduledEnabled' | 'syncOnStart'>(key: K, value: Settings[K]): Promise<void> {
    if (key === 'intervalMinutes' && (typeof value !== 'number' || !Number.isFinite(value) || value < 5 || value > 1440)) throw new Error('同步周期须为 5–1440 分钟');
    this.settings[key] = value;
    if (key !== 'folder') this.resetTimer();
    this.updateView();
    await this.persist();
  }

  private resetTimer(): void {
    if (this.interval !== null) window.clearInterval(this.interval);
    this.interval = null;
    if (!this.unloaded && this.settings.scheduledEnabled) {
      this.interval = window.setInterval(() => { if (!this.task.running) void this.syncNow(true); }, this.settings.intervalMinutes * 60_000);
    }
  }

  cancelSync(): void {
    if (!this.controller || !this.task.running) return;
    this.task = { ...this.task, message: '正在取消…' };
    this.updateView();
    this.controller.abort();
  }

  syncNow(automatic = false): Promise<void> {
    if (this.unloaded) return Promise.resolve();
    if (this.currentJob) {
      if (!automatic) showInfo('同步正在进行，请等待完成，或点击「取消同步」。');
      return this.currentJob;
    }
    this.connectionController?.abort();
    this.connectionController = null;
    this.currentJob = this.runSync(automatic).finally(() => { this.currentJob = null; });
    return this.currentJob;
  }

  private applyResult(entry: SyncHistoryEntry, result: SyncResult, status: SyncHistoryEntry['status']): void {
    this.settings.checkpoints = { ...result.checkpoints };
    this.settings.messageVersions = { ...result.versions };
    Object.assign(entry, {
      status, created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed,
      total: result.total, items: result.items.map(item => ({ ...item })), limited: result.limited,
      durationMs: Date.now() - entry.startedAt,
    });
  }

  private async runSync(automatic: boolean): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.task = { running: true, phase: 'listing', message: PHASE_LABELS.listing, processed: 0 };
    this.updateView();
    const startedAt = Date.now();
    const entry: SyncHistoryEntry = { id: crypto.randomUUID(), startedAt, finishedAt: 0, durationMs: 0, source: automatic ? 'auto' : 'manual', status: 'running', created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [], limited: false };
    this.settings.syncHistory = retainHistory([...this.settings.syncHistory, entry]);
    let result = emptySyncResult(this.settings.checkpoints, this.settings.messageVersions);
    try {
      await this.persist();
      const folder = this.validateFolder();
      const api = this.client();
      const loggedIn = await api.isLoggedIn();
      checkCancelled(controller.signal);
      if (!loggedIn) { this.connection = 'signed-out'; throw new DoubaoAuthError(); }
      const index = await this.buildUidIndex();
      checkCancelled(controller.signal);
      result = await api.withAuthenticatedPage(page => {
        const port = this.vaultPort(index, controller.signal);
        return syncConversations({ ...port, list: async () => {
          const conversations = await page.conversations();
          this.connection = 'connected';
          this.connectionMessage = '';
          this.updateView();
          return conversations;
        }, messages: (id, onPage) => page.messages(id, onPage), version: id => page.version(id) },
          this.settings.checkpoints, folder, (processed, total) => {
            this.task = { ...this.task, processed, total };
            this.updateView();
          }, {
            signal: controller.signal, previousVersions: this.settings.messageVersions,
            onConversation: conversation => {
              this.task = { ...this.task, phase: 'reading', message: PHASE_LABELS.reading, currentTitle: conversation.title || '无标题对话', page: undefined, messageCount: undefined };
              this.updateView();
            },
            onPage: (page, messageCount) => { this.task = { ...this.task, page, messageCount }; this.updateView(); },
            onWrite: () => { this.task = { ...this.task, phase: 'writing', message: PHASE_LABELS.writing }; this.updateView(); },
            onItem: async completed => { result = completed; this.applyResult(entry, completed, 'running'); await this.persist(); },
          });
      }, controller.signal);
    } catch (error) {
      if (error instanceof SyncInterruptedError) {
        result = error.result;
        if (error.reason === 'auth') this.connection = 'expired';
        else if (this.task.phase === 'listing') this.connection = 'error';
      } else if (error instanceof DoubaoAuthError) {
        if (this.connection !== 'signed-out') this.connection = 'expired';
        result.status = 'failed';
      } else result.status = controller.signal.aborted || isAbortError(error) ? 'cancelled' : 'failed';
      if (result.status !== 'cancelled') entry.error = error instanceof Error ? error.message : String(error);
    }
    this.applyResult(entry, result, result.status);
    entry.finishedAt = Date.now();
    this.settings.syncHistory = retainHistory(this.settings.syncHistory);
    this.settings.lastSyncAt = new Date(entry.finishedAt).toISOString();
    this.settings.lastSummary = `新增 ${result.created} · 更新 ${result.updated} · 跳过 ${result.skipped} · 失败 ${result.failed}`;
    const message = result.status === 'success' && result.created + result.updated === 0 ? '同步完成，没有新的变化' : PHASE_LABELS[result.status];
    this.task = { ...this.task, running: false, phase: result.status, message };
    this.controller = null;
    let saveError = '';
    try { await this.persist(); } catch (error) {
      this.task = { ...this.task, phase: 'failed', message: '同步记录保存失败' };
      saveError = `同步记录保存失败：${error instanceof Error ? error.message : String(error)}。已写入的笔记会保留，请检查磁盘空间和仓库写入权限后重试。`;
    }
    this.updateView();
    if (this.unloaded) return;
    const failed = result.status === 'failed' || result.status === 'partial';
    const originalError = entry.error || result.errors[0]?.message;
    const advice = this.connection === 'signed-out' || this.connection === 'expired'
      ? '请在设置中重新登录豆包后重试。'
      : '请检查网络、同步目录及写入权限，查看「同步日志」中的失败详情后重试。';
    const limited = result.limited ? '；会话列表达到 200 条上限，本次结果可能不完整，请查看「同步日志」' : '';
    const detail = `${message}：${this.settings.lastSummary}${originalError ? `；${originalError}` : ''}${failed ? `。${advice}` : ''}${result.status === 'cancelled' ? '；已保留完成的笔记，可再次同步继续' : ''}${limited}`;
    const issue = saveError || (failed ? `${result.status}:${this.connection}:${originalError || result.errors.map(item => item.message).join('|')}` : result.limited ? 'limited' : '');
    if (!automatic || issue !== this.lastAutomaticIssue) {
      if (saveError) showError(saveError, 10000);
      else if (failed) showError(detail, 15000);
      else if (result.limited) showInfo(detail, 10000);
      else if (!automatic && result.status === 'cancelled') showInfo(detail, 8000);
    }
    if (!saveError && !failed && !result.limited && result.status === 'success' && (!automatic || result.created + result.updated > 0)) {
      if (automatic) showInfo(`自动${detail}`);
      else showSuccess(detail);
    }
    if (automatic || !issue) this.lastAutomaticIssue = issue;
  }

  private vaultPort(index: Map<string, string[]>, signal: AbortSignal): Omit<SyncPort, 'list' | 'messages'> {
    const fileAt = (path: string): TFile => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error('原笔记不存在');
      return file;
    };
    return {
      find: async id => { const paths = index.get(id) ?? []; if (paths.length > 1) throw new Error('发现多个相同 uid 的笔记，已跳过'); return paths[0] ?? null; },
      read: path => this.app.vault.read(fileAt(path)),
      create: async (path, content) => {
        checkCancelled(signal);
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error('目标路径已存在其他文件');
        await this.ensureFolder(path.slice(0, path.lastIndexOf('/')), signal);
        checkCancelled(signal);
        await this.app.vault.create(path, content);
        const id = /^uid: "([^"]+)"/m.exec(content)?.[1];
        if (id) index.set(id, [path]);
      },
      update: async (path, content) => { checkCancelled(signal); await this.app.vault.modify(fileAt(path), content); },
    };
  }

  private validateFolder(): string {
    const folder = this.settings.folder.trim().replace(/^\/+|\/+$/g, '');
    if (!folder || folder.split('/').some(segment => segment === '.' || segment === '..' || !segment || segment === this.app.vault.configDir)) throw new Error('同步目录无效');
    return normalizePath(folder);
  }

  private async ensureFolder(folder: string, signal: AbortSignal): Promise<void> {
    const parts = folder.split('/');
    for (let length = 1; length <= parts.length; length++) {
      checkCancelled(signal);
      const path = parts.slice(0, length).join('/');
      if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
    }
  }

  private async buildUidIndex(): Promise<Map<string, string[]>> {
    const files = this.app.vault.getMarkdownFiles();
    const byPath = new Map(files.map(file => [file.path, file]));
    return buildDoubaoIndex(files.map(file => ({ path: file.path, frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter })), path => this.app.vault.cachedRead(byPath.get(path)!));
  }
}

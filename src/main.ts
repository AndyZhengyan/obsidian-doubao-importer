import { Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, type App } from 'obsidian';
import { DoubaoApiClient } from './api';
import { buildDoubaoIndex } from './vault-index';
import { syncConversations, type SyncPort, type SyncResult } from './sync';

interface Settings {
  folder: string;
  intervalMinutes: number;
  syncOnStart: boolean;
  checkpoints: Record<string, string>;
  lastSyncAt: string;
  lastSummary: string;
}

const DEFAULT_SETTINGS: Settings = {
  folder: '豆包/对话',
  intervalMinutes: 60,
  syncOnStart: false,
  checkpoints: {},
  lastSyncAt: '',
  lastSummary: '',
};

export default class DoubaoSyncPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  private api: DoubaoApiClient | null = null;
  private syncing = false;
  private interval: number | null = null;
  private statusEl: HTMLElement | null = null;
  private settingsTab: DoubaoSettingsTab | null = null;

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<Settings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved, checkpoints: saved?.checkpoints ?? {} };
    this.settingsTab = new DoubaoSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addCommand({ id: 'sync-now', name: '立即同步豆包对话', callback: () => { void this.syncNow(); } });
    this.addCommand({ id: 'open-login', name: '登录豆包', callback: () => { this.openLogin(); } });
    this.addRibbonIcon('messages-square', '同步豆包对话', () => { void this.syncNow(); });
    this.statusEl = this.addStatusBarItem();
    this.statusEl.setText('豆包同步：就绪');
    this.resetTimer();
    if (this.settings.syncOnStart) {
      this.app.workspace.onLayoutReady(() => { void this.syncNow(); });
    }
  }

  onunload(): void {
    if (this.interval !== null) window.clearInterval(this.interval);
    this.api?.dispose();
  }

  private client(): DoubaoApiClient {
    return this.api ??= new DoubaoApiClient(() => {
      this.statusEl?.setText('豆包同步：已连接');
      if (this.settingsTab?.containerEl.isConnected) this.settingsTab.display();
      new Notice('豆包登录成功，点击「同步」即可保存对话。');
    });
  }

  openLogin(): void {
    try {
      this.client().openLogin();
      new Notice('请在豆包窗口完成登录；成功后窗口会自动关闭，再点击「同步」。');
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async logout(): Promise<void> {
    await this.client().logout();
    new Notice('已清除豆包登录状态');
  }

  async isLoggedIn(): Promise<boolean> {
    try { return await this.client().isLoggedIn(); } catch { return false; }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.interval !== null) window.clearInterval(this.interval);
    this.interval = null;
    if (this.settings.intervalMinutes > 0) {
      this.interval = window.setInterval(() => { void this.syncNow(true); }, this.settings.intervalMinutes * 60_000);
    }
  }

  async syncNow(automatic = false): Promise<void> {
    if (this.syncing) {
      if (!automatic) new Notice('豆包同步正在进行');
      return;
    }
    this.syncing = true;
    this.statusEl?.setText('豆包同步：准备中');
    try {
      const api = this.client();
      if (!await api.isLoggedIn()) {
        if (!automatic) this.openLogin();
        else this.statusEl?.setText('豆包同步：请登录');
        return;
      }
      const folder = this.validateFolder();
      const index = await this.buildUidIndex();
      const result = await api.withAuthenticatedPage(page => {
        const port: SyncPort = {
          list: () => page.conversations(),
          messages: id => page.messages(id),
          find: async id => {
            const paths = index.get(id) ?? [];
            if (paths.length > 1) throw new Error('发现多个相同 uid 的笔记，已跳过');
            return paths[0] ?? null;
          },
          read: async path => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) throw new Error('原笔记不存在');
            return this.app.vault.read(file);
          },
          create: async (path, content) => {
            if (this.app.vault.getAbstractFileByPath(path)) throw new Error('目标路径已存在其他文件');
            await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
            await this.app.vault.create(path, content);
            const id = /^uid: "([^"]+)"/m.exec(content)?.[1];
            if (id) index.set(id, [path]);
          },
          update: async (path, content) => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) throw new Error('原笔记不存在');
            await this.app.vault.modify(file, content);
          },
        };
        return syncConversations(port, this.settings.checkpoints, folder, (done, total) => {
          this.statusEl?.setText(`豆包同步：${done}/${total}`);
        });
      });
      await this.finishSync(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl?.setText('豆包同步：失败');
      if (!automatic) new Notice(`豆包同步失败：${message}`, 8000);
      console.error('[Doubao Sync] Sync failed:', message);
    } finally {
      this.syncing = false;
    }
  }

  private async finishSync(result: SyncResult): Promise<void> {
    this.settings.checkpoints = result.checkpoints;
    this.settings.lastSyncAt = new Date().toISOString();
    this.settings.lastSummary = `新增 ${result.created} · 更新 ${result.updated} · 跳过 ${result.skipped} · 失败 ${result.failed}`;
    await this.saveData(this.settings);
    const suffix = result.limited ? '；会话列表达到 200 条上限，可能尚未覆盖更早历史' : '';
    const summary = `${this.settings.lastSummary}${suffix}`;
    this.statusEl?.setText(`豆包同步：${result.failed ? '部分完成' : '完成'}`);
    new Notice(`豆包同步${result.failed ? '部分完成' : '完成'}：${summary}`, 8000);
    if (result.errors.length) {
      console.warn('[Doubao Sync] Failed conversation IDs:', result.errors.map(error => `${error.id}: ${error.message}`));
    }
  }

  private validateFolder(): string {
    const folder = this.settings.folder.trim().replace(/^\/+|\/+$/g, '');
    if (!folder || folder.split('/').some(segment => segment === '.' || segment === '..' || !segment) || folder.startsWith('.obsidian')) {
      throw new Error('同步目录无效');
    }
    return normalizePath(folder);
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split('/');
    for (let length = 1; length <= parts.length; length++) {
      const path = parts.slice(0, length).join('/');
      if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
    }
  }

  private async buildUidIndex(): Promise<Map<string, string[]>> {
    const files = this.app.vault.getMarkdownFiles();
    const byPath = new Map(files.map(file => [file.path, file]));
    return buildDoubaoIndex(files.map(file => ({ path: file.path, frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter })),
      path => this.app.vault.cachedRead(byPath.get(path)!));
  }
}

class DoubaoSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DoubaoSyncPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('doubao-settings');
    containerEl.createEl('h2', { text: '豆包同步' });
    containerEl.createEl('p', { text: '将自己的豆包对话保存为本地 Markdown。首次使用请先登录。', cls: 'doubao-settings-desc' });
    const status = containerEl.createDiv({ cls: 'doubao-settings-status-bar' });
    status.createSpan({ text: '登录状态：检查中…' });
    void this.plugin.isLoggedIn().then(loggedIn => {
      status.empty();
      status.createSpan({ text: loggedIn ? '登录状态：已连接' : '登录状态：未登录' });
    });
    new Setting(containerEl).setName('豆包账号').setDesc('登录窗口使用独立的本地浏览器会话；插件不会保存 Cookie 明文。')
      .addButton(button => button.setButtonText('登录豆包').onClick(() => this.plugin.openLogin()))
      .addButton(button => button.setButtonText('退出登录').onClick(async () => { await this.plugin.logout(); this.display(); }));
    new Setting(containerEl).setName('立即同步').setDesc('从豆包读取最近的对话，按会话生成或更新笔记。')
      .addButton(button => button.setButtonText('同步').setCta().onClick(() => { void this.plugin.syncNow(); }));
    new Setting(containerEl).setName('同步目录').setDesc('默认：豆包/对话')
      .addText(text => text.setPlaceholder('豆包/对话').setValue(this.plugin.settings.folder).onChange(async value => {
        this.plugin.settings.folder = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName('定时同步').setDesc('Obsidian 桌面端运行时执行；0 表示关闭。')
      .addDropdown(dropdown => dropdown
        .addOption('0', '关闭').addOption('30', '每 30 分钟').addOption('60', '每小时').addOption('120', '每 2 小时')
        .setValue(String(this.plugin.settings.intervalMinutes))
        .onChange(async value => { this.plugin.settings.intervalMinutes = Number(value); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('启动时同步').setDesc('打开 Obsidian 后自动运行一次。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.syncOnStart).onChange(async value => {
        this.plugin.settings.syncOnStart = value;
        await this.plugin.saveSettings();
      }));
    if (this.plugin.settings.lastSyncAt) {
      containerEl.createEl('p', { text: `上次同步：${new Date(this.plugin.settings.lastSyncAt).toLocaleString()} · ${this.plugin.settings.lastSummary}`, cls: 'doubao-settings-desc' });
    }
  }
}

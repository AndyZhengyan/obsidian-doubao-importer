import { App, Modal } from 'obsidian';
import type { SyncHistoryEntry, SyncItem } from '../types';

const STATUS_LABELS: Record<SyncHistoryEntry['status'], string> = {
  running: '同步中', success: '成功', partial: '部分失败', failed: '失败', cancelled: '已取消',
};
const ITEM_LABELS = { created: '新增', updated: '更新', skipped: '跳过', failed: '失败' };

/** Layout and styling adapted from obsidian-getnote-importer, MIT,
 * src/ui/sync-history-modal.tsx and styles.css. Metadata only: no conversation-body access.
 */
export function openSyncHistoryModal(app: App, history: SyncHistoryEntry[]): void {
  new SyncHistoryModal(app, history).open();
}

class SyncHistoryModal extends Modal {
  private currentPage = 1;
  private readonly pageSize = 5;
  private readonly entries: SyncHistoryEntry[];

  constructor(app: App, history: SyncHistoryEntry[]) {
    super(app);
    this.entries = history.slice().sort((a, b) => b.startedAt - a.startedAt);
  }

  onOpen(): void {
    const root = this.contentEl;
    root.replaceChildren();
    root.classList.add('doubao-history');
    this.append(root, 'h2', '同步日志');
    this.append(root, 'p', '最近 30 天 · 仅记录同步结果，不保存对话正文。', 'doubao-history-detail');
    const list = this.append(root, 'div', '', 'doubao-history-list');
    if (!this.entries.length) {
      this.append(list, 'span', '暂无同步日志', 'doubao-history-empty');
      return;
    }
    const navigation = this.append(root, 'div', '', 'doubao-history-pagination');
    const pages = Math.ceil(this.entries.length / this.pageSize);
    const renderPage = () => {
      list.replaceChildren();
      navigation.replaceChildren();
      const start = (this.currentPage - 1) * this.pageSize;
      this.entries.slice(start, start + this.pageSize).forEach((entry, offset) => this.renderEntry(list, entry, start + offset === 0));
      if (pages <= 1) return;
      const previous = this.append(navigation, 'button', '上一页', 'mod-secondary doubao-history-page-button');
      previous.disabled = this.currentPage === 1;
      previous.onclick = () => { this.currentPage = Math.max(1, this.currentPage - 1); renderPage(); };
      this.append(navigation, 'span', `第 ${this.currentPage} / ${pages} 页`, 'doubao-history-page-label');
      const next = this.append(navigation, 'button', '下一页', 'mod-secondary doubao-history-page-button');
      next.disabled = this.currentPage === pages;
      next.onclick = () => { this.currentPage = Math.min(pages, this.currentPage + 1); renderPage(); };
    };
    renderPage();
  }

  onClose(): void { this.contentEl.replaceChildren(); }

  private renderEntry(list: HTMLElement, entry: SyncHistoryEntry, newest: boolean): void {
    const details = this.append(list, 'details', '', `doubao-history-entry is-${entry.status}`);
    const warning = entry.status === 'partial' || entry.status === 'failed';
    details.open = newest || warning;
    const header = this.append(details, 'summary', '', 'doubao-history-header');
    if (warning) this.append(header, 'span', '⚠', 'doubao-history-warning-icon').setAttribute('aria-hidden', 'true');
    const mode = entry.source === 'auto' ? '自动 · 自动同步' : '手动 · 同步对话';
    this.append(header, 'span', `${this.formatTime(entry.finishedAt || entry.startedAt)} · ${mode} · `, 'doubao-history-header-context');
    this.append(header, 'span', STATUS_LABELS[entry.status], `doubao-history-status-text is-${entry.status}`);
    const counts = `新增 ${entry.created} · 更新 ${entry.updated} · 跳过 ${entry.skipped} · 失败 ${entry.failed}`;
    const unchanged = entry.status === 'success' && entry.created === 0 && entry.updated === 0 && entry.failed === 0;
    this.append(header, 'span', ` · ${unchanged ? '无需同步 · ' : ''}${counts}`, 'doubao-history-header-counts');
    const body = this.append(details, 'div', '', 'doubao-history-entry-body');
    const meta = this.append(body, 'div', '', 'doubao-history-meta-grid');
    this.renderMeta(meta, '方式', mode);
    this.renderMeta(meta, '参数', entry.scopeLabel ?? '最近会话范围');
    this.renderMeta(meta, '会话', `${entry.total} 条${entry.limited ? ' · 已达列表上限' : ''}`);
    this.renderMeta(meta, '结果', `${STATUS_LABELS[entry.status]} · ${this.formatDuration(entry.durationMs)}`);
    const summary = this.append(body, 'div', '', 'doubao-history-summary-grid');
    for (const status of ['created', 'updated', 'skipped', 'failed'] as const) {
      this.append(summary, 'div', `${ITEM_LABELS[status]} ${entry[status]}`,
        `doubao-history-summary-card${status === 'failed' && entry.failed > 0 ? ' doubao-history-summary-failed' : ''}`);
    }
    if (entry.limited) this.append(body, 'p', '会话列表达到 200 条上限，可能尚未覆盖更早历史。', 'doubao-history-warning');
    if (!entry.items.length) {
      this.append(body, 'div', '这条日志没有保存逐条明细', 'doubao-history-empty');
    } else {
      this.append(body, 'h3', '对话明细');
      const written = entry.items.filter(item => item.status === 'created' || item.status === 'updated');
      if (written.length) {
        const group = this.append(body, 'div', '', 'doubao-history-synced-details');
        this.append(group, 'div', `同步/更新明细 ${written.length}`, 'doubao-history-item-summary synced');
        const writes = this.append(group, 'div', '', 'doubao-history-write-list');
        for (const item of written) {
          const row = this.append(writes, 'div', '', 'doubao-history-write-row');
          this.append(row, 'span', ITEM_LABELS[item.status], `doubao-history-status-pill ${item.status}`);
          const itemBody = this.append(row, 'div', '', 'doubao-history-write-body');
          this.append(itemBody, 'div', this.itemTitle(item), 'doubao-history-note-title');
        }
      }
      this.renderItemGroup(body, entry.items.filter(item => item.status === 'failed'), 'failed', entry.failed);
      this.renderItemGroup(body, entry.items.filter(item => item.status === 'skipped'), 'skipped', entry.skipped);
    }
    if (entry.error) this.append(body, 'div', entry.error, 'doubao-history-error');
  }

  private renderItemGroup(parent: HTMLElement, items: SyncItem[], status: 'failed' | 'skipped', count: number): void {
    if (!items.length) return;
    const group = this.append(parent, 'div', '', 'doubao-history-item-group');
    this.append(group, 'div', `${ITEM_LABELS[status]} ${count}`, `doubao-history-item-summary ${status}`);
    const list = this.append(group, 'ul', '', 'doubao-history-item-list');
    for (const item of items) {
      const row = this.append(list, 'li', '', 'doubao-history-note-row');
      this.append(row, 'span', this.itemTitle(item), 'doubao-history-note-title');
      if (item.error) this.append(row, 'div', item.error, 'doubao-history-error');
    }
  }

  private itemTitle(item: SyncItem): string { return item.title || `豆包对话 ${item.id}`; }

  private renderMeta(parent: HTMLElement, label: string, value: string): void {
    const item = this.append(parent, 'div', '', 'doubao-history-meta-item');
    this.append(item, 'span', label, 'doubao-history-meta-label');
    this.append(item, 'span', value, 'doubao-history-meta-value');
  }

  private formatDuration(durationMs: number): string {
    if (durationMs < 1000) return '<1s';
    const seconds = Math.round(durationMs / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  private formatTime(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return '-';
    return new Date(timestamp).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  private append<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    root.append(element);
    return element;
  }
}

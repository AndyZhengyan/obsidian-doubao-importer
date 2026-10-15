import { App, Modal } from 'obsidian';
import type { SyncHistoryEntry } from '../types';

const STATUS_LABELS: Record<SyncHistoryEntry['status'], string> = {
  running: '进行中', success: '完成', partial: '部分完成', failed: '失败', cancelled: '已取消',
};
const ITEM_LABELS = { created: '新增', updated: '更新', skipped: '跳过', failed: '失败' };

/** Native Modal layout adapted from obsidian-getnote-importer, MIT,
 * src/ui/sync-history-modal.tsx @ 4a5e2cc7c82a8f03b3169e76db1ebbe9a5b09c95.
 * Presentation receives metadata only; no API or conversation-body access.
 */
export function openSyncHistoryModal(app: App, history: SyncHistoryEntry[]): void {
  new SyncHistoryModal(app, history).open();
}

class SyncHistoryModal extends Modal {
  private page = 0;
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
    this.append(root, 'p', '最近 30 天 · 仅记录同步结果，不保存对话正文。', 'doubao-settings-desc');
    if (!this.entries.length) { this.append(root, 'p', '暂无同步记录'); return; }
    const list = this.append(root, 'div', '', 'doubao-history-list');
    const navigation = this.append(root, 'div', '', 'doubao-history-pagination');
    const pageSize = 5;
    const pages = Math.ceil(this.entries.length / pageSize);
    const renderPage = () => {
      list.replaceChildren();
      navigation.replaceChildren();
      this.entries.slice(this.page * pageSize, (this.page + 1) * pageSize).forEach((entry, offset) => {
        const details = this.append(list, 'details', '', `doubao-history-entry doubao-history-${entry.status}`);
        details.open = (this.page === 0 && offset === 0) || entry.status === 'partial' || entry.status === 'failed';
        const counts = `新增 ${entry.created} · 更新 ${entry.updated} · 跳过 ${entry.skipped} · 失败 ${entry.failed}`;
        const noChanges = entry.status === 'success' && entry.created === 0 && entry.updated === 0 && entry.failed === 0;
        this.append(details, 'summary', `${new Date(entry.startedAt).toLocaleString()} · ${entry.source === 'auto' ? '自动' : '手动'} · ${STATUS_LABELS[entry.status]} · ${noChanges ? '无需同步 · ' : ''}${counts}`);
        const body = this.append(details, 'div', '', 'doubao-history-body');
        this.append(body, 'p', counts, 'doubao-history-counts');
        this.append(body, 'p', `会话 ${entry.total} · 耗时 ${entry.durationMs < 1000 ? '<1' : Math.round(entry.durationMs / 1000)} 秒`);
        if (entry.limited) this.append(body, 'p', '会话列表达到 200 条上限，可能尚未覆盖更早历史。', 'doubao-history-warning');
        if (entry.error) this.append(body, 'p', entry.error, 'doubao-error');
        if (entry.items.length) {
          const items = this.append(body, 'ul', '', 'doubao-history-items');
          for (const item of entry.items) {
            const row = this.append(items, 'li', '', `doubao-history-item doubao-history-item-${item.status}`);
            this.append(row, 'span', ITEM_LABELS[item.status], 'doubao-history-item-label');
            this.append(row, 'span', item.title || `豆包对话 ${item.id}`, 'doubao-history-item-title');
            if (item.error) this.append(row, 'p', item.error, 'doubao-error');
          }
        }
      });
      if (pages > 1) {
        const previous = this.append(navigation, 'button', '上一页');
        previous.disabled = this.page === 0;
        previous.onclick = () => { this.page--; renderPage(); };
        this.append(navigation, 'span', `${this.page + 1} / ${pages}`);
        const next = this.append(navigation, 'button', '下一页');
        next.disabled = this.page + 1 === pages;
        next.onclick = () => { this.page++; renderPage(); };
      }
    };
    renderPage();
  }
  private append<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    root.append(element);
    return element;
  }
}

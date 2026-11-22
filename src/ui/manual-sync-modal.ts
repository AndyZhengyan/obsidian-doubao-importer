import { Modal, type App } from 'obsidian';
import type { ManualSyncScope } from '../types';

export function openManualSyncModal(app: App, confirm: (scope: ManualSyncScope) => void): void {
  const modal = new Modal(app);
  modal.setTitle('按时间同步');
  const form = modal.contentEl.createEl('form');
  const scope = form.createDiv('setting-item');
  const label = scope.createEl('label', { text: '同步范围' });
  const mode = label.createEl('select');
  mode.createEl('option', { text: '最近 N 天', value: 'days' });
  mode.createEl('option', { text: '从指定日期开始', value: 'date' });
  mode.createEl('option', { text: '不限时间', value: 'all' });

  const daysLabel = form.createEl('label', { cls: 'setting-item', text: '最近天数' });
  const days = daysLabel.createEl('input', { type: 'number', attr: { min: '1', max: '36500', step: '1', required: '', value: '30' } });
  const dateLabel = form.createEl('label', { cls: 'setting-item', text: '起始日期' });
  const date = dateLabel.createEl('input', { type: 'date', attr: { required: '' } });
  const updateMode = () => {
    days.disabled = mode.value !== 'days';
    date.disabled = mode.value !== 'date';
    daysLabel.style.display = days.disabled ? 'none' : '';
    dateLabel.style.display = date.disabled ? 'none' : '';
  };
  mode.onchange = updateMode;
  updateMode();
  form.createEl('p', { text: '只影响本次同步。按会话更新时间筛选，无时间信息的会话也会纳入。命中的会话保存完整对话。' });
  const buttons = form.createDiv('modal-button-container');
  buttons.createEl('button', { text: '取消', type: 'button' }).onclick = () => modal.close();
  buttons.createEl('button', { text: '开始同步', type: 'submit', cls: 'mod-cta' });
  form.onsubmit = event => {
    event.preventDefault();
    const selected = mode.value === 'date'
      ? { label: `自 ${date.value} 起`, cutoff: new Date(`${date.value}T00:00:00`).getTime() }
      : mode.value === 'days'
        ? { label: `最近 ${days.valueAsNumber} 天`, cutoff: Date.now() - days.valueAsNumber * 86_400_000 }
        : { label: '不限时间', cutoff: 0 };
    if (!Number.isFinite(selected.cutoff)) return;
    modal.close();
    confirm(selected);
  };
  modal.open();
}

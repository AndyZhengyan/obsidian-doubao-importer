// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { showError, showInfo, showNotice, showSuccess } from '../src/ui/notice';

const notices = vi.hoisted(() => [] as Array<{ message: string; timeout: number; classes: string[] }>);
vi.mock('obsidian', () => ({ Notice: class {
  messageEl: { addClass: (name: string) => void };
  constructor(message: string, timeout: number) {
    const item = { message, timeout, classes: [] as string[] };
    notices.push(item);
    this.messageEl = { addClass: name => { item.classes.push(name); } };
  }
} }));
beforeEach(() => { notices.length = 0; });

it('passes untrusted text to the host Notice with a Doubao prefix and default duration', () => {
  showNotice('<img src=x onerror=alert(1)>');
  expect(notices).toEqual([{ message: '[豆包] <img src=x onerror=alert(1)>', timeout: 5000, classes: [] }]);
});

it('distinguishes errors and success through host classes and gives errors longer visibility', () => {
  showError('请求失败');
  showSuccess('同步完成');
  showInfo('正在同步');
  expect(notices).toEqual([
    { message: '❌ [豆包] 请求失败', timeout: 7000, classes: ['doubao-notice-error'] },
    { message: '✅ [豆包] 同步完成', timeout: 5000, classes: ['doubao-notice-success'] },
    { message: '[豆包] 正在同步', timeout: 4000, classes: [] },
  ]);
});

it('honors caller durations including a persistent notice', () => {
  showNotice('保留', 0);
  showError('查看日志', 15000);
  showSuccess('完成', 3000);
  showInfo('等待', 6000);
  expect(notices.map(notice => notice.timeout)).toEqual([0, 15000, 3000, 6000]);
});

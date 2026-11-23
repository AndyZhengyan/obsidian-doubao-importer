import { expect, it } from 'vitest';
import { normalizeSettings } from '../src/settings-data';

it('migrates legacy timers without changing existing folder, checkpoints or unknown settings', () => {
  const settings = normalizeSettings({ folder: 'my-notes/豆包', intervalMinutes: 0, syncOnStart: true, checkpoints: { '123': '1700000000' }, futureOption: 'keep' });
  expect(settings).toMatchObject({ folder: 'my-notes/豆包', scheduledEnabled: false, intervalMinutes: 60, syncOnStart: true, checkpoints: { '123': '1700000000' }, futureOption: 'keep', messageVersions: {}, syncHistory: [] });
  expect(normalizeSettings({ intervalMinutes: 30 }).scheduledEnabled).toBe(true);
  expect(normalizeSettings({ intervalMinutes: 30, scheduledEnabled: false }).scheduledEnabled).toBe(false);
});

it('bounds invalid settings and never treats an empty object as verified connectivity', () => {
  expect(normalizeSettings({ intervalMinutes: -4, checkpoints: null, syncHistory: 'bad' })).toMatchObject({ intervalMinutes: 60, checkpoints: {}, syncHistory: [] });
  expect(normalizeSettings(null).folder).toBe('豆包/对话');
});

it('starts fresh installs in manual mode without changing existing automatic schedules', () => {
  expect(normalizeSettings(null)).toMatchObject({ scheduledEnabled: false, intervalMinutes: 30, syncOnStart: true });
  expect(normalizeSettings({ intervalMinutes: 45, syncOnStart: false })).toMatchObject({ scheduledEnabled: true, intervalMinutes: 45, syncOnStart: false });
});

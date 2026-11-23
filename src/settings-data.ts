import type { Settings } from './types';
import { normalizeHistory } from './history';

export function normalizeSettings(value: unknown): Settings {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fresh = !value || typeof value !== 'object' || Object.keys(saved).length === 0;
  const legacyInterval = typeof saved.intervalMinutes === 'number' ? saved.intervalMinutes : 60;
  const strings = (value: unknown): Record<string, string> => Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {}).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  );
  return {
    ...saved,
    folder: typeof saved.folder === 'string' ? saved.folder : '豆包/对话',
    intervalMinutes: fresh ? 30 : Number.isFinite(legacyInterval) && legacyInterval >= 5 && legacyInterval <= 1440 ? Math.floor(legacyInterval) : 60,
    scheduledEnabled: typeof saved.scheduledEnabled === 'boolean' ? saved.scheduledEnabled : !fresh && legacyInterval > 0,
    syncOnStart: fresh ? true : saved.syncOnStart === true,
    checkpoints: strings(saved.checkpoints), messageVersions: strings(saved.messageVersions),
    lastSyncAt: typeof saved.lastSyncAt === 'string' ? saved.lastSyncAt : '',
    lastSummary: typeof saved.lastSummary === 'string' ? saved.lastSummary : '',
    syncHistory: normalizeHistory(saved.syncHistory),
  };
}

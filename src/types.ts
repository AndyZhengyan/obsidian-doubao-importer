export type ConnectionState = 'unverified' | 'checking' | 'connected' | 'signed-out' | 'expired' | 'error';
export type TaskPhase = 'idle' | 'listing' | 'reading' | 'writing' | 'success' | 'partial' | 'failed' | 'cancelled';
export interface TaskState {
  running: boolean;
  phase: TaskPhase;
  message: string;
  processed: number;
  total?: number;
  currentTitle?: string;
  page?: number;
  messageCount?: number;
}
export interface SyncItem {
  id: string;
  title: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  error?: string;
}
export interface SyncHistoryEntry {
  id: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  source: 'manual' | 'auto';
  status: 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  items: SyncItem[];
  limited: boolean;
  error?: string;
}
export interface Settings {
  folder: string;
  intervalMinutes: number;
  scheduledEnabled: boolean;
  syncOnStart: boolean;
  checkpoints: Record<string, string>;
  messageVersions: Record<string, string>;
  lastSyncAt: string;
  lastSummary: string;
  syncHistory: SyncHistoryEntry[];
}
export interface SettingsView {
  settings: Settings;
  connection: ConnectionState;
  connectionMessage: string;
  task: TaskState;
}
/** Presentation boundary: no API client, session, or plugin instance reaches UI. */
export interface SettingsActions {
  login(): void;
  logout(): Promise<void>;
  checkConnection(): Promise<void>;
  sync(): Promise<void>;
  cancel(): void;
  update<K extends 'folder' | 'intervalMinutes' | 'scheduledEnabled' | 'syncOnStart'>(key: K, value: Settings[K]): Promise<void>;
  folders(query: string): string[];
  showHistory(): void;
}

import { mergeManagedNote, renderNote, type Conversation, type Message } from './data';
import { DoubaoAuthError } from './api';
import { checkCancelled, isAbortError } from './cancellation';
import type { SyncItem } from './types';

export interface SyncPort {
  list(): Promise<Conversation[]>;
  messages(conversationId: string, onPage?: (page: number, count: number) => void): Promise<Message[]>;
  version?(conversationId: string): Promise<string>;
  find(conversationId: string): Promise<string | null>;
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  update(path: string, content: string): Promise<void>;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
  checkpoints: Record<string, string>;
  limited: boolean;
  total: number;
  items: SyncItem[];
  versions: Record<string, string>;
  status: 'success' | 'partial' | 'failed' | 'cancelled';
}

export interface SyncOptions {
  signal?: AbortSignal;
  previousVersions?: Record<string, string>;
  onConversation?: (conversation: Conversation) => void;
  onPage?: (page: number, count: number) => void;
  onWrite?: () => void;
  onItem?: (result: SyncResult) => Promise<void>;
}

export class SyncInterruptedError extends Error {
  constructor(message: string, readonly result: SyncResult, readonly reason: 'auth' | 'failed') { super(message); }
}

export function emptySyncResult(previous: Record<string, string> = {}, versions: Record<string, string> = {}): SyncResult {
  return { created: 0, updated: 0, skipped: 0, failed: 0, errors: [], checkpoints: { ...previous }, versions: { ...versions }, total: 0, items: [], limited: false, status: 'success' };
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|#^\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || '无标题对话';
}

export async function syncConversations(
  port: SyncPort,
  previous: Record<string, string>,
  folder: string,
  onProgress?: (done: number, total: number) => void,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const result = emptySyncResult(previous, options.previousVersions);
  let conversations: Conversation[];
  try {
    checkCancelled(options.signal);
    conversations = await port.list();
    checkCancelled(options.signal);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) return { ...result, status: 'cancelled' };
    throw new SyncInterruptedError(error instanceof Error ? error.message : String(error), { ...result, status: 'failed' }, error instanceof DoubaoAuthError ? 'auth' : 'failed');
  }
  result.total = conversations.length;
  result.limited = conversations.length >= 200;
  let done = 0;
  onProgress?.(0, conversations.length);
  for (const conversation of conversations) {
    try {
      checkCancelled(options.signal);
      options.onConversation?.(conversation);
      const path = await port.find(conversation.id);
      checkCancelled(options.signal);
      const version = port.version ? await port.version(conversation.id) : undefined;
      checkCancelled(options.signal);
      if (path && conversation.modified && previous[conversation.id] === conversation.modified && (!port.version || (version && options.previousVersions?.[conversation.id] === version))) {
        result.skipped++;
        result.items.push({ id: conversation.id, title: conversation.title, status: 'skipped' });
      } else {
        const messages = await port.messages(conversation.id, options.onPage);
        checkCancelled(options.signal);
        const note = renderNote(conversation, messages);
        options.onWrite?.();
        if (path) {
          const existing = await port.read(path);
          const merged = mergeManagedNote(existing, note);
          checkCancelled(options.signal);
          if (merged !== existing) {
            await port.update(path, merged);
            result.updated++;
            result.items.push({ id: conversation.id, title: conversation.title, status: 'updated' });
          } else {
            result.skipped++;
            result.items.push({ id: conversation.id, title: conversation.title, status: 'skipped' });
          }
        } else {
          const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
          const target = `${normalizedFolder}/${safeName(conversation.title)}-${conversation.id}.md`;
          checkCancelled(options.signal);
          await port.create(target, note);
          result.created++;
          result.items.push({ id: conversation.id, title: conversation.title, status: 'created' });
        }
        if (conversation.modified) result.checkpoints[conversation.id] = conversation.modified;
        if (version) result.versions[conversation.id] = version;
      }
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) { result.status = 'cancelled'; return result; }
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ id: conversation.id, message });
      result.items.push({ id: conversation.id, title: conversation.title, status: 'failed', error: message });
      if (error instanceof DoubaoAuthError) {
        result.status = result.created + result.updated + result.skipped ? 'partial' : 'failed';
        throw new SyncInterruptedError(message, result, 'auth');
      }
    }
    // Persist committed outcomes outside the item catch: a save failure must stop the job.
    try { await options.onItem?.(result); } catch (error) {
      result.status = 'partial';
      throw new SyncInterruptedError(`保存同步结果失败：${error instanceof Error ? error.message : String(error)}`, result, 'failed');
    }
    done++;
    onProgress?.(done, conversations.length);
  }
  result.status = options.signal?.aborted ? 'cancelled' : result.failed ? (result.created + result.updated + result.skipped ? 'partial' : 'failed') : 'success';
  return result;
}

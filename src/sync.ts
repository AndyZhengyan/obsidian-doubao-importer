import { mergeManagedNote, renderNote, type Conversation, type Message } from './data';
import { DoubaoAuthError } from './api';

export interface SyncPort {
  list(): Promise<Conversation[]>;
  messages(conversationId: string): Promise<Message[]>;
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
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|#^\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || '无标题对话';
}

export async function syncConversations(
  port: SyncPort,
  previous: Record<string, string>,
  folder: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
  const conversations = await port.list();
  const result: SyncResult = {
    created: 0, updated: 0, skipped: 0, failed: 0, errors: [],
    checkpoints: { ...previous }, limited: conversations.length >= 200,
  };
  let done = 0;
  for (const conversation of conversations) {
    try {
      const path = await port.find(conversation.id);
      if (path && conversation.modified && previous[conversation.id] === conversation.modified) {
        result.skipped++;
      } else {
        const messages = await port.messages(conversation.id);
        const note = renderNote(conversation, messages);
        if (path) {
          const existing = await port.read(path);
          const merged = mergeManagedNote(existing, note);
          if (merged !== existing) await port.update(path, merged);
          result.updated++;
        } else {
          const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
          const target = `${normalizedFolder}/${safeName(conversation.title)}-${conversation.id}.md`;
          await port.create(target, note);
          result.created++;
        }
        if (conversation.modified) result.checkpoints[conversation.id] = conversation.modified;
      }
    } catch (error) {
      if (error instanceof DoubaoAuthError) throw error;
      result.failed++;
      result.errors.push({ id: conversation.id, message: error instanceof Error ? error.message : String(error) });
    }
    done++;
    onProgress?.(done, conversations.length);
  }
  return result;
}

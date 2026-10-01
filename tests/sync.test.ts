import { describe, expect, it } from 'vitest';
import { syncConversations, type SyncPort } from '../src/sync';
import type { Conversation, Message } from '../src/data';

const conversation: Conversation = { id: '1234567890123456789', title: '豆包话题', created: '1700000000', modified: '1700000100' };
const message: Message = { id: 'm1', index: '1', role: 'user', text: '原始内容', created: '1700000000' };

function fixture() {
  const files = new Map<string, string>();
  let shouldFail = false;
  const port: SyncPort = {
    list: async () => [conversation],
    messages: async () => { if (shouldFail) throw new Error('网络错误'); return [message]; },
    find: async id => [...files.entries()].find(([, content]) => content.includes(`uid: "${id}"`))?.[0] ?? null,
    read: async path => files.get(path) ?? '',
    create: async (path, content) => { files.set(path, content); },
    update: async (path, content) => { files.set(path, content); },
  };
  return { files, port, fail: () => { shouldFail = true; } };
}

describe('sync', () => {
  it('creates a note once and skips a conversation with an unchanged remote timestamp', async () => {
    const f = fixture();
    const first = await syncConversations(f.port, {}, '豆包');
    expect(first.created).toBe(1);
    expect(f.files.size).toBe(1);
    const second = await syncConversations(f.port, first.checkpoints, '豆包');
    expect(second.skipped).toBe(1);
    expect(f.files.size).toBe(1);
  });

  it('keeps a moved note and manual appendix when remote content changes', async () => {
    const f = fixture();
    const first = await syncConversations(f.port, {}, '豆包');
    const [[path, content]] = [...f.files.entries()];
    f.files.delete(path);
    f.files.set('豆包/手动移动.md', content + '\n## 批注\n我的内容');
    const next = await syncConversations({
      ...f.port,
      list: async () => [{ ...conversation, modified: '1700000200' }],
      messages: async () => [{ ...message, text: '新内容' }],
    }, first.checkpoints, '豆包');
    expect(next.updated).toBe(1);
    expect(f.files.size).toBe(1);
    expect(f.files.get('豆包/手动移动.md')).toContain('## 批注\n我的内容');
    expect(f.files.get('豆包/手动移动.md')).toContain('新内容');
  });

  it('does not advance a failed conversation checkpoint', async () => {
    const f = fixture();
    f.fail();
    const result = await syncConversations(f.port, {}, '豆包');
    expect(result.failed).toBe(1);
    expect(result.checkpoints).toEqual({});
    expect(f.files.size).toBe(0);
  });
});

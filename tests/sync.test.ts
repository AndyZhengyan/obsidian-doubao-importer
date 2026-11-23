import { describe, expect, it } from 'vitest';
import { syncConversations, type SyncPort } from '../src/sync';
import { DoubaoAuthError } from '../src/api';
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
  it('cancels before discovery without reading or writing files', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const result = await syncConversations({ ...f.port, list: async () => { throw new Error('must not discover'); } }, {}, '豆包', undefined, { signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect(result.failed).toBe(0);
    expect(f.files.size).toBe(0);
  });

  it('never writes an incomplete conversation after cancellation while reading messages', async () => {
    const f = fixture();
    const controller = new AbortController();
    const result = await syncConversations({ ...f.port, messages: async () => { controller.abort(); return [message]; } }, {}, '豆包', undefined, { signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect(result.checkpoints).toEqual({});
    expect(f.files.size).toBe(0);
  });

  it('preserves a committed conversation and checkpoint when cancelled before the next one', async () => {
    const f = fixture();
    const controller = new AbortController();
    const result = await syncConversations({
      ...f.port,
      list: async () => [conversation, { ...conversation, id: '2234567890123456789' }],
      create: async (path, content) => { await f.port.create(path, content); controller.abort(); },
    }, {}, '豆包', undefined, { signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect(result.created).toBe(1);
    expect(result.items).toMatchObject([{ id: conversation.id, status: 'created' }]);
    expect(result.checkpoints).toEqual({ [conversation.id]: conversation.modified });
    expect(f.files.size).toBe(1);
  });

  it('detects a new message even when the conversation timestamp did not change', async () => {
    const f = fixture();
    const first = await syncConversations({ ...f.port, version: async () => 'v1' }, {}, '豆包');
    const second = await syncConversations({ ...f.port, version: async () => 'v2', messages: async () => [message, { ...message, id: 'm2', index: '2', text: '新增一轮' }] }, first.checkpoints, '豆包', undefined, { previousVersions: first.versions });
    expect(second.updated).toBe(1);
    expect(second.versions).toEqual({ [conversation.id]: 'v2' });
    expect([...f.files.values()][0]).toContain('新增一轮');
    const third = await syncConversations({ ...f.port, version: async () => 'v2', messages: async () => { throw new Error('must skip unchanged messages'); } }, second.checkpoints, '豆包', undefined, { previousVersions: second.versions });
    expect(third.skipped).toBe(1);
    expect(third.failed).toBe(0);
  });

  it('records an unchanged migration re-read as skipped while saving the new message version', async () => {
    const f = fixture();
    const first = await syncConversations(f.port, {}, '豆包');
    let writes = 0;
    const second = await syncConversations({ ...f.port, version: async () => 'v1', update: async () => { writes++; } }, first.checkpoints, '豆包');
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.items[0]?.status).toBe('skipped');
    expect(second.versions[conversation.id]).toBe('v1');
    expect(writes).toBe(0);
  });

  it('retains completed work in the interruption error when authentication expires mid-batch', async () => {
    const f = fixture();
    let reads = 0;
    try {
      await syncConversations({ ...f.port,
        list: async () => [conversation, { ...conversation, id: '2234567890123456789' }],
        messages: async () => { if (++reads === 2) throw new DoubaoAuthError(); return [message]; },
      }, {}, '豆包');
      throw new Error('expected auth failure');
    } catch (error) {
      expect(error).toMatchObject({ reason: 'auth', result: { created: 1, failed: 1, checkpoints: { [conversation.id]: conversation.modified } } });
    }
    expect(f.files.size).toBe(1);
  });
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

  it('stops the batch immediately when login expires', async () => {
    let requests = 0;
    const f = fixture();
    await expect(syncConversations({
      ...f.port,
      list: async () => [conversation, { ...conversation, id: '2234567890123456789' }],
      messages: async () => { requests++; throw new DoubaoAuthError(); },
    }, {}, '豆包')).rejects.toThrow(/重新登录/);
    expect(requests).toBe(1);
    expect(f.files.size).toBe(0);
  });
});

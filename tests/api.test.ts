import { afterEach, expect, it, vi } from 'vitest';
import { buildMessageRequest, buildRecentRequest, DoubaoApiClient, DoubaoPage } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

it('aborts an outstanding browser request without waiting for Electron to settle it', async () => {
  const controller = new AbortController();
  const page = new DoubaoPage({ setWindowOpenHandler: () => {}, executeJavaScript: () => new Promise(() => {}) }, controller.signal);
  const pending = page.messages('123');
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

it('uses the version probe as the first page of a full read instead of fetching it twice', async () => {
  let calls = 0;
  const page = new DoubaoPage({ setWindowOpenHandler: () => {}, executeJavaScript: async () => {
    calls++;
    return { status: 200, text: JSON.stringify({ downlink_body: { pull_singe_chain_downlink_body: {
      has_more: false, messages: [{ message_id: '1', index_in_conv: '1', user_type: 1, content: '{"text":"版本内容"}' }],
    } } }) };
  } });
  const version = await page.version('123');
  expect(version).toMatch(/^[a-f0-9]{64}$/);
  expect((await page.messages('123'))[0]?.text).toBe('版本内容');
  expect(calls).toBe(1);
});

it('stops before requesting the next message page when cancelled from progress', async () => {
  const controller = new AbortController();
  let calls = 0;
  const page = new DoubaoPage({ setWindowOpenHandler: () => {}, executeJavaScript: async () => {
    calls++;
    return { status: 200, text: JSON.stringify({ downlink_body: { pull_singe_chain_downlink_body: {
      has_more: true, messages: [{ message_id: '1', index_in_conv: '100', user_type: 1, content: '{"text":"内容"}' }],
    } } }) };
  } }, controller.signal);
  await expect(page.messages('123', () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(1);
});

it('closes the hidden window on cancellation even if navigation never settles', async () => {
  let closed = false;
  class BrowserWindow {
    webContents = { setWindowOpenHandler: () => {}, executeJavaScript: async () => ({}) };
    loadURL() { return new Promise<void>(() => {}); }
    isDestroyed() { return closed; }
    close() { closed = true; }
    once() {}
  }
  vi.stubGlobal('require', () => ({ BrowserWindow, session: { fromPartition: () => ({ cookies: { get: async () => [{ name: 'sessionid' }] } }) } }));
  const controller = new AbortController();
  const client = new DoubaoApiClient();
  const task = client.withAuthenticatedPage(async () => 'unreachable', controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  expect(closed).toBe(true);
});

it('builds read-only Doubao IM requests with string-preserved IDs', () => {
  expect(buildRecentRequest(200)).toMatchObject({
    cmd: 3200,
    uplink_body: { pull_recent_conv_chain_uplink_body: { limit: 200, option: { not_need_message: true } } },
  });
  expect(buildMessageRequest('9007199254740999', '9007199254740991')).toMatchObject({
    cmd: 3100,
    uplink_body: { pull_singe_chain_uplink_body: { conversation_id: '9007199254740999', anchor_index: 9007199254740991, direction: 1 } },
  });
});

it('refuses message cursors that cannot be represented exactly in the wire protocol', () => {
  expect(() => buildMessageRequest('9007199254740999', '9007199254740992')).toThrow(/游标/);
});

it('imports a long main conversation beyond the old 100-page limit', async () => {
  let calls = 0;
  const page = new DoubaoPage({
    setWindowOpenHandler: () => {},
    executeJavaScript: async () => {
      calls++;
      return { status: 200, text: JSON.stringify({ downlink_body: { pull_singe_chain_downlink_body: {
        messages: [{ message_id: String(calls), index_in_conv: String(1000 - calls), content: '{"text":"内容"}', user_type: 1 }],
        has_more: calls < 101,
      } } }) };
    },
  });
  const messages = await page.messages('123');
  expect(messages).toHaveLength(101);
  expect(messages[0]?.id).toBe('101');
});

it('stops repeated message pages instead of repeatedly requesting the same content', async () => {
  let calls = 0;
  const page = new DoubaoPage({
    setWindowOpenHandler: () => {},
    executeJavaScript: async () => {
      calls++;
      return { status: 200, text: JSON.stringify({ downlink_body: { pull_singe_chain_downlink_body: {
        messages: [{ message_id: 'same', index_in_conv: String(1000 - calls), content: '{"text":"内容"}', user_type: 1 }],
        has_more: true,
      } } }) };
    },
  });
  await expect(page.messages('123')).rejects.toThrow(/重复/);
  expect(calls).toBe(2);
});

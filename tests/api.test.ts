import { expect, it } from 'vitest';
import { buildMessageRequest, buildRecentRequest, DoubaoPage } from '../src/api';

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

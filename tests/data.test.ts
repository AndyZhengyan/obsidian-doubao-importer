import { describe, expect, it } from 'vitest';
import { mergeManagedNote, parseConversationList, parseMessagePage, renderNote } from '../src/data';

describe('Doubao payloads', () => {
  it('keeps large conversation IDs as strings and rejects malformed lists', () => {
    const page = { downlink_body: { pull_recent_conv_chain_downlink_body: { cells: [
      { conversation: { conversation_id: '9007199254740999', name: '测试', create_time: '1700000000', update_time: '1700000100' } },
    ] } } };
    expect(parseConversationList(page)[0]?.id).toBe('9007199254740999');
    expect(() => parseConversationList({ downlink_body: {} })).toThrow(/会话列表/);
  });

  it('parses text blocks and advances with the oldest message index', () => {
    const page = { downlink_body: { pull_singe_chain_downlink_body: {
      has_more: true,
      messages: [
        { message_id: 'a', index_in_conv: '12', user_type: 1, content_type: 2001, content: '{"text":"你好"}', create_time: '1700000000' },
        { message_id: 'b', index_in_conv: '11', user_type: 2, content_type: 9999, content_block: [
          { block_type: 10000, content: { text_block: { text: '你好！' } } },
        ], create_time: '1700000001' },
      ],
    } } };
    expect(parseMessagePage(page)).toMatchObject({
      hasMore: true,
      nextAnchor: '10',
      messages: [{ role: 'user', text: '你好' }, { role: 'assistant', text: '你好！' }],
    });
  });

  it('does not silently discard unsupported message content', () => {
    const page = { downlink_body: { pull_singe_chain_downlink_body: { has_more: false, messages: [
      { message_id: 'x', index_in_conv: '1', user_type: 2, content_type: 9999, content_block: [{ block_type: 55555, content: {} }] },
    ] } } };
    expect(parseMessagePage(page).messages[0]?.text).toContain('暂未解析');
  });
});

describe('Markdown ownership', () => {
  const conversation = { id: '9007199254740999', title: '测试对话', created: '1700000000', modified: '1700000100' };
  const messages = [{ id: '1', index: '1', role: 'user' as const, text: '你好', created: '1700000000' }];

  it('uses compatible frontmatter and one managed content region', () => {
    const note = renderNote(conversation, messages);
    expect(note).toContain('uid: "9007199254740999"');
    expect(note).toContain('source: 豆包');
    expect(note).toContain('doubao_sync_schema: 1');
    expect(note).toMatch(/doubao_source_hash: "sha256:[a-f0-9]{64}"/);
    expect(note).toContain('<!-- doubao-sync:source-body:start -->');
    expect(note).toContain('### 我');
  });

  it('preserves manual content outside the managed region', () => {
    const before = renderNote(conversation, messages) + '\n## 我的批注\n不要改\n';
    const updated = mergeManagedNote(before, renderNote(conversation, [{ ...messages[0]!, text: '新内容' }]));
    expect(updated).toContain('新内容');
    expect(updated).toContain('## 我的批注\n不要改');
    expect(updated).not.toContain('### 我\n\n你好\n');
  });

  it('refuses to replace notes with damaged managed markers', () => {
    expect(() => mergeManagedNote('---\nuid: "9007199254740999"\n---\n手写内容', renderNote(conversation, messages))).toThrow(/边界/);
  });
});

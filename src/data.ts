import { createHash } from 'crypto';

export interface Conversation {
  id: string;
  title: string;
  created: string;
  modified: string;
}

export interface Message {
  id: string;
  index: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  created: string;
}

type RecordValue = Record<string, unknown>;
const START = '<!-- doubao-sync:source-body:start -->';
const END = '<!-- doubao-sync:source-body:end -->';

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function stringId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return '';
}

function timeValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function parseConversationPage(payload: unknown) {
  const body = record(record(record(payload).downlink_body).pull_recent_conv_chain_downlink_body);
  if (!Array.isArray(body.cells)) throw new Error('豆包会话列表响应格式已变化');
  const seen = new Set<string>();
  const conversations = body.cells.flatMap(cell => {
    const source = record(record(cell).conversation);
    const id = stringId(source.conversation_id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      title: typeof source.name === 'string' ? source.name : '',
      created: timeValue(source.create_time),
      modified: timeValue(source.update_time),
    }];
  });
  return { conversations, hasMore: body.has_more, nextVersion: body.next_conv_version };
}

export function parseConversationList(payload: unknown): Conversation[] {
  return parseConversationPage(payload).conversations;
}

function parseText(source: RecordValue): string {
  const blocks = Array.isArray(source.content_block) ? source.content_block : [];
  const parts: string[] = [];
  let unsupported = false;
  for (const rawBlock of blocks) {
    const block = record(rawBlock);
    const content = record(block.content);
    if (block.block_type === 10000) {
      const value = record(content.text_block).text;
      if (typeof value === 'string' && value) parts.push(value);
    } else if (block.block_type === 10052) {
      const attachments = record(content.attachment_block).attachments;
      if (Array.isArray(attachments)) {
        for (const rawAttachment of attachments) {
          const attachment = record(rawAttachment);
          const image = record(record(attachment.image).image_ori);
          const file = record(attachment.file);
          const url = image.url ?? file.url;
          const name = file.name;
          if (typeof url === 'string' && /^https?:\/\//.test(url)) parts.push(`附件：${typeof name === 'string' ? name : '图片'} — ${url}`);
          else if (typeof name === 'string') parts.push(`附件：${name}（原始链接不可用）`);
          else unsupported = true;
        }
      } else unsupported = true;
    } else if (block.block_type === 10056) {
      const reference = record(content.reference_block);
      const url = record(reference.url);
      if (typeof url.url === 'string' && /^https?:\/\//.test(url.url)) {
        parts.push(`来源：${typeof url.title === 'string' ? url.title : url.url} — ${url.url}`);
      } else unsupported = true;
    } else if (block.block_type !== 10040) {
      unsupported = true;
    }
  }
  if (parts.length === 0) {
    const raw = source.content;
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    }
    if (typeof parsed === 'string') parts.push(parsed);
    else {
      const text = record(parsed).text;
      if (typeof text === 'string' && text) parts.push(text);
      const images = record(parsed).images;
      if (Array.isArray(images)) for (const image of images) {
        const url = typeof image === 'string' ? image : record(image).url ?? record(record(image).image_ori).url;
        if (typeof url === 'string' && /^https?:\/\//.test(url)) parts.push(`图片：${url}`);
      }
    }
  }
  if (unsupported || parts.length === 0) parts.push('〔此消息包含暂未解析的豆包内容，请在原对话查看〕');
  return parts.join('\n\n');
}

export function parseMessagePage(payload: unknown): { messages: Message[]; hasMore: boolean; nextAnchor: string | null } {
  const body = record(record(record(payload).downlink_body).pull_singe_chain_downlink_body);
  if (!Array.isArray(body.messages)) throw new Error('豆包消息响应格式已变化');
  let oldest: bigint | null = null;
  const messages = body.messages.flatMap(raw => {
    const source = record(raw);
    const id = stringId(source.message_id);
    const index = stringId(source.index_in_conv);
    if (!id || !/^\d+$/.test(index)) return [];
    const numericIndex = BigInt(index);
    if (oldest === null || numericIndex < oldest) oldest = numericIndex;
    const type = source.user_type;
    const role = type === 1 || type === '1' ? 'user' : type === 3 || type === '3' ? 'system' : 'assistant';
    return [{ id, index, role, text: parseText(source), created: timeValue(source.create_time) } satisfies Message];
  });
  const nextAnchor = oldest === null || oldest === 0n ? null : String(oldest - 1n);
  return { messages, hasMore: body.has_more === true, nextAnchor };
}

function yaml(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, ' '));
}

export function timestampMs(value: string): number {
  if (!/^\d+$/.test(value)) return NaN;
  const number = Number(value);
  return new Date(value.length > 12 ? number : number * 1000).getTime();
}

function formatTime(value: string): string {
  const date = new Date(timestampMs(value));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function managedBody(messages: Message[]): string {
  return messages.map(message => {
    const role = message.role === 'user' ? '我' : message.role === 'assistant' ? '豆包' : '系统';
    const time = formatTime(message.created);
    return `### ${role}${time ? ` · ${time}` : ''}\n\n${message.text.trim()}\n`;
  }).join('\n');
}

export function renderNote(conversation: Conversation, messages: Message[]): string {
  const title = conversation.title.trim() || `豆包对话 ${conversation.id}`;
  const sourceBody = managedBody(messages);
  const hash = createHash('sha256').update(sourceBody).digest('hex');
  const fields = [
    `uid: ${yaml(conversation.id)}`,
    `title: ${yaml(title)}`,
    'source: 豆包',
    'conversation_type: chat',
    'tags: []',
    `source_url: ${yaml(`https://www.doubao.com/chat/${conversation.id}`)}`,
    `message_count: ${messages.length}`,
    'doubao_sync_schema: 1',
    `doubao_source_hash: "sha256:${hash}"`,
  ];
  if (formatTime(conversation.created)) fields.splice(2, 0, `created: ${formatTime(conversation.created)}`);
  if (formatTime(conversation.modified)) fields.splice(formatTime(conversation.created) ? 3 : 2, 0, `modified: ${formatTime(conversation.modified)}`);
  return `---\n${fields.join('\n')}\n---\n\n${START}\n${sourceBody}${END}\n`;
}

function region(content: string): { start: number; end: number } {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start < 0 || end < start || content.indexOf(START, start + START.length) >= 0 || content.indexOf(END, end + END.length) >= 0) {
    throw new Error('笔记的豆包正文边界缺失或重复，已跳过以保护本地内容');
  }
  return { start, end: end + END.length };
}

export function mergeManagedNote(existing: string, incoming: string): string {
  const oldRegion = region(existing);
  const newRegion = region(incoming);
  const oldFrontmatter = /^---\n([\s\S]*?)\n---\n/.exec(existing);
  const newFrontmatter = /^---\n([\s\S]*?)\n---\n/.exec(incoming);
  if (!oldFrontmatter || !newFrontmatter) throw new Error('笔记 frontmatter 无法识别，已跳过');
  const oldUid = /^uid: (.+)$/m.exec(oldFrontmatter[1])?.[1];
  const newUid = /^uid: (.+)$/m.exec(newFrontmatter[1])?.[1];
  if (!oldUid || oldUid !== newUid) throw new Error('笔记 uid 不匹配，已跳过');
  const owned = new Set(['title', 'created', 'modified', 'source', 'conversation_type', 'source_url', 'message_count', 'doubao_sync_schema', 'doubao_source_hash']);
  const newLines = new Map(newFrontmatter[1].split('\n').map(line => [line.split(':', 1)[0], line]));
  const oldLines = oldFrontmatter[1].split('\n').map(line => owned.has(line.split(':', 1)[0]) ? newLines.get(line.split(':', 1)[0]) ?? line : line);
  for (const key of owned) if (!oldLines.some(line => line.startsWith(`${key}:`))) {
    const line = newLines.get(key);
    if (line) oldLines.push(line);
  }
  const merged = existing.slice(0, oldRegion.start) + incoming.slice(newRegion.start, newRegion.end) + existing.slice(oldRegion.end);
  return merged.replace(/^---\n[\s\S]*?\n---\n/, `---\n${oldLines.join('\n')}\n---\n`);
}

import { parseConversationList, parseConversationPage, parseMessagePage, type Conversation, type Message } from './data';
import { verifyLoginSession, watchLogin } from './login';
import { createHash } from 'crypto';
import { abortable, checkCancelled } from './cancellation';

const PARTITION = 'persist:doubao-sync';
const CHAT_URL = 'https://www.doubao.com/chat/';
const MAX_PAGES_PER_CONVERSATION = 1000;

export class DoubaoAuthError extends Error {
  constructor() { super('豆包登录已失效，请重新登录'); }
}

interface WebContents {
  executeJavaScript(script: string): Promise<unknown>;
  setWindowOpenHandler(handler: () => { action: 'deny' }): void;
}
interface Window {
  webContents: WebContents;
  loadURL(url: string): Promise<void>;
  show(): void;
  isDestroyed(): boolean;
  close(): void;
  once(event: 'closed', callback: () => void): void;
}
interface Session {
  cookies: { get(filter: { url: string }): Promise<Array<{ name: string }>> };
  clearStorageData(): Promise<void>;
}
interface ElectronRemote {
  BrowserWindow: new (options: Record<string, unknown>) => Window;
  session: { fromPartition(partition: string): Session };
}

function loadElectron(): ElectronRemote {
  const requireFn = (globalThis as typeof globalThis & { require?: (name: string) => unknown }).require;
  if (!requireFn) throw new Error('当前 Obsidian 无法使用桌面登录窗口');
  for (const name of ['@electron/remote', 'electron']) {
    try {
      const candidate = requireFn(name) as ElectronRemote & { remote?: ElectronRemote };
      const remote = candidate?.remote ?? candidate;
      if (typeof remote?.BrowserWindow === 'function' && typeof remote?.session?.fromPartition === 'function') return remote;
    } catch { /* Try the next Electron entry point. */ }
  }
  throw new Error('当前 Obsidian 无法使用桌面登录窗口');
}

function envelope(cmd: number, uplink_body: Record<string, unknown>): Record<string, unknown> {
  return { cmd, uplink_body, sequence_id: globalThis.crypto.randomUUID(), channel: 2, version: '1' };
}

export function buildRecentRequest(limit: number, cursor = 0): Record<string, unknown> {
  return envelope(3200, { pull_recent_conv_chain_uplink_body: {
    limit,
    message_count_per_conv: 0,
    api_version: 1,
    conv_version: cursor,
    direction: cursor ? 1 : 3,
    option: {
      not_need_message: true,
      need_complete_conversation: true,
      need_coco_conversation: cursor === 0,
      need_coco_bot: cursor === 0,
    },
  } });
}

export function buildMessageRequest(conversationId: string, anchor: string): Record<string, unknown> {
  if (!/^\d+$/.test(conversationId) || !/^\d+$/.test(anchor)) throw new Error('无效的豆包会话或消息游标');
  const cursor = Number(anchor);
  if (!Number.isSafeInteger(cursor)) throw new Error('豆包消息游标超出精确表示范围');
  return envelope(3100, { pull_singe_chain_uplink_body: {
    conversation_id: conversationId,
    anchor_index: cursor,
    conversation_type: 3,
    direction: 1,
    limit: 50,
    ext: {},
    filter: { index_list: [] },
    evaluate_ab_params: '',
    evaluate_common_params: '',
  } });
}

function parseResponse(text: string): unknown {
  const safeText = text.replace(/"(conversation_id|message_id|index_in_conv|anchor_index|create_time|update_time)"\s*:\s*(\d{16,})/g, '"$1":"$2"');
  const payload: unknown = JSON.parse(safeText);
  const status = (payload as { status_code?: unknown }).status_code;
  if (status !== undefined && status !== 0) throw new Error(`豆包接口返回错误状态 ${String(status)}`);
  return payload;
}

export class DoubaoApiClient {
  private readonly electron = loadElectron();
  private readonly session = this.electron.session.fromPartition(PARTITION);
  private loginWindow: Window | null = null;
  private stopLoginWatch: (() => void) | null = null;
  private readonly windows = new Set<Window>();

  constructor(private readonly onLogin: () => void = () => {}) {}

  openLogin(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show();
      return;
    }
    const window = this.createWindow(true);
    this.loginWindow = window;
    this.stopLoginWatch = watchLogin(() => verifyLoginSession(
      () => this.isLoggedIn(),
      () => new DoubaoPage(window.webContents).conversations(),
    ), () => {
      if (!window.isDestroyed()) window.close();
      this.onLogin();
    });
    window.once('closed', () => {
      this.stopLoginWatch?.();
      this.stopLoginWatch = null;
      this.loginWindow = null;
    });
    void window.loadURL(CHAT_URL).catch(() => {
      if (!window.isDestroyed()) window.close();
    });
  }

  async isLoggedIn(): Promise<boolean> {
    const cookies = await this.session.cookies.get({ url: CHAT_URL });
    return cookies.some(cookie => cookie.name === 'sessionid' || cookie.name === 'session_id');
  }

  async logout(): Promise<void> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.close();
    this.loginWindow = null;
    await this.session.clearStorageData();
  }

  dispose(): void {
    this.stopLoginWatch?.();
    this.stopLoginWatch = null;
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.close();
    this.loginWindow = null;
    for (const window of this.windows) if (!window.isDestroyed()) window.close();
    this.windows.clear();
  }

  async withAuthenticatedPage<T>(action: (client: DoubaoPage) => Promise<T>, signal?: AbortSignal): Promise<T> {
    checkCancelled(signal);
    if (!await this.isLoggedIn()) throw new DoubaoAuthError();
    checkCancelled(signal);
    const window = this.createWindow(false);
    const close = () => { if (!window.isDestroyed()) window.close(); };
    signal?.addEventListener('abort', close, { once: true });
    try {
      await abortable(window.loadURL(CHAT_URL), signal);
      checkCancelled(signal);
      const client = new DoubaoPage(window.webContents, signal);
      // Page requests observe cancellation; let the action return its partial results.
      return await action(client);
    } finally {
      signal?.removeEventListener('abort', close);
      close();
    }
  }

  private createWindow(show: boolean): Window {
    const window = new this.electron.BrowserWindow({
      width: 960,
      height: 760,
      show,
      title: 'Doubao Sync',
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    this.windows.add(window);
    window.once('closed', () => this.windows.delete(window));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return window;
  }
}

export class DoubaoPage {
  private firstPages = new Map<string, ReturnType<typeof parseMessagePage>>();
  constructor(private readonly webContents: WebContents, private readonly signal?: AbortSignal) {}

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    checkCancelled(this.signal);
    const params = new URLSearchParams({
      version_code: '20800', language: 'zh', device_platform: 'web', aid: '497858',
      real_aid: '497858', pkg_type: 'release_version', region: 'CN',
      sys_region: 'CN', samantha_web: '1', web_platform: 'browser',
      'use-olympus-account': '1', web_tab_id: globalThis.crypto.randomUUID(),
    });
    const url = `https://www.doubao.com${path}?${params}`;
    const script = `(async () => {
      const response = await fetch(${JSON.stringify(url)}, {
        method: 'POST', credentials: 'include', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json; encoding=utf-8', 'agw-js-conv': 'str' },
        body: ${JSON.stringify(JSON.stringify(body))}
      });
      return { status: response.status, text: await response.text() };
    })()`;
    const result = await abortable(this.webContents.executeJavaScript(script), this.signal) as { status: number; text: string };
    checkCancelled(this.signal);
    if (result.status === 401 || result.status === 403) throw new DoubaoAuthError();
    if (result.status !== 200) throw new Error(`豆包接口 HTTP ${result.status}`);
    return parseResponse(result.text);
  }

  async conversations(): Promise<Conversation[]> {
    const response = await this.post('/im/chain/recent_conv', buildRecentRequest(200));
    return parseConversationList(response);
  }

  async allConversations(onPage?: (page: number, count: number) => void): Promise<Conversation[]> {
    const conversations = new Map<string, Conversation>();
    let cursor = 0;
    for (let pageNumber = 1; pageNumber <= 1000; pageNumber++) {
      const response = await this.post('/im/chain/recent_conv', buildRecentRequest(100, cursor));
      const page = parseConversationPage(response);
      for (const conversation of page.conversations) {
        if (!conversations.has(conversation.id)) conversations.set(conversation.id, conversation);
      }
      onPage?.(pageNumber, conversations.size);
      if (page.hasMore === false) return [...conversations.values()];
      const raw = page.nextVersion;
      const next = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw)) ? Number(raw) : NaN;
      if (page.hasMore !== true || !Number.isSafeInteger(next) || next <= 0 || (cursor > 0 && next >= cursor)) {
        throw new Error('豆包会话列表分页未能继续，未开始写入笔记。');
      }
      cursor = next;
    }
    throw new Error('豆包会话列表超过 1000 页，未开始写入笔记。');
  }

  async version(conversationId: string): Promise<string> {
    const response = await this.post('/im/chain/single', buildMessageRequest(conversationId, '9007199254740991'));
    const page = parseMessagePage(response);
    if (page.hasMore && !page.messages.length) throw new Error('豆包消息版本页为空，未写入不完整内容');
    this.firstPages.set(conversationId, page);
    const messages = [...page.messages].sort((a, b) => BigInt(a.index) < BigInt(b.index) ? -1 : BigInt(a.index) > BigInt(b.index) ? 1 : a.id.localeCompare(b.id));
    return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  }

  async messages(conversationId: string, onPage?: (page: number, count: number) => void): Promise<Message[]> {
    const seen = new Set<string>();
    const messages: Message[] = [];
    let anchor = '9007199254740991';
    for (let page = 0; page < MAX_PAGES_PER_CONVERSATION; page++) {
      checkCancelled(this.signal);
      let parsed = page === 0 ? this.firstPages.get(conversationId) : undefined;
      this.firstPages.delete(conversationId);
      if (!parsed) {
        const response = await this.post('/im/chain/single', buildMessageRequest(conversationId, anchor));
        parsed = parseMessagePage(response);
      }
      const previousCount = messages.length;
      for (const message of parsed.messages) if (!seen.has(message.id)) {
        seen.add(message.id);
        messages.push(message);
      }
      onPage?.(page + 1, messages.length);
      checkCancelled(this.signal);
      if (!parsed.hasMore) return messages.sort((a, b) => BigInt(a.index) < BigInt(b.index) ? -1 : 1);
      if (messages.length === previousCount) throw new Error('豆包消息分页重复或没有有效消息，未写入不完整内容');
      if (!parsed.nextAnchor || BigInt(parsed.nextAnchor) >= BigInt(anchor)) throw new Error('豆包消息分页游标异常');
      anchor = parsed.nextAnchor;
    }
    throw new Error(`豆包对话超过 ${MAX_PAGES_PER_CONVERSATION} 页上限（已读取 ${messages.length} 条消息），未写入不完整内容`);
  }
}

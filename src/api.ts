import { parseConversationList, parseMessagePage, type Conversation, type Message } from './data';

const PARTITION = 'persist:doubao-sync';
const CHAT_URL = 'https://www.doubao.com/chat/';
const MAX_PAGES_PER_CONVERSATION = 100;

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

export function buildRecentRequest(limit: number): Record<string, unknown> {
  return envelope(3200, { pull_recent_conv_chain_uplink_body: {
    limit,
    message_count_per_conv: 0,
    api_version: 1,
    conv_version: 0,
    direction: 3,
    option: {
      not_need_message: true,
      need_complete_conversation: true,
      need_coco_conversation: true,
      need_coco_bot: true,
    },
  } });
}

export function buildMessageRequest(conversationId: string, anchor: string): Record<string, unknown> {
  if (!/^\d+$/.test(conversationId) || !/^\d+$/.test(anchor)) throw new Error('无效的豆包会话或消息游标');
  return envelope(3100, { pull_singe_chain_uplink_body: {
    conversation_id: conversationId,
    anchor_index: anchor,
    conversation_type: 3,
    direction: 1,
    limit: 50,
    ext: {},
    filter: { index_list: [] },
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

  openLogin(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show();
      return;
    }
    const window = this.createWindow(true);
    this.loginWindow = window;
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

  async withAuthenticatedPage<T>(action: (client: DoubaoPage) => Promise<T>): Promise<T> {
    if (!await this.isLoggedIn()) throw new Error('请先在设置中登录豆包');
    const window = this.createWindow(false);
    try {
      await window.loadURL(CHAT_URL);
      const client = new DoubaoPage(window.webContents);
      return await action(client);
    } finally {
      if (!window.isDestroyed()) window.close();
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
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return window;
  }
}

export class DoubaoPage {
  constructor(private readonly webContents: WebContents) {}

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const params = new URLSearchParams({
      version_code: '20800', language: 'zh', device_platform: 'web', aid: '497858',
      real_aid: '497858', pkg_type: 'release_version', region: 'CN',
      sys_region: 'CN', samantha_web: '1', web_platform: 'browser',
      'use-olympus-account': '1', web_tab_id: globalThis.crypto.randomUUID(),
    });
    const url = `https://www.doubao.com${path}?${params}`;
    const script = `(async () => {
      const response = await fetch(${JSON.stringify(url)}, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json; encoding=utf-8', 'agw-js-conv': 'str' },
        body: ${JSON.stringify(JSON.stringify(body))}
      });
      return { status: response.status, text: await response.text() };
    })()`;
    const result = await this.webContents.executeJavaScript(script) as { status: number; text: string };
    if (result.status === 401 || result.status === 403) throw new DoubaoAuthError();
    if (result.status !== 200) throw new Error(`豆包接口 HTTP ${result.status}`);
    return parseResponse(result.text);
  }

  async conversations(): Promise<Conversation[]> {
    const response = await this.post('/im/chain/recent_conv', buildRecentRequest(200));
    return parseConversationList(response);
  }

  async messages(conversationId: string): Promise<Message[]> {
    const seen = new Set<string>();
    const messages: Message[] = [];
    let anchor = '9007199254740991';
    for (let page = 0; page < MAX_PAGES_PER_CONVERSATION; page++) {
      const response = await this.post('/im/chain/single', buildMessageRequest(conversationId, anchor));
      const parsed = parseMessagePage(response);
      for (const message of parsed.messages) if (!seen.has(message.id)) {
        seen.add(message.id);
        messages.push(message);
      }
      if (!parsed.hasMore) return messages.sort((a, b) => BigInt(a.index) < BigInt(b.index) ? -1 : 1);
      if (!parsed.nextAnchor || BigInt(parsed.nextAnchor) >= BigInt(anchor)) throw new Error('豆包消息分页游标异常');
      anchor = parsed.nextAnchor;
    }
    throw new Error('豆包对话超过单次同步页数上限，未写入不完整内容');
  }
}

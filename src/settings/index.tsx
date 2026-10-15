import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { ConnectionState, SettingsActions, SettingsView } from '../types';
import { SettingItem } from './setting-item';
import { Toggle } from './toggle';

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  unverified: '连接待验证', checking: '正在检查连接', connected: '已连接',
  'signed-out': '未登录', expired: '登录已失效', error: '连接检查失败',
};
const PHASE_LABELS = { idle: '就绪', listing: '正在获取会话', reading: '正在读取对话', writing: '正在保存',
  success: '同步完成', partial: '部分完成', failed: '同步失败', cancelled: '已取消' };

export function SettingsComponent({ view, actions }: { view: SettingsView; actions: SettingsActions }) {
  const { settings, connection, task } = view;
  const [folder, setFolder] = useState(settings.folder);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [syncRequested, setSyncRequested] = useState(false);
  const syncRequestedRef = useRef(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  useEffect(() => { if (!task.running) setCancelling(false); }, [task.running]);
  const folderListId = useId();
  const scheduleId = useId();
  const signedOut = connection === 'signed-out' || connection === 'expired';
  const perform = async (action: () => Promise<void>) => {
    setOperationError('');
    try { await action(); } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
  };
  const update = <K extends 'folder' | 'intervalMinutes' | 'scheduledEnabled' | 'syncOnStart'>(key: K, value: typeof settings[K]) => {
    void perform(() => actions.update(key, value));
  };
  const timestamp = new Date(settings.lastSyncAt);
  const lastSync = settings.lastSyncAt && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleString() : '从未同步';
  const scheduledSummary = settings.scheduledEnabled
    ? `每 ${settings.intervalMinutes} 分钟 · ${settings.syncOnStart ? '启动时同步' : '启动时不同步'}`
    : '仅手动同步';

  return <div className="doubao-settings">
    <header className="doubao-settings-header">
      <h2>豆包同步 <small>by 关山的月儿</small></h2>
      <p className="doubao-settings-desc">将自己的豆包对话保存为本地 Markdown，保留笔记中的手写内容。</p>
    </header>
    <div className="doubao-settings-status-bar">
      <div className="doubao-status-copy">
        <strong>豆包账号</strong>
        <span className={`doubao-connection doubao-connection-${connection}`} role="status">{CONNECTION_LABELS[connection]}</span>
        <span>任务：{PHASE_LABELS[task.phase]}</span>
        <span>上次同步：{lastSync}</span>
      </div>
      <div className="doubao-status-actions">
        <button type="button" disabled={task.running || connection === 'checking' || connectionBusy} onClick={() => {
          setConnectionBusy(true);
          void perform(() => actions.checkConnection()).finally(() => setConnectionBusy(false));
        }}>测试连接</button>
        <button type="button" disabled={task.running} onClick={() => { try { actions.login(); } catch (error) { setOperationError(String(error)); } }}>
          {connection === 'expired' ? '重新登录' : '登录豆包'}
        </button>
        <button type="button" disabled={connection === 'signed-out'} onClick={() => void perform(() => actions.logout())}>退出登录</button>
      </div>
      {view.connectionMessage && <p className="doubao-connection-message">{view.connectionMessage}</p>}
    </div>

    {task.phase !== 'idle' && <section className={`doubao-task doubao-task-${task.phase}`} role="status" aria-live="polite">
      <div className="doubao-task-heading">
        <strong>{task.message || PHASE_LABELS[task.phase]}</strong>
        {task.running && <button type="button" className="mod-warning" disabled={cancelling} onClick={() => {
          setCancelling(true);
          actions.cancel();
        }}>{cancelling ? '正在取消…' : '取消同步'}</button>}
      </div>
      {task.currentTitle && <div className="doubao-task-title">{task.currentTitle}</div>}
      <div className="doubao-task-counts">
        <span>会话：{task.processed}{task.total !== undefined ? ` / ${task.total}` : ''}</span>
        {task.page !== undefined && <span>第 {task.page} 页</span>}
        {task.messageCount !== undefined && <span>已读取 {task.messageCount} 条消息</span>}
      </div>
      {task.running && <div className="doubao-task-activity" aria-hidden="true" />}
    </section>}
    {operationError && <p role="alert" className="doubao-error">{operationError}</p>}
    {signedOut && <p className="doubao-guidance">{connection === 'expired' ? '重新登录后即可继续同步，已保存的笔记不会删除。' : '先登录豆包，再点击「立即同步」。也可以只使用手动同步。'}</p>}

    <section className="doubao-settings-section">
      <h3>同步</h3>
      <SettingItem name="同步目录" description="可选择已有目录，也可输入新目录。">
        <div className="doubao-input-stack">
          <input type="text" aria-label="同步目录" list={folderListId} value={folder} onInput={event => {
            const value = event.currentTarget.value;
            setFolder(value);
            update('folder', value);
          }} />
          <datalist id={folderListId}>{actions.folders(folder).map(path => <option key={path} value={path} />)}</datalist>
        </div>
      </SettingItem>
      <SettingItem name="自动同步" description="Obsidian 桌面端运行时执行。关闭后仍可手动同步。">
        <div className="doubao-input-stack">
          <div className="doubao-scheduled-row">
            <Toggle value={settings.scheduledEnabled} ariaLabel="自动同步" onChange={value => update('scheduledEnabled', value)} />
            <button type="button" className="doubao-disclosure" aria-expanded={scheduledOpen} aria-controls={scheduleId}
              onClick={() => setScheduledOpen(open => !open)}>{scheduledOpen ? '收起自动同步设置' : '展开自动同步设置'}</button>
          </div>
          <small className="doubao-setting-summary">{scheduledSummary}</small>
          <div id={scheduleId} hidden={!scheduledOpen} className="doubao-scheduled-details">
            <label className="doubao-scheduled-row">同步周期
              <select aria-label="同步周期" value={settings.intervalMinutes}
                onChange={event => update('intervalMinutes', Number(event.currentTarget.value))}>
                {[30, 60, 120].map(minutes => <option value={minutes} key={minutes}>每 {minutes} 分钟</option>)}
              </select>
            </label>
            <div className="doubao-scheduled-row"><span>启动时同步</span>
              <Toggle value={settings.syncOnStart} ariaLabel="启动时同步" onChange={value => update('syncOnStart', value)} />
            </div>
          </div>
        </div>
      </SettingItem>
      <SettingItem name="立即同步" description="读取最近的对话，按会话生成或更新笔记。">
        <button type="button" className="mod-cta" disabled={task.running || syncRequested || signedOut || connection === 'checking'}
          onClick={() => {
            if (task.running || syncRequestedRef.current) return;
            syncRequestedRef.current = true;
            setCancelling(false); setSyncRequested(true);
            void perform(() => actions.sync()).finally(() => { syncRequestedRef.current = false; setSyncRequested(false); });
          }}>立即同步</button>
      </SettingItem>
      <SettingItem name="同步日志" description="保留最近 30 天的结果与逐会话错误，不保存对话正文。">
        <button type="button" onClick={() => actions.showHistory()}>查看同步日志</button>
      </SettingItem>
      {settings.lastSummary && <p className="doubao-settings-desc">上次结果：{settings.lastSummary}</p>}
    </section>
    <details className="doubao-advanced">
      <summary>高级说明</summary>
      <p>每次覆盖最近至多 200 个会话，每个会话最多读取 1000 页。超出范围会明确提示，失败或取消的未完成会话不会推进检查点。</p>
      <p>只更新本插件管理的正文区域，保留手写批注和自定义属性。远端对话消失不会删除本地笔记。</p>
      <p>登录态仅保存在本机独立会话中。当前不提供附件下载、双向同步或移动端同步。</p>
    </details>
  </div>;
}

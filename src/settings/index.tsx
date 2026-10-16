// Layout and interactions ported from obsidian-getnote-importer (MIT).
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { App } from 'obsidian';
import type { SettingsActions, SettingsView } from '../types';
import { CONNECTION_LABELS, PHASE_LABELS } from '../ui/text';
import { SettingItem } from './setting-item';
import { Toggle } from './toggle';
import { ExternalLink } from './external-link';
import { PathSuggest } from './path-suggest';

export function SettingsComponent({ app, view, actions }: { app: App; view: SettingsView; actions: SettingsActions }) {
  const { settings, connection, task } = view;
  const signedOut = connection === 'signed-out' || connection === 'expired';
  const [folder, setFolder] = useState(settings.folder);
  const [interval, setInterval] = useState(String(settings.intervalMinutes));
  const [intervalError, setIntervalError] = useState('');
  const [credentialsOpen, setCredentialsOpen] = useState(signedOut || (connection === 'unverified' && !settings.syncHistory.length));
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [syncRequested, setSyncRequested] = useState(false);
  const syncRequestedRef = useRef(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const foldersRef = useRef(actions.folders);
  foldersRef.current = actions.folders;
  useEffect(() => {
    if (!folderRef.current) return;
    const suggest = new PathSuggest(app, folderRef.current, query => foldersRef.current(query));
    return () => suggest.close();
  }, [app]);
  useEffect(() => { if (!task.running) setCancelling(false); }, [task.running]);
  useEffect(() => {
    if (connection === 'connected') setCredentialsOpen(false);
    else if (signedOut) setCredentialsOpen(true);
  }, [connection, signedOut]);
  useEffect(() => { setInterval(String(settings.intervalMinutes)); }, [settings.intervalMinutes]);
  const credentialId = useId(), scheduleId = useId(), syncId = useId(), advancedId = useId(), intervalErrorId = useId();
  const perform = async (action: () => Promise<void>) => {
    setOperationError('');
    try { await action(); } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
  };
  const update = <K extends 'folder' | 'intervalMinutes' | 'scheduledEnabled' | 'syncOnStart'>(key: K, value: typeof settings[K]) => {
    void perform(() => actions.update(key, value));
  };
  const timestamp = new Date(settings.lastSyncAt);
  const lastSync = settings.lastSyncAt && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleString() : '暂未同步';
  const scheduledSummary = settings.scheduledEnabled
    ? `每 ${settings.intervalMinutes} 分钟 · ${settings.syncOnStart ? '启动时' : '不在启动时同步'} · 仅下载`
    : '未启用 · 仅手动同步';
  const testing = connection === 'checking' || connectionBusy;
  const determinate = task.phase !== 'listing' && task.total !== undefined && task.total > 0;
  const percent = determinate ? Math.max(0, Math.min(100, Math.floor(task.processed / task.total! * 100))) : undefined;
  const loginWaiting = connection === 'unverified' && !!view.connectionMessage;
  const hasAutoHistory = settings.syncHistory.some(entry => entry.source === 'auto' && entry.status === 'success');
  const guidance = signedOut
    ? `${settings.syncHistory.length ? '🔑 还差一步：重新登录后即可继续同步。' : '👋 首次使用：完成网页登录，然后开启自动同步，或手动同步对话。'}详细步骤见下方「凭证设置」。`
    : connection !== 'connected' ? ''
      : !settings.scheduledEnabled ? '凭证已就绪。可在下方开启「自动同步」，也可以手动同步。'
        : !hasAutoHistory ? `✅ 自动同步已开启，将每 ${settings.intervalMinutes} 分钟从豆包同步到 Obsidian。` : '';

  return <div className="doubao-settings doubao-settings-react">
    <div className="doubao-settings-header">
      <h2>🔄 豆包 Sync <span className="doubao-settings-author">by 关山的月儿</span></h2>
      <p className="doubao-settings-desc">豆包 → Obsidian，持续同步，保存为本地 Markdown， <ExternalLink href="https://github.com/AndyZhengyan/obsidian-doubao-importer#readme">欢迎交流、留下star</ExternalLink></p>
    </div>
    <div className={`doubao-settings-status-bar${credentialsOpen ? ' is-credentials-open' : ''}`} data-settings-status>
      <div className="doubao-settings-status-copy">
        <strong>豆包网页登录</strong>
        <span className={`doubao-connection-health doubao-connection-health--${connection}`} role="status"><span className="doubao-connection-health-dot" aria-hidden="true" />{CONNECTION_LABELS[connection]}</span>
        <span>当前状态: {task.running ? '同步中' : PHASE_LABELS[task.phase]}</span>
        <span>上次同步: {lastSync}</span>
      </div>
      <div className="doubao-settings-status-actions">
        <button type="button" className="mod-secondary" disabled={task.running || testing || connection === 'signed-out'} onClick={() => {
          setConnectionBusy(true); void perform(() => actions.checkConnection()).finally(() => setConnectionBusy(false));
        }}>{testing ? '测试中...' : '测试连接'}</button>
        <button type="button" className="mod-secondary" data-change-credentials aria-expanded={credentialsOpen} aria-controls={credentialId}
          onClick={() => setCredentialsOpen(open => !open)}>{credentialsOpen ? '收起凭证' : '更改凭证'}</button>
      </div>
      {view.connectionMessage && <span className={connection === 'error' || connection === 'expired' ? 'doubao-connection-error' : 'doubao-credentials-message'}
        role={connection === 'error' || connection === 'expired' ? 'alert' : 'status'}>{view.connectionMessage}</span>}
    </div>

    {task.phase !== 'idle' && <div className={`doubao-settings-sync-status doubao-settings-sync-status-${task.phase}`} data-sync-progress role="status" aria-live="polite">
      <div className="doubao-settings-sync-status-header">
        <span className="doubao-mono-text">{task.message || PHASE_LABELS[task.phase]}</span>
        {task.running && <button type="button" className="mod-warning doubao-settings-cancel-button" disabled={cancelling} onClick={() => {
          setCancelling(true); actions.cancel();
        }}>{cancelling ? '正在取消…' : '取消同步'}</button>}
      </div>
      {task.running && <div className="doubao-settings-progress-line"><div className={`doubao-settings-progress-track${determinate ? '' : ' is-indeterminate'}`} role="progressbar" aria-label="会话处理进度"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`已处理 ${task.processed}${task.total === undefined ? '' : ` / ${task.total}`} 个会话`}>
        {determinate && <div className="doubao-settings-progress-fill" style={{ width: `${percent}%` }} />}</div>
        {determinate && <span className="doubao-settings-progress-percent">{percent}%</span>}</div>}
      <div className="doubao-settings-progress-count">会话：{task.processed}{task.total !== undefined ? ` / ${task.total}` : ''}{task.page !== undefined && ` · 第 ${task.page} 页`}{task.messageCount !== undefined && ` · 已读取 ${task.messageCount} 条消息`}</div>
      {task.currentTitle && <div className="doubao-settings-progress-count doubao-task-title">{task.currentTitle}</div>}
      {!task.running && settings.lastSummary && <div className="doubao-settings-progress-count">{settings.lastSummary}</div>}
    </div>}
    {operationError && <p role="alert" className="doubao-connection-error">{operationError}</p>}
    {guidance && <div className={`doubao-onboarding doubao-onboarding--${signedOut ? 'needs-credentials' : 'ready'}`} data-credential-guidance>{guidance}</div>}

    <div id={credentialId} data-credential-details className="doubao-credential-panel" hidden={!credentialsOpen}>
      <SettingItem name="凭证设置" description="在独立窗口中登录豆包，登录成功后自动关闭。无需复制 Cookie，登录态仅保存在本机。">
        <div className="doubao-credentials-control">
          <div className="doubao-credentials-message">{signedOut ? '登录后即可同步，已保存的本地笔记不会删除。' : '使用你自己的豆包账号；退出登录不会删除已同步的笔记。'}</div>
          <div className="doubao-credentials-actions">
            <button type="button" className="mod-cta doubao-credential-action-button" disabled={task.running || logoutBusy} onClick={() => {
              setOperationError(''); try { actions.login(); } catch (error) { setOperationError(String(error)); }
            }}>{loginWaiting ? '继续网页登录' : connection === 'expired' ? '重新登录' : '网页登录'}</button>
            <button type="button" className="mod-secondary doubao-credential-action-button" disabled={connection === 'signed-out' || logoutBusy} onClick={() => {
              setLogoutBusy(true); void perform(() => actions.logout()).finally(() => setLogoutBusy(false));
            }}>{logoutBusy ? '正在退出...' : '退出并清除登录'}</button>
          </div>
        </div>
      </SettingItem>
    </div>

    <section className="doubao-settings-section doubao-settings-sync" data-settings-section="sync">
      <button type="button" className="doubao-section-disclosure" data-sync-disclosure aria-expanded={syncOpen} aria-controls={syncId} onClick={() => setSyncOpen(open => !open)}>
        <span className="doubao-section-disclosure-copy"><strong>同步</strong><small>目标文件夹、自动同步、手动同步与日志</small></span><span className={`doubao-disclosure-caret${syncOpen ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      <div id={syncId} data-sync-settings hidden={!syncOpen}>
        <SettingItem name="目标文件夹" description="笔记同步到 vault 内的子目录名（默认：豆包/对话）">
          <input ref={folderRef} type="text" className="doubao-input" aria-label="目标文件夹" placeholder="豆包/对话" value={folder} onInput={event => {
            const value = event.currentTarget.value; setFolder(value); update('folder', value);
          }} />
        </SettingItem>
        <SettingItem name="自动同步" description="让豆包与 Obsidian 自动保持同步；仅在 Obsidian 桌面端运行时执行。">
          <div className="doubao-scheduled-control">
            <div className="doubao-scheduled-row doubao-scheduled-master-row"><span className="doubao-scheduled-row-label">启用自动同步</span>
              <span className="doubao-scheduled-row-control"><Toggle value={settings.scheduledEnabled} ariaLabel="启用自动同步" onChange={value => update('scheduledEnabled', value)} />
                <button type="button" className="doubao-inline-disclosure" data-schedule-disclosure aria-label={scheduledOpen ? '收起自动同步设置' : '展开自动同步设置'} aria-expanded={scheduledOpen} aria-controls={scheduleId}
                  onClick={() => setScheduledOpen(open => !open)}>{scheduledOpen ? '收起' : '展开'}</button></span></div>
            <small className="doubao-setting-summary">{scheduledSummary}</small>
            <div id={scheduleId} className="doubao-scheduled-rows" hidden={!scheduledOpen}>
              <div className="doubao-scheduled-row"><label htmlFor={`${scheduleId}-interval`} className="doubao-scheduled-row-label">同步间隔（分钟）</label>
                <span className="doubao-scheduled-row-control"><input id={`${scheduleId}-interval`} aria-label="同步间隔（分钟）" type="number" min="5" max="1440" step="1" value={interval}
                  aria-invalid={!!intervalError} aria-describedby={intervalError ? intervalErrorId : undefined} onInput={event => {
                    const raw = event.currentTarget.value; setInterval(raw); const value = Number(raw);
                    if (!raw.trim() || !Number.isInteger(value) || value < 5 || value > 1440) { setIntervalError('同步间隔须为 5–1440 分钟的整数，未保存此输入。'); return; }
                    setIntervalError(''); update('intervalMinutes', value);
                  }} /></span></div>
              {intervalError && <div id={intervalErrorId} role="alert" className="doubao-input-hint doubao-input-hint-error">{intervalError}</div>}
              <div className="doubao-scheduled-row"><span className="doubao-scheduled-row-label">启动时同步</span><span className="doubao-scheduled-row-control"><Toggle value={settings.syncOnStart} ariaLabel="启动时同步" onChange={value => update('syncOnStart', value)} /></span></div>
              <div className="doubao-input-hint">自动同步关闭后仍可手动同步；启动时同步仅在自动同步开启时执行。</div>
            </div>
          </div>
        </SettingItem>
        <SettingItem name="手动同步" description="随时发起单次同步，不改变自动同步设置。">
          <div className="doubao-manual-actions"><div className="doubao-manual-action-group"><div className="doubao-manual-action-title">从豆包下载至 Obsidian</div>
            <div className="doubao-actions-row"><button type="button" className="mod-secondary doubao-sync-action-button" disabled={task.running || syncRequested || signedOut || testing} onClick={() => {
              if (task.running || syncRequestedRef.current) return;
              syncRequestedRef.current = true; setCancelling(false); setSyncRequested(true);
              void perform(() => actions.sync()).finally(() => { syncRequestedRef.current = false; setSyncRequested(false); });
            }}>同步对话</button></div></div></div>
        </SettingItem>
        <SettingItem name="同步日志" description="保留最近 30 天同步记录，包含时间、来源、状态和处理数量；不保存对话正文。">
          <div className="doubao-sync-log-section"><div className="doubao-actions-row"><button type="button" className="mod-secondary doubao-view-history-btn" onClick={() => actions.showHistory()}>查看日志</button></div></div>
        </SettingItem>
      </div>
    </section>
    <section className="doubao-settings-section doubao-settings-advanced" data-settings-section="advanced">
      <button type="button" className="doubao-section-disclosure" data-advanced-disclosure aria-expanded={advancedOpen} aria-controls={advancedId} onClick={() => setAdvancedOpen(open => !open)}>
        <span className="doubao-section-disclosure-copy"><strong>高级设置</strong><small>同步范围、笔记保护与登录说明</small></span><span className={`doubao-disclosure-caret${advancedOpen ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      <div id={advancedId} hidden={!advancedOpen}>
        <SettingItem name="同步范围" description="每次读取最近至多 200 个会话，每个会话最多 1000 页。达到上限会提示，不代表已覆盖完整历史。"><span className="doubao-muted-text">最近会话 · 单向下载</span></SettingItem>
        <SettingItem name="笔记保护" description="仅更新本插件管理的正文区域，保留手写批注和自定义属性。远端对话消失不会删除本地笔记。"><span className="doubao-muted-text">按 uid 识别已有笔记</span></SettingItem>
        <SettingItem name="登录与内容" description="登录态仅保存在本机独立会话中。当前不提供附件下载、双向同步或移动端同步。"><ExternalLink href="https://github.com/AndyZhengyan/obsidian-doubao-importer/blob/codex/mvp/README_zh.md">查看使用说明</ExternalLink></SettingItem>
      </div>
    </section>
  </div>;
}

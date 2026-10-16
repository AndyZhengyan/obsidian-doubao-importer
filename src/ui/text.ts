import type { ConnectionState, TaskPhase } from '../types';

// Shared settings/status terminology from Dedao Brain Sync's i18n.ts.
// Provider-specific states are retained rather than presented as API credentials.
export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  unverified: '未验证', checking: '验证中', connected: '认证成功',
  'signed-out': '未登录', expired: '登录已失效', error: '连接异常',
};
export const PHASE_LABELS: Record<TaskPhase, string> = {
  idle: '空闲', listing: '获取会话列表…', reading: '读取会话消息…', writing: '保存笔记…',
  success: '同步完成', partial: '部分失败', failed: '同步失败', cancelled: '已取消',
};

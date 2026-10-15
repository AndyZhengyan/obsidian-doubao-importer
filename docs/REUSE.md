# 姊妹版复用边界

第一轮从 `obsidian-getnote-importer` 的提交 `4a5e2cc7c82a8f03b3169e76db1ebbe9a5b09c95`（MIT）移植成熟组件和设计模式。所有代码随豆包插件构建，不要求安装额外插件。

- `src/settings/setting-item.tsx`：名称、说明、控件三段结构，近原样移植。
- `src/settings/toggle.tsx`：Obsidian 原生开关外观、可访问标签、即时状态和禁用处理。
- `src/settings-tab.tsx`：稳定挂载和运行态刷新模式，改为 `SettingsView` / `SettingsActions`，不依赖得到大脑插件实例。
- `src/ui/sync-history-modal.ts`：分页、折叠摘要、逐项结果、异常展开的交互，适配会话结果。
- `src/types.ts` / `src/history.ts`：采用相同的成功、部分完成、失败、取消语义和30天保留规则；逐条检查点仍使用豆包自己的逻辑。

本轮是有来源记录的组件移植，不是两个仓库已经共同依赖一个公共包。得到大脑原项目未修改。后续再把已在两侧证明稳定的展示组件抽为小型共享包，避免长期维护两份副本。

保留平台专属的 `src/api.ts`、消息解析和笔记渲染，不移入得到大脑的双向同步、知识库、额度与鉴权模式。当前仍保持原笔记 uid、frontmatter、source-body 标记与目录。

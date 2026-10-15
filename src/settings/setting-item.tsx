// Adapted from obsidian-getnote-importer src/settings/setting-item.tsx
// Source commit: 4a5e2cc7c82a8f03b3169e76db1ebbe9a5b09c95 (MIT).
import type { ComponentChildren } from 'preact';

interface SettingItemProps {
  name: string;
  description?: string | ComponentChildren;
  children: ComponentChildren;
}

export function SettingItem({ name, description, children }: SettingItemProps) {
  return <div className="doubao-setting-item">
    <div className="doubao-setting-info">
      <div className="doubao-setting-name">{name}</div>
      {description && <div className="doubao-setting-description">{description}</div>}
    </div>
    <div className="doubao-setting-control">{children}</div>
  </div>;
}

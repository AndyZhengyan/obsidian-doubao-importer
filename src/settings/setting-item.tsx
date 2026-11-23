// Adapted from obsidian-getnote-importer src/settings/setting-item.tsx
// Source commit: 4a5e2cc7c82a8f03b3169e76db1ebbe9a5b09c95 (MIT).
import type { ComponentChildren } from 'preact';

interface SettingItemProps {
  name: string;
  description?: string | ComponentChildren;
  children: ComponentChildren;
}

export function SettingItem({ name, description, children }: SettingItemProps) {
  return <div className="setting-item doubao-setting-item">
    <div className="setting-item-info doubao-setting-info">
      <div className="setting-item-name doubao-setting-name">{name}</div>
      {description && <div className="setting-item-description doubao-setting-description">{description}</div>}
    </div>
    <div className="setting-item-control doubao-setting-control">{children}</div>
  </div>;
}

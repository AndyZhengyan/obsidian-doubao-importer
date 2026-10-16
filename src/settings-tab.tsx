import { App, Plugin, PluginSettingTab } from 'obsidian';
import type { SettingsActions, SettingsView } from './types';
import { render } from 'preact';
import { SettingsComponent } from './settings';

// Stable mounting adapted from obsidian-getnote-importer src/settings-tab.tsx,
// commit 4a5e2cc7c82a8f03b3169e76db1ebbe9a5b09c95 (MIT).
export class DoubaoSettingsTab extends PluginSettingTab {
  private mounted = false;
  constructor(app: App, plugin: Plugin, private readonly getView: () => SettingsView, private readonly actions: SettingsActions) { super(app, plugin); }
  display(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.updateRuntimeState();
  }
  hide(): void {
    if (!this.mounted) return;
    render(null, this.containerEl);
    this.mounted = false;
  }
  updateRuntimeState(): void {
    if (this.mounted) render(<SettingsComponent app={this.app} view={this.getView()} actions={this.actions} />, this.containerEl);
  }
}

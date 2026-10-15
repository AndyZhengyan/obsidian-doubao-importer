export class PluginSettingTab {
  containerEl = document.createElement('div');
  constructor(public app: unknown, public plugin: unknown) {}
}

export class Modal {
  contentEl = document.createElement('div');
  constructor(public app: unknown) {}
  onOpen(): void {}
  open(): void { document.body.append(this.contentEl); this.onOpen(); }
  close(): void { this.contentEl.remove(); }
}

// Ported from obsidian-getnote-importer src/settings/index.tsx (MIT).
import { AbstractInputSuggest, type App } from 'obsidian';

export class PathSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private readonly input: HTMLInputElement, private readonly paths: (query: string) => string[]) { super(app, input); }
  getSuggestions(query: string): string[] { return this.paths(query); }
  renderSuggestion(value: string, el: HTMLElement): void { el.textContent = value; }
  selectSuggestion(value: string): void {
    this.input.value = value;
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}

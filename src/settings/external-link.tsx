// Ported from obsidian-getnote-importer src/settings/external-link.tsx (MIT).
import type { ComponentChildren } from 'preact';

export function openExternalUrl(uri: string): void {
  try {
    const electron = (window as Window & { require?: (name: string) => { shell?: { openExternal(uri: string): void } } }).require?.('electron');
    if (electron?.shell) { electron.shell.openExternal(uri); return; }
  } catch { /* Fall back to the host browser. */ }
  window.open(uri, '_blank', 'noopener');
}
export function ExternalLink({ href, children }: { href: string; children: ComponentChildren }) {
  return <a href={href} target="_blank" rel="noopener" onClick={event => { event.preventDefault(); openExternalUrl(href); }}>{children}</a>;
}

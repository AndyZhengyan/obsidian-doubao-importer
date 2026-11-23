import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Obsidian's npm package only supplies types; the host runtime is test-local.
export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL('./tests/settings-obsidian-host.tsx', import.meta.url)) } },
});

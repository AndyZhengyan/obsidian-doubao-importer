export interface IndexFile {
  path: string;
  frontmatter?: Record<string, unknown>;
}

export async function buildDoubaoIndex(files: IndexFile[], read: (path: string) => Promise<string>): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  for (const file of files) {
    const cached = file.frontmatter;
    if (cached && (cached.source !== '豆包' || cached.doubao_sync_schema !== 1)) continue;
    let id = typeof cached?.uid === 'string' ? cached.uid : '';
    if (!id) {
      let content: string;
      try { content = await read(file.path); } catch (error) {
        // Obsidian can retain entries for files removed outside the vault API.
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
      if (!frontmatter || !/^source:\s*豆包\s*$/m.test(frontmatter) || !/^doubao_sync_schema:\s*1\s*$/m.test(frontmatter)) continue;
      id = /^uid:\s*"([^"]+)"/m.exec(frontmatter)?.[1] ?? '';
    }
    if (id) index.set(id, [...(index.get(id) ?? []), file.path]);
  }
  return index;
}

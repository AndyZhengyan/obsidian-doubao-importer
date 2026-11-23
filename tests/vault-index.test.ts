import { expect, it } from 'vitest';
import { buildDoubaoIndex } from '../src/vault-index';

it('ignores vanished unindexed files while retaining moved Doubao notes', async () => {
  const index = await buildDoubaoIndex([
    { path: 'temporary/node_modules/missing.md' },
    { path: 'notes/moved.md', frontmatter: { source: '豆包', doubao_sync_schema: 1, uid: '9007199254740999' } },
    { path: 'notes/uncached.md' },
  ], async path => {
    if (path.includes('missing')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return '---\nuid: "123"\nsource: 豆包\ndoubao_sync_schema: 1\n---\n';
  });
  expect([...index.entries()]).toEqual([['9007199254740999', ['notes/moved.md']], ['123', ['notes/uncached.md']]]);
});

it('does not hide permission errors or index unrelated notes', async () => {
  const files = [{ path: 'other.md', frontmatter: { source: '得到大脑' } }, { path: 'unreadable.md' }];
  await expect(buildDoubaoIndex(files, async path => {
    expect(path).toBe('unreadable.md');
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  })).rejects.toThrow('permission denied');
});

it('retains duplicate IDs so sync can refuse ambiguous writes', async () => {
  const index = await buildDoubaoIndex(['a.md', 'b.md'].map(path => ({ path, frontmatter: { source: '豆包', doubao_sync_schema: 1, uid: '123' } })), async () => '');
  expect(index.get('123')).toEqual(['a.md', 'b.md']);
});

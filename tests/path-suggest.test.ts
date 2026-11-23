// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import type { App } from 'obsidian';
import { PathSuggest } from '../src/settings/path-suggest';

it('uses the native suggestion choice as a real input change and renders path text safely', () => {
  const input = document.createElement('input');
  let saved = '';
  input.addEventListener('input', () => { saved = input.value; });
  const suggest = new PathSuggest({} as App, input, query => ['豆包/对话', '已存在/目录'].filter(path => path.includes(query)));
  expect(suggest.getSuggestions('已存在')).toEqual(['已存在/目录']);
  suggest.selectSuggestion('已存在/目录');
  expect(saved).toBe('已存在/目录');
  const row = document.createElement('div');
  suggest.renderSuggestion('<img src=x>', row);
  expect(row.textContent).toBe('<img src=x>');
  expect(row.children.length).toBe(0);
});

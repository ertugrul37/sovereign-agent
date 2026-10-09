import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolCall, visibleText } from '../agent/protocol';

test('parses a read_file call', () => {
  const call = parseToolCall('Let me look.\n<read_file>\n<path>src/a.ts</path>\n</read_file>');
  assert.equal(call?.name, 'read_file');
  assert.equal(call?.params.path, 'src/a.ts');
});

test('write_file keeps raw content, even with tags inside', () => {
  const text = '<write_file>\n<path>a.html</path>\n<content>\n<p>hi</p>\n</content>\n</write_file>';
  const call = parseToolCall(text);
  assert.equal(call?.params.content, '<p>hi</p>');
});

test('returns null for incomplete calls', () => {
  assert.equal(parseToolCall('<read_file>\n<path>a</path>'), null);
});

test('visibleText hides tool calls and partial tags', () => {
  assert.equal(visibleText('Sure.\n<read_file>\n<path>a</path>'), 'Sure.\n');
  assert.equal(visibleText('Sure. <read_f'), 'Sure. ');
  assert.equal(visibleText('a < b is true'), 'a < b is true');
});

test('parses surgical replacements and editor context calls', () => {
  const replacement = parseToolCall(
    '<replace_in_file><path>src/a.ts</path><old_text>one</old_text><new_text>two</new_text><replace_all>false</replace_all></replace_in_file>'
  );
  assert.equal(replacement?.name, 'replace_in_file');
  assert.equal(replacement?.params.old_text, 'one');
  assert.equal(replacement?.params.replace_all, 'false');

  const context = parseToolCall('<get_editor_context></get_editor_context>');
  assert.equal(context?.name, 'get_editor_context');
});

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

test('parses local MCP calls', () => {
  const call = parseToolCall(
    '<mcp_call><server>filesystem</server><tool>read_file</tool><arguments>{"path":"README.md"}</arguments></mcp_call>'
  );
  assert.equal(call?.name, 'mcp_call');
  assert.equal(call?.params.server, 'filesystem');
  assert.equal(call?.params.tool, 'read_file');
  assert.equal(call?.params.arguments, '{"path":"README.md"}');
});

test('parses web_search calls', () => {
  const call = parseToolCall('<web_search>\n<query>python 3.13 new features</query>\n</web_search>');
  assert.equal(call?.name, 'web_search');
  assert.equal(call?.params.query, 'python 3.13 new features');
});

test('write_file recovers content when <content> tag is omitted or fenced or preceding', () => {
  // 1. Raw/fenced code directly after <path> inside <write_file>
  const direct = parseToolCall(
    '<write_file>\n<path>calculator.py</path>\n```python\ndef add(a, b):\n    return a + b\n```\n</write_file>'
  );
  assert.equal(direct?.name, 'write_file');
  assert.equal(direct?.params.path, 'calculator.py');
  assert.equal(direct?.params.content, 'def add(a, b):\n    return a + b');

  // 2. Alternative tag name <code> or unclosed <content>
  const unclosed = parseToolCall('<write_file>\n<path>calculator.py</path>\n<content>\nprint("ok")\n</write_file>');
  assert.equal(unclosed?.params.content, 'print("ok")');

  // 3. XML attribute syntax <write_file path="calculator.py">
  const attrCall = parseToolCall('<write_file path="calculator.py">\nprint(42)\n</write_file>');
  assert.equal(attrCall?.params.path, 'calculator.py');
  assert.equal(attrCall?.params.content, 'print(42)');

  // 4. Preceding markdown code block before <write_file><path>calculator.py</path></write_file>
  const preceding = parseToolCall(
    'Here is the code:\n```python\ndef sub(a, b):\n    return a - b\n```\n<write_file>\n<path>calculator.py</path>\n</write_file>'
  );
  assert.equal(preceding?.params.path, 'calculator.py');
  assert.equal(preceding?.params.content, 'def sub(a, b):\n    return a - b');
});

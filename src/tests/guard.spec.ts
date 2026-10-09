import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { checkLocalUrl } from '../localGuard';
import { resolveInside } from '../agent/tools';

test('allows loopback, blocks the internet', () => {
  assert.equal(checkLocalUrl('http://localhost:11434', false).ok, true);
  assert.equal(checkLocalUrl('http://127.0.0.1:8080/v1', false).ok, true);
  assert.equal(checkLocalUrl('http://[::1]:8080', false).ok, true);
  assert.equal(checkLocalUrl('https://api.openai.com/v1', false).ok, false);
  assert.equal(checkLocalUrl('http://localhost.evil.com', false).ok, false);
});

test('LAN addresses need opt-in', () => {
  assert.equal(checkLocalUrl('http://192.168.1.20:11434', false).ok, false);
  assert.equal(checkLocalUrl('http://192.168.1.20:11434', true).ok, true);
  assert.equal(checkLocalUrl('http://8.8.8.8', true).ok, false);
});

test('tool paths cannot escape the workspace', () => {
  const root = path.resolve('/tmp/project');
  assert.equal(resolveInside(root, 'src/a.ts'), path.join(root, 'src/a.ts'));
  assert.throws(() => resolveInside(root, '../etc/passwd'));
  assert.throws(() => resolveInside(root, '/etc/passwd'));
});

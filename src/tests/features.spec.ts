import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseToolCall } from '../agent/protocol';
import { SnapshotManager } from '../agent/snapshot';
import { validateCodeAgainstWorkspace } from '../agent/antiHallucination';

test('parses run_tests protocol calls', () => {
  const call = parseToolCall('<run_tests>\n<command>npm test</command>\n</run_tests>');
  assert.equal(call?.name, 'run_tests');
  assert.equal(call?.params.command, 'npm test');
});

test('SnapshotManager records and atomically reverts multi-file turns', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sov-snap-test-'));
  const fileA = path.join(tmpDir, 'fileA.txt');
  const fileB = path.join(tmpDir, 'fileB.txt');

  await fs.writeFile(fileA, 'Initial A', 'utf8');
  await fs.writeFile(fileB, 'Initial B', 'utf8');

  const mgr = new SnapshotManager(() => tmpDir);

  // Turn 1: mutate fileA and create fileC
  mgr.beginTurn(1);
  await mgr.recordFileBeforeMutation('fileA.txt');
  await mgr.recordFileBeforeMutation('fileC.txt'); // doesn't exist yet

  await fs.writeFile(fileA, 'Modified A in Turn 1', 'utf8');
  const fileC = path.join(tmpDir, 'fileC.txt');
  await fs.writeFile(fileC, 'Brand new C', 'utf8');

  const snap = mgr.commitTurn('Turn 1 edits');
  assert.ok(snap);
  assert.equal(snap?.files.length, 2);

  // Verify changes applied
  assert.equal(await fs.readFile(fileA, 'utf8'), 'Modified A in Turn 1');
  assert.equal(await fs.readFile(fileC, 'utf8'), 'Brand new C');

  // Now revert turn 1
  const revertRes = await mgr.revertLast();
  assert.equal(revertRes.success, true);
  assert.equal(await fs.readFile(fileA, 'utf8'), 'Initial A');

  // Verify fileC was cleanly deleted
  const cExists = await fs.stat(fileC).then(() => true).catch(() => false);
  assert.equal(cExists, false);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('AntiHallucinationGuard detects non-existent local imports', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sov-ah-test-'));
  const srcDir = path.join(tmpDir, 'src');
  await fs.mkdir(srcDir, { recursive: true });

  const realFile = path.join(srcDir, 'utils.ts');
  await fs.writeFile(realFile, 'export function add(a: number, b: number) { return a + b; }\n', 'utf8');

  // Code importing valid utils.ts AND hallucinated fakeModule.ts
  const code = [
    `import { add } from './utils';`,
    `import { fakeFunc } from './nonExistentModule';`,
    `export function test() { return add(1, 2); }`
  ].join('\n');

  const res = await validateCodeAgainstWorkspace('src/index.ts', code, tmpDir);
  assert.equal(res.valid, false);
  assert.equal(res.issues.length, 1);
  assert.equal(res.issues[0].importedSource, './nonExistentModule');
  assert.ok(res.warningNotice?.includes('Anti-Hallucination Guard Warning'));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

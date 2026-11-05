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

test('media chat parser includes table, heading, filepath, and latex arrow rendering', async () => {
  const chatJs = await fs.readFile(path.join(__dirname, '../../media/chat.js'), 'utf8');
  assert.ok(chatJs.includes('function replaceLatexMath'), 'chat.js has replaceLatexMath');
  assert.ok(chatJs.includes('function isFilePath'), 'chat.js has isFilePath');
  assert.ok(chatJs.includes('chat-table'), 'chat.js has chat-table rendering');
  assert.ok(chatJs.includes('code-filepath'), 'chat.js has code-filepath styling and handling');

  const chatCss = await fs.readFile(path.join(__dirname, '../../media/chat.css'), 'utf8');
  assert.ok(chatCss.includes('.chat-table-wrap'), 'chat.css has .chat-table-wrap');
  assert.ok(chatCss.includes('.msg code.code-filepath'), 'chat.css has .msg code.code-filepath');
  assert.ok(chatCss.includes('.msg h3'), 'chat.css has .msg h3');
});

test('TddRunner detects test runner and formats comprehensive progress dashboard', async () => {
  const { TddRunner } = await import('../agent/tddRunner');
  const runner = new TddRunner(() => path.join(__dirname, '../..'));
  const cmd = await runner.detectTestCommand();
  assert.ok(cmd, 'detected test command for workspace');
  assert.ok(cmd.command.includes('test'), 'command runs tests');

  const res = await runner.runTests('node -e "console.log(\'✔ test 1 ok (1ms)\\n✔ test 2 ok (2ms)\\nℹ pass 2\')"');
  assert.equal(res.ok, true);
  assert.equal(res.totalPassed, 2);
  assert.ok(res.dashboard.includes('Sovereign Auto-TDD Runner'));
  assert.ok(res.dashboard.includes('100%'));
});

test('system prompt enforces mandatory language directive and native reinforcement', async () => {
  const { buildSystemPrompt } = await import('../agent/prompt');
  const { setLocale } = await import('../i18n');

  setLocale('tr');
  const promptTr = buildSystemPrompt('test-workspace');
  assert.ok(promptTr.includes('KESİN DİL TALİMATI (ZORUNLU)'), 'includes Turkish native directive');
  assert.ok(promptTr.includes('Türkçe'), 'enforces Turkish');
  assert.ok(promptTr.includes('ASLA İngilizceye çevirme'), 'explicitly forbids reverting to English');

  setLocale('de');
  const promptDe = buildSystemPrompt('test-workspace');
  assert.ok(promptDe.includes('KRITISCHE SPRACHANWEISUNG'), 'includes German native directive');

  setLocale('en');
});

test('chat export UI controls and download icons exist in media/chat.js and chatViewProvider', async () => {
  const chatJs = await fs.readFile(path.join(__dirname, '../../media/chat.js'), 'utf8');
  assert.ok(chatJs.includes('download:'), 'chat.js has download icon');
  assert.ok(chatJs.includes('exportRows'), 'chat.js has exportRows menu builder');
  assert.ok(chatJs.includes("exportChat"), 'chat.js handles exportChat');

  const providerTs = await fs.readFile(path.join(__dirname, '../../src/ui/chatViewProvider.ts'), 'utf8');
  assert.ok(providerTs.includes('id="exportChat"'), 'chatViewProvider has exportChat header button');
  assert.ok(providerTs.includes('/^\\/export\\b/i'), 'chatViewProvider intercepts /export command');
  assert.ok(providerTs.includes('handleExportChat'), 'chatViewProvider implements handleExportChat');
});

test('Graphify embedded canvas has resilient render loop and initialization', async () => {
  const chatJs = await fs.readFile(path.join(__dirname, '../../media/chat.js'), 'utf8');
  assert.ok(chatJs.includes('startEmbeddedLoop'), 'chat.js defines startEmbeddedLoop');
  assert.ok(chatJs.includes('embedFitToViewport'), 'chat.js defines embedFitToViewport');
  assert.ok(chatJs.includes('resizeAndRedrawGraph'), 'chat.js defines resizeAndRedrawGraph');
  assert.ok(chatJs.includes('drawEmbeddedGraph'), 'chat.js defines drawEmbeddedGraph');
  assert.ok(chatJs.includes("switchViewTab('graphify')"), 'chat.js handles switching to graphify');
  assert.ok(chatJs.includes('requestAnimationFrame(drawEmbeddedGraph)'), 'drawEmbeddedGraph continuously ticks RAF');
});

test('Chat PDF visual export engine generates 1:1 chat replication document', async () => {
  const { buildChatHtml, renderMarkdownToHtml, findHeadlessBrowser } = await import('../ui/pdfExport');

  const history = [
    { role: 'user' as const, content: 'Analyze circular dependencies in `src/agent/agent.ts` $\\rightarrow$ `src/i18n/index.ts`' },
    { role: 'assistant' as const, content: '### Architecture Overview\n\n| File | Type | Status |\n|---|---|---|\n| agent.ts | Core | Ok |\n\n```typescript\nconst a = 1;\n```\n\n<read_file>\n<path>Makefile</path>\n</read_file>' },
    { role: 'user' as const, content: '[read_file result]\nall: build test' }
  ];

  const html = buildChatHtml({
    history,
    workspaceName: 'test-sovereign',
    model: 'qwen2.5-coder:7b',
    date: new Date()
  });

  assert.ok(html.includes('Sovereign Agent — Chat Transcript'), 'contains branded header');
  assert.ok(html.includes('test-sovereign'), 'contains workspace name');
  assert.ok(html.includes('qwen2.5-coder:7b'), 'contains model badge');
  assert.ok(html.includes('user-bubble'), 'renders user message card');
  assert.ok(html.includes('assistant-bubble'), 'renders assistant message card');
  assert.ok(html.includes('code-filepath'), 'highlights source code paths');
  assert.ok(html.includes('chat-table'), 'renders markdown table');
  assert.ok(html.includes('code-block'), 'renders code block');
  assert.ok(html.includes('tool-call-pill'), 'renders formatted tool call card');
  assert.ok(!html.includes('&lt;read_file&gt;'), 'does not dump raw unparsed XML tags');
  assert.ok(html.includes('tool-result'), 'renders formatted tool result card');
  assert.ok(html.includes('@page'), 'includes print page rules');
  assert.ok(html.includes('margin: 0;'), 'enforces full bleed page without white borders');
  assert.ok(html.includes('print-color-adjust: exact'), 'enforces exact color printing');

  const mdHtml = renderMarkdownToHtml('Use `config.ts` $\\rightarrow$ `types.ts`');
  assert.ok(mdHtml.includes('→'), 'converts LaTeX arrow to Unicode');
  assert.ok(mdHtml.includes('code-filepath'), 'detects filename in backticks');

  const browser = findHeadlessBrowser();
  // On Windows, Edge is installed; on other systems browser might be string or null
  if (process.platform === 'win32') {
    assert.ok(browser, 'detected Edge or Chrome on Windows');
  }
});




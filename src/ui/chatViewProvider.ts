import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Agent } from '../agent/agent';
import { describeCall } from '../agent/protocol';
import { AgentConfig, getConfig, activeLocale } from '../config';
import { createProvider } from '../llm/factory';
import { setLocale, t, uiStrings } from '../i18n';
import { McpManager, McpServerConfig } from '../agent/mcp';
import { ChatMessage } from '../llm/types';

const execFileAsync = promisify(execFile);

interface Checkpoint {
  path: string;
  content: string | undefined;
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'newChat' }
  | { type: 'selectModel' }
  | { type: 'history' }
  | { type: 'showCommit'; hash: string }
  | { type: 'undo' };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'sovereignAgent.chat';

  private view?: vscode.WebviewView;
  private agent = new Agent();
  private abort?: AbortController;
  private readonly mcp: McpManager;
  private historyLoaded = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionContext: vscode.ExtensionContext
  ) {
    this.mcp = new McpManager(this.mcpServers(), (name, command) =>
      this.confirm(t('approval.mcp'), `${name}: ${command}`)
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(msg));
    view.onDidDispose(() => {
      this.abort?.abort();
      this.view = undefined;
    });
  }

  /** Re-applies language and model after settings change. */
  refresh(): void {
    this.postInit();
  }

  newChat(): void {
    this.abort?.abort();
    this.agent.reset();
    this.post({ type: 'cleared' });
  }

  stop(): void {
    this.abort?.abort();
  }

  dispose(): void {
    this.mcp.dispose();
  }

  async undo(): Promise<void> {
    const checkpoints = this.extensionContext.workspaceState.get<Checkpoint[]>('checkpoints', []);
    const checkpoint = checkpoints.pop();
    if (!checkpoint) {
      void vscode.window.showInformationMessage(t('checkpoint.none'));
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const file = path.join(root, checkpoint.path);
    if (checkpoint.content === undefined) {
      await fs.rm(file, { force: true });
    } else {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, checkpoint.content, 'utf8');
    }
    await this.extensionContext.workspaceState.update('checkpoints', checkpoints);
    void vscode.window.showInformationMessage(t('checkpoint.restored', { path: checkpoint.path }));
  }

  addSelectionToChat(): void {
    const editor = vscode.window.activeTextEditor;
    const text = editor?.document.getText(editor.selection).trim();
    if (!editor || !text) {
      void vscode.window.showInformationMessage(t('editor.noSelection'));
      return;
    }
    this.post({ type: 'insertText', text: `\n\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\`\n` });
  }

  async selectModel(): Promise<void> {
    const cfg = this.prepare();
    try {
      const provider = createProvider(cfg);
      const models = await provider.listModels();
      if (models.length === 0) {
        vscode.window.showWarningMessage(t('model.noneFound'));
        return;
      }
      const picked = await vscode.window.showQuickPick(models, {
        placeHolder: t('model.pickPlaceholder')
      });
      if (picked) {
        await vscode.workspace
          .getConfiguration('sovereignAgent')
          .update('model', picked, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(t('model.set', { model: picked }));
        this.postInit();
      }
    } catch (err) {
      vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------------------------------------------------------------------

  private prepare(): AgentConfig {
    const cfg = getConfig();
    setLocale(activeLocale(cfg));
    return cfg;
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private postInit(): void {
    const cfg = this.prepare();
    this.restoreHistory();
    this.post({ type: 'init', strings: uiStrings(), model: cfg.model });
    this.post({ type: 'conversation', messages: this.agent.getHistory() });
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postInit();
        break;
      case 'send':
        await this.handleSend(msg.text);
        break;
      case 'stop':
        this.stop();
        break;
      case 'newChat':
        this.newChat();
        break;
      case 'selectModel':
        await this.selectModel();
        break;
      case 'history':
        await this.sendHistory();
        break;
      case 'showCommit':
        await this.showCommit(msg.hash);
        break;
      case 'undo':
        await this.undo();
        break;
    }
  }

  private async handleSend(text: string): Promise<void> {
    if (this.abort || !text.trim()) {
      return;
    }
    let cfg = this.prepare();
    if (!cfg.model) {
      await this.selectModel();
      cfg = this.prepare();
      if (!cfg.model) {
        this.post({ type: 'error', text: t('error.noModel') });
        return;
      }
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    this.restoreHistory();
    const editorContext = this.editorContext();
    const workspaceInstructions = await this.loadWorkspaceInstructions(folder?.uri.fsPath);
    const abort = new AbortController();
    this.abort = abort;
    const startedAt = performance.now();
    let outputCharacters = 0;
    let currentReply = '';
    let assistantReplies = 0;
    this.post({ type: 'busy', value: true });

    try {
      const provider = createProvider(cfg);
      await this.agent.run(
        text,
        provider,
        {
          model: cfg.model,
          temperature: cfg.temperature,
          contextLength: cfg.contextLength,
          maxIterations: cfg.maxIterations,
          workspaceName: folder?.name,
          workspaceInstructions,
          editorContext
        },
        {
          root: folder?.uri.fsPath,
          signal: abort.signal,
          confirmWrite: (relPath, bytes) =>
            cfg.requireWriteApproval
              ? this.confirm(t('approval.write', { path: relPath }), t('approval.writeDetail', { bytes }))
              : Promise.resolve(true),
          confirmReplace: (relPath) =>
            cfg.requireWriteApproval
              ? this.confirm(t('approval.replace', { path: relPath }), t('approval.replaceDetail'))
              : Promise.resolve(true),
          confirmCommand: (command) =>
            cfg.requireCommandApproval ? this.confirm(t('approval.command'), command) : Promise.resolve(true),
          getEditorContext: async () => this.editorContext(),
          checkpoint: async (relPath, content) => this.saveCheckpoint(relPath, content),
          previewChange: async (relPath, original, updated) => this.previewChange(relPath, original, updated),
          callMcp: (server, tool, args) => this.mcp.call(server, tool, args)
        },
        {
          onAssistantStart: () => {
            currentReply = '';
            this.post({ type: 'assistantStart' });
          },
          onAssistantText: (visible) => {
            currentReply = visible;
            this.post({ type: 'assistantText', text: visible });
          },
          onAssistantEnd: () => {
            outputCharacters += currentReply.length;
            assistantReplies += 1;
            this.post({ type: 'assistantEnd' });
          },
          onToolCall: (call) => this.post({ type: 'toolCall', summary: describeCall(call) }),
          onToolResult: (_call, result) => this.post({ type: 'toolResult', ok: result.ok, output: result.output }),
          onError: (message) => this.post({ type: 'error', text: message })
        },
        abort.signal
      );
    } catch (err) {
      this.post({ type: 'assistantEnd' });
      this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      const durationMs = Math.max(1, performance.now() - startedAt);
      const outputTokens = Math.max(0, Math.round(outputCharacters / 4));
      const inputTokens = Math.max(1, Math.round(text.length / 4));
      this.post({
        type: 'metrics',
        durationMs: Math.round(durationMs),
        inputTokens,
        outputTokens,
        tokensPerSecond: Math.round((outputTokens / durationMs) * 1000 * 10) / 10,
        replies: assistantReplies,
        memory: 'unavailable'
      });
      this.abort = undefined;
      void this.extensionContext.workspaceState.update('agentHistory', this.agent.getHistory());
      this.post({ type: 'busy', value: false });
    }
  }

  private async sendHistory(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.post({ type: 'history', commits: [], error: t('history.noWorkspace') });
      return;
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '-30', '--date=short', '--format=%H%x1f%h%x1f%ad%x1f%an%x1f%s%x1e'],
        { cwd: root, maxBuffer: 2_000_000, windowsHide: true }
      );
      const commits = stdout
        .split('\x1e')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => entry.split('\x1f'))
        .filter((parts) => parts.length >= 5)
        .map(([hash, shortHash, date, author, subject]) => ({ hash, shortHash, date, author, subject }));
      this.post({ type: 'history', commits });
    } catch (err) {
      this.post({ type: 'history', commits: [], error: t('history.unavailable') });
      if (!isGitUnavailable(err)) {
        this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private async showCommit(hash: string): Promise<void> {
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
      this.post({ type: 'error', text: t('history.invalidCommit') });
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.post({ type: 'error', text: t('history.noWorkspace') });
      return;
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', '--stat', '--decorate=short', '--format=fuller', hash],
        { cwd: root, maxBuffer: 2_000_000, windowsHide: true }
      );
      this.post({ type: 'commit', hash, output: stdout });
    } catch (err) {
      if (isGitUnavailable(err)) {
        this.post({ type: 'error', text: t('history.unavailable') });
        return;
      }
      this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }

  }

  private async confirm(message: string, detail: string): Promise<boolean> {
    const allow = t('approval.allow');
    const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, allow);
    return choice === allow;
  }

  private mcpServers(): Record<string, McpServerConfig> {
    try {
      const parsed = JSON.parse(getConfig().mcpServers) as Record<string, McpServerConfig>;
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) =>
        value && typeof value.command === 'string' && value.command.trim().length > 0
      ));
    } catch {
      return {};
    }
  }

  private restoreHistory(): void {
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    const history = this.extensionContext.workspaceState.get<ChatMessage[]>('agentHistory', []);
    this.agent.restoreHistory(history);
  }

  private async saveCheckpoint(relPath: string, content: string | undefined): Promise<void> {
    const checkpoints = this.extensionContext.workspaceState.get<Checkpoint[]>('checkpoints', []);
    checkpoints.push({ path: relPath, content });
    await this.extensionContext.workspaceState.update('checkpoints', checkpoints.slice(-20));
  }

  private async previewChange(relPath: string, original: string, updated: string): Promise<boolean> {
    const dir = path.join(this.extensionContext.globalStorageUri.fsPath, 'diffs');
    await fs.mkdir(dir, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const originalPath = path.join(dir, `before-${stamp}.txt`);
    const updatedPath = path.join(dir, `after-${stamp}.txt`);
    await fs.writeFile(originalPath, original, 'utf8');
    await fs.writeFile(updatedPath, updated, 'utf8');
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(originalPath),
      vscode.Uri.file(updatedPath),
      `${relPath} — ${t('checkpoint.preview')}`
    );
    return this.confirm(t('approval.applyChange', { path: relPath }), t('approval.applyChangeDetail'));
  }

  private editorContext(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return 'No active editor.';
    }

    const selection = editor.document.getText(editor.selection);
    return [
      `File: ${vscode.workspace.asRelativePath(editor.document.uri)}`,
      `Language: ${editor.document.languageId}`,
      `Selection: ${editor.selection.start.line + 1}:${editor.selection.start.character + 1}-${editor.selection.end.line + 1}:${editor.selection.end.character + 1}`,
      selection ? `Selected text:\n${selection.slice(0, 12000)}` : 'Selected text: (none)'
    ].join('\n');
  }

  private async loadWorkspaceInstructions(root: string | undefined): Promise<string> {
    if (!root) {
      return '';
    }
    const files = [path.join(root, '.github', 'copilot-instructions.md'), path.join(root, 'AGENTS.md')];
    const chunks: string[] = [];
    for (const file of files) {
      try {
        chunks.push(`## ${path.relative(root, file)}\n${(await fs.readFile(file, 'utf8')).slice(0, 12000)}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
    return chunks.join('\n\n');
  }

  private html(webview: vscode.Webview): string {
    const media = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('chat.css')}">
</head>
<body>
  <header>
    <button id="model" class="model" data-i18n-title="ui.changeModel" title="">
      <span id="modelName"></span>
    </button>
    <div class="header-actions">
      <button id="undo" class="icon-button" data-i18n-title="ui.undo" title="" aria-label="">↶</button>
      <button id="historyToggle" class="icon-button" data-i18n-title="ui.history" title="" aria-expanded="false">⌁</button>
    </div>
  </header>
  <section id="metrics" class="metrics" aria-label="Response metrics" hidden>
    <div><span data-i18n="ui.response"></span><strong id="metricTime">—</strong></div>
    <div><span data-i18n="ui.tokens"></span><strong id="metricTokens">—</strong></div>
    <div><span data-i18n="ui.speed"></span><strong id="metricSpeed">—</strong></div>
    <div><span data-i18n="ui.memory"></span><strong id="metricMemory">—</strong></div>
  </section>
  <aside id="historyPanel" class="history-panel" hidden>
    <div class="panel-heading">
      <div>
        <span class="eyebrow" data-i18n="ui.timeline"></span>
        <h2 data-i18n="ui.history"></h2>
      </div>
      <button id="historyClose" class="icon-button" data-i18n-title="ui.close" title="">×</button>
    </div>
    <p id="historyStatus" class="history-status"></p>
    <div id="historyList" class="history-list"></div>
    <pre id="commitDetail" class="commit-detail" hidden></pre>
  </aside>
  <main id="messages" aria-live="polite">
    <section id="empty" class="empty">
      <h2 data-i18n="ui.emptyTitle"></h2>
      <p data-i18n="ui.emptyBody"></p>
    </section>
  </main>
  <footer>
    <textarea id="input" rows="2" data-i18n-placeholder="ui.placeholder"></textarea>
    <div class="actions">
      <span id="status" class="status"></span>
      <button id="stop" class="secondary" data-i18n="ui.stop" hidden></button>
      <button id="send" data-i18n="ui.send"></button>
    </div>
  </footer>
  <script nonce="${nonce}" src="${media('chat.js')}"></script>
</body>
</html>`;
  }
}

function isGitUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown; stderr?: unknown };
  return candidate.code === 128
    || (typeof candidate.stderr === 'string' && /not a git repository/i.test(candidate.stderr));
}

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Agent, AgentHooks, RunSettings } from '../agent/agent';
import { describeCall } from '../agent/protocol';
import { AgentConfig, getConfig, activeLocale } from '../config';
import { createProvider } from '../llm/factory';
import { setLocale, t, uiStrings } from '../i18n';
import { McpManager, McpServerConfig } from '../agent/mcp';
import { ChatMessage } from '../llm/types';
import { ToolContext } from '../agent/tools';

const execFileAsync = promisify(execFile);

interface Checkpoint {
  path: string;
  content: string | undefined;
}

interface ComparisonCandidate {
  agent: Agent;
  model: string;
  text: string;
  done: boolean;
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string; mode?: string }
  | { type: 'modelMenu' }
  | { type: 'modelPick'; model: string }
  | { type: 'setAutoApprove'; value: boolean }
  | { type: 'stop' }
  | { type: 'newChat' }
  | { type: 'selectModel' }
  | { type: 'selectCompareModel' }
  | { type: 'compareSelect'; id: string }
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
  private comparison?: Map<string, ComparisonCandidate>;
  private autoApprove = false;

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
    this.comparison = undefined;
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

  async selectCompareModel(): Promise<void> {
    const cfg = this.prepare();
    try {
      const provider = createProvider(cfg);
      const models = await provider.listModels();
      const picked = await vscode.window.showQuickPick(['(disabled)', ...models], {
        placeHolder: t('model.comparePickPlaceholder')
      });
      if (!picked) return;
      const compareModel = picked === '(disabled)' ? '' : picked;
      await vscode.workspace
        .getConfiguration('sovereignAgent')
        .update('compareModel', compareModel, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        compareModel ? t('model.compareSet', { model: compareModel }) : t('model.compareDisabled')
      );
      this.postInit();
    } catch (err) {
      if (err instanceof Error && /not a registered configuration/i.test(err.message)) {
        vscode.window.showErrorMessage(
          'This installed extension is outdated. Install the latest Sovereign Agent VSIX and reload VS Code.'
        );
        return;
      }
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
    this.post({ type: 'init', strings: uiStrings(), model: cfg.model, compareModel: cfg.compareModel });
    this.post({ type: 'conversation', messages: this.agent.getHistory() });
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postInit();
        break;
      case 'send':
        await this.handleSend(msg.text, msg.mode || 'Code');
        break;
      case 'modelMenu':
        await this.sendModelOptions();
        break;
      case 'modelPick':
        await this.pickModel(msg.model);
        break;
      case 'setAutoApprove':
        this.autoApprove = msg.value;
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
      case 'selectCompareModel':
        await this.selectCompareModel();
        break;
      case 'compareSelect':
        this.selectComparison(msg.id);
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

  private async handleSend(text: string, mode: string): Promise<void> {
    if (this.abort || this.comparison || !text.trim()) {
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
    if (cfg.compareModel) {
      await this.handleCompareSend(text, cfg, mode);
      return;
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
          editorContext,
          mode
        },
        {
          root: folder?.uri.fsPath,
          signal: abort.signal,
          confirmWrite: (relPath, bytes) =>
            cfg.requireWriteApproval && !this.autoApprove
              ? this.confirm(t('approval.write', { path: relPath }), t('approval.writeDetail', { bytes }))
              : Promise.resolve(true),
          confirmReplace: (relPath) =>
            cfg.requireWriteApproval && !this.autoApprove
              ? this.confirm(t('approval.replace', { path: relPath }), t('approval.replaceDetail'))
              : Promise.resolve(true),
          confirmCommand: (command) =>
            cfg.requireCommandApproval && !this.autoApprove ? this.confirm(t('approval.command'), command) : Promise.resolve(true),
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

  private async handleCompareSend(text: string, cfg: AgentConfig, mode: string): Promise<void> {
      const folder = vscode.workspace.workspaceFolders?.[0];
      this.restoreHistory();
      const baseHistory = this.agent.getHistory();
      const editorContext = this.editorContext();
      const workspaceInstructions = await this.loadWorkspaceInstructions(folder?.uri.fsPath);
      const abort = new AbortController();
      this.abort = abort;
      this.post({ type: 'compareStart', models: [cfg.model, cfg.compareModel] });
      this.post({ type: 'busy', value: true });
      const startedAt = performance.now();
      const candidates = new Map<string, ComparisonCandidate>();
      this.comparison = candidates;

      const runCandidate = async (id: string, model: string): Promise<void> => {
        const candidateAgent = new Agent();
        candidateAgent.restoreHistory(baseHistory);
        const candidate: ComparisonCandidate = { agent: candidateAgent, model, text: '', done: false };
        candidates.set(id, candidate);
        const hooks: AgentHooks = {
          onAssistantStart: () => this.post({ type: 'compareAssistantStart', id }),
          onAssistantText: (visible) => {
            candidate.text = visible;
            this.post({ type: 'compareText', id, text: visible });
          },
          onAssistantEnd: () => this.post({ type: 'compareAssistantEnd', id }),
          onToolCall: (call) => this.post({ type: 'compareToolCall', id, summary: describeCall(call) }),
          onToolResult: () => undefined,
          onError: (message) => this.post({ type: 'compareError', id, text: message })
        };
        try {
          await candidateAgent.run(
            text,
            createProvider({ provider: cfg.provider, baseUrl: cfg.baseUrl, allowLanHosts: cfg.allowLanHosts }),
            this.runSettings(cfg, folder?.name, workspaceInstructions, editorContext, model, mode),
            this.toolContext(cfg, folder?.uri.fsPath, abort),
            hooks,
            abort.signal
          );
        } catch (err) {
          this.post({ type: 'compareError', id, text: err instanceof Error ? err.message : String(err) });
        } finally {
          candidate.done = true;
          this.post({ type: 'compareCandidateDone', id });
        }
      };

      try {
        await Promise.all([runCandidate('primary', cfg.model), runCandidate('secondary', cfg.compareModel)]);
        if (!abort.signal.aborted) this.post({ type: 'compareFinished' });
      } finally {
        const durationMs = Math.max(1, performance.now() - startedAt);
        const outputTokens = Math.max(
          0,
          Math.round([...candidates.values()].reduce((total, candidate) => total + candidate.text.length, 0) / 4)
        );
        this.post({
          type: 'metrics',
          durationMs: Math.round(durationMs),
          inputTokens: Math.max(1, Math.round(text.length / 4)),
          outputTokens,
          tokensPerSecond: Math.round((outputTokens / durationMs) * 1000 * 10) / 10,
          replies: candidates.size,
          memory: 'unavailable'
        });
        this.abort = undefined;
        if (abort.signal.aborted) {
          this.comparison = undefined;
          this.post({ type: 'busy', value: false });
        }
      }
    }

    private runSettings(
      cfg: AgentConfig,
      workspaceName: string | undefined,
      workspaceInstructions: string,
      editorContext: string,
      model: string,
      mode: string
    ): RunSettings {
      return {
        model,
        temperature: cfg.temperature,
        contextLength: cfg.contextLength,
        maxIterations: cfg.maxIterations,
        workspaceName,
        workspaceInstructions,
        editorContext
        ,mode
      };
    }

    private async sendModelOptions(): Promise<void> {
      const cfg = this.prepare();
      try {
        const models = await createProvider(cfg).listModels();
        this.post({ type: 'modelOptions', models, selected: cfg.model });
      } catch (err) {
        this.post({ type: 'modelOptions', models: [], error: err instanceof Error ? err.message : String(err) });
      }
    }

    private async pickModel(model: string): Promise<void> {
      if (!model.trim()) return;
      await vscode.workspace
        .getConfiguration('sovereignAgent')
        .update('model', model.trim(), vscode.ConfigurationTarget.Global);
      this.postInit();
    }

    private toolContext(cfg: AgentConfig, root: string | undefined, abort: AbortController): ToolContext {
      return {
        root,
        signal: abort.signal,
        confirmWrite: (relPath: string, bytes: number) =>
          cfg.requireWriteApproval && !this.autoApprove
            ? this.confirm(t('approval.write', { path: relPath }), t('approval.writeDetail', { bytes }))
            : Promise.resolve(true),
        confirmReplace: (relPath: string) =>
          cfg.requireWriteApproval && !this.autoApprove
            ? this.confirm(t('approval.replace', { path: relPath }), t('approval.replaceDetail'))
            : Promise.resolve(true),
        confirmCommand: (command: string) =>
          cfg.requireCommandApproval && !this.autoApprove ? this.confirm(t('approval.command'), command) : Promise.resolve(true),
        getEditorContext: async () => this.editorContext(),
        checkpoint: async (relPath: string, content: string | undefined) => this.saveCheckpoint(relPath, content),
        previewChange: async (relPath: string, original: string, updated: string) =>
          this.previewChange(relPath, original, updated),
        callMcp: (server: string, tool: string, argsJson: string) => this.mcp.call(server, tool, argsJson)
      };
    }

  private selectComparison(id: string): void {
      const candidate = this.comparison?.get(id);
      if (!candidate?.done || !candidate.text.trim()) return;
      this.agent.adoptHistory(candidate.agent.getHistory());
      this.comparison = undefined;
      void this.extensionContext.workspaceState.update('agentHistory', this.agent.getHistory());
      this.post({ type: 'compareChosen', id, model: candidate.model, text: candidate.text });
      this.post({ type: 'busy', value: false });
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
    <button id="model" class="model model-trigger" data-i18n-title="ui.changeModel" title="" aria-haspopup="true" aria-expanded="false">
      <span id="modelName"></span>
      <span class="chevron">⌄</span>
    </button>
    <div class="header-actions">
      <button id="compareModel" class="icon-button" data-i18n-title="ui.compareModel" title="" aria-label="">⇆</button>
      <button id="undo" class="icon-button" data-i18n-title="ui.undo" title="" aria-label="">↶</button>
      <button id="historyToggle" class="icon-button" data-i18n-title="ui.history" title="" aria-expanded="false">⌁</button>
    </div>
  </header>
  <section id="modelPanel" class="popover model-panel" hidden>
    <div class="popover-search">
      <span>⌕</span>
      <input id="modelSearch" type="search" data-i18n-placeholder="ui.searchModels" />
    </div>
    <div id="modelOptions" class="model-options"></div>
    <button id="compareModelOption" class="popover-link" data-i18n="ui.configureCompare"></button>
  </section>
  <section id="metrics" class="metrics" aria-label="Response metrics" hidden>
    <div class="metrics-heading">
      <span class="eyebrow" data-i18n="ui.performance"></span>
      <span class="metrics-live" data-i18n="ui.live"></span>
    </div>
    <div class="metric-grid">
      <div class="metric-card metric-card-accent">
        <span data-i18n="ui.response"></span><strong id="metricTime">—</strong>
        <small data-i18n="ui.durationHint"></small>
      </div>
      <div class="metric-card">
        <span data-i18n="ui.tokens"></span><strong id="metricTokens">—</strong>
        <small data-i18n="ui.tokenHint"></small>
      </div>
      <div class="metric-card">
        <span data-i18n="ui.speed"></span><strong id="metricSpeed">—</strong>
        <small data-i18n="ui.speedHint"></small>
      </div>
      <div class="metric-card">
        <span data-i18n="ui.memory"></span><strong id="metricMemory">—</strong>
        <small data-i18n="ui.memoryHint"></small>
      </div>
    </div>
    <div class="trend">
      <div class="trend-heading">
        <span data-i18n="ui.trend"></span>
        <span id="trendSummary"></span>
      </div>
      <svg id="trendChart" class="trend-chart" viewBox="0 0 320 72" role="img" aria-label="Response speed trend">
        <line class="chart-grid" x1="8" y1="60" x2="312" y2="60"></line>
        <line class="chart-grid" x1="8" y1="36" x2="312" y2="36"></line>
        <line class="chart-grid" x1="8" y1="12" x2="312" y2="12"></line>
        <polyline id="speedLine" class="chart-line" points=""></polyline>
        <polyline id="durationLine" class="chart-line chart-line-secondary" points=""></polyline>
      </svg>
      <div class="chart-legend">
        <span><i class="legend-dot speed-dot"></i><span data-i18n="ui.chartSpeed"></span></span>
        <span><i class="legend-dot duration-dot"></i><span data-i18n="ui.chartDuration"></span></span>
      </div>
    </div>
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
    <section id="comparison" class="comparison" hidden aria-live="polite">
      <div class="comparison-heading">
        <span class="eyebrow" data-i18n="ui.compareTitle"></span>
        <span id="comparisonStatus"></span>
      </div>
      <div class="comparison-grid">
        <article class="comparison-card" data-id="primary">
          <header><strong id="compareModelPrimary"></strong><span id="compareStatePrimary"></span></header>
          <div id="compareTextPrimary" class="comparison-text"></div>
          <button class="compare-choice" data-id="primary" disabled data-i18n="ui.chooseAnswer"></button>
        </article>
        <article class="comparison-card" data-id="secondary">
          <header><strong id="compareModelSecondary"></strong><span id="compareStateSecondary"></span></header>
          <div id="compareTextSecondary" class="comparison-text"></div>
          <button class="compare-choice" data-id="secondary" disabled data-i18n="ui.chooseAnswer"></button>
        </article>
      </div>
    </section>
  </main>
  <footer>
    <div id="dictationPanel" class="dictation-panel" hidden>
      <div class="dictation-heading">
        <strong data-i18n="ui.dictation"></strong>
        <button id="dictationClose" class="icon-button" data-i18n-title="ui.close" title="">×</button>
      </div>
      <p data-i18n="ui.dictationHint"></p>
      <button id="microphoneSelect" class="microphone-select" type="button">◉ <span data-i18n="ui.defaultMicrophone"></span><span>⌄</span></button>
      <div class="waveform" aria-hidden="true"></div>
    </div>
    <div class="composer">
      <textarea id="input" rows="3" data-i18n-placeholder="ui.placeholder"></textarea>
      <div class="composer-toolbar">
        <button id="attach" class="toolbar-button" data-i18n-title="ui.attach" title="">＋</button>
        <button id="mode" class="mode-button" aria-haspopup="true" aria-expanded="false"><span id="modeName">Code</span><span>⌃</span></button>
        <button id="approval" class="mode-button approval-button" aria-haspopup="true" aria-expanded="false"><span data-i18n="ui.autoApprove"></span><span>⌃</span></button>
        <span class="composer-spacer"></span>
        <button id="mic" class="toolbar-button" data-i18n-title="ui.dictation" title="">♩</button>
        <button id="send" class="send-button" data-i18n-title="ui.send" title="">↑</button>
      </div>
    </div>
    <div id="modePanel" class="popover mode-panel" hidden>
      <button data-mode="Code"><strong>Code</strong><small data-i18n="ui.modeCode"></small></button>
      <button data-mode="Ask"><strong>Ask</strong><small data-i18n="ui.modeAsk"></small></button>
      <button data-mode="Debug"><strong>Debug</strong><small data-i18n="ui.modeDebug"></small></button>
      <button data-mode="Orchestrator"><strong>Orchestrator</strong><small data-i18n="ui.modeOrchestrator"></small><em data-i18n="ui.deprecated"></em></button>
      <button data-mode="Plan"><strong>Plan</strong><small data-i18n="ui.modePlan"></small></button>
    </div>
    <div id="approvalPanel" class="popover approval-panel" hidden>
      <p data-i18n="ui.approvalHint"></p>
      <button id="approvalToggle" type="button" data-i18n="ui.approveNext"></button>
    </div>
    <div class="actions">
      <span id="status" class="status"></span>
      <button id="stop" class="secondary" data-i18n="ui.stop" hidden></button>
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

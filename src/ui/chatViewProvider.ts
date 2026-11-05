import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { Agent, AgentHooks, RunSettings } from '../agent/agent';
import { describeCall } from '../agent/protocol';
import { AgentConfig, getConfig, activeLocale } from '../config';
import { createProvider, discoverLocalServer } from '../llm/factory';
import { setLocale, t, uiStrings, LOCALE_NAMES } from '../i18n';
import { McpManager, McpServerConfig } from '../agent/mcp';
import { ChatMessage } from '../llm/types';
import { ToolContext } from '../agent/tools';
import { transcribeAudio } from '../llm/asr';
import { AgentTerminal } from '../agent/terminal';
import { performWebSearch } from '../agent/webSearch';
import { BrowserPreviewManager } from '../agent/browserPreview';
import { GraphifyManager, formatGraphSummary } from '../agent/graphify';

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
  | { type: 'send'; text: string; mode?: string; webSearch?: boolean }
  | { type: 'modelMenu' }
  | { type: 'modelPick'; model: string }
  | { type: 'setAutoApprove'; value: boolean }
  | { type: 'transcribe'; audio: string; mimeType: string }
  | { type: 'openSettings' }
  | { type: 'stop' }
  | { type: 'newChat' }
  | { type: 'selectModel' }
  | { type: 'selectCompareModel' }
  | { type: 'compareSelect'; id: string }
  | { type: 'history' }
  | { type: 'showCommit'; hash: string }
  | { type: 'undo' }
  | { type: 'attachFile' }
  | { type: 'attachActive' }
  | { type: 'attachPick' }
  | { type: 'attachSelection' }
  | { type: 'listSkills' }
  | { type: 'useSkill'; file: string }
  | { type: 'openMcpSettings' }
  | { type: 'openExtensions' }
  | { type: 'openExternal'; url: string }
  | { type: 'copyText'; text: string }
  | { type: 'insertCode'; code: string; lang: string }
  | { type: 'runCode'; code: string; lang: string }
  | { type: 'setLanguage'; language: string }
  | { type: 'selectLanguage' }
  | { type: 'openPreview' }
  | { type: 'openGraphify' }
  | { type: 'confirmResponse'; id: string; allow: boolean };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'sovereignAgent.chat';

  private view?: vscode.WebviewView;
  private agent = new Agent();
  private abort?: AbortController;
  private readonly mcp: McpManager;
  private historyLoaded = false;
  private comparison?: Map<string, ComparisonCandidate>;
  private autoApprove = false;
  private readonly pendingConfirms = new Map<string, (allow: boolean) => void>();
  private readonly terminal = new AgentTerminal();
  private readonly browserPreview = new BrowserPreviewManager();
  private readonly graphify = new GraphifyManager((prompt) => {
    void this.handleSend(prompt, 'Code');
  });

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
      // Any action still waiting on an approval the user can no longer see
      // must not hang forever: treat it as denied.
      for (const resolve of this.pendingConfirms.values()) resolve(false);
      this.pendingConfirms.clear();
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

  openFeedback(): void {
    this.post({ type: 'openFeedback' });
  }

  async rateExtension(): Promise<void> {
    await this.extensionContext.globalState.update('reviewPrompted', true);
    await vscode.env.openExternal(
      vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=ertugrul37.sovereign-agent&ssr=false#review-details')
    );
  }

  async selectLanguage(): Promise<void> {
    const cfg = this.prepare();
    const items = [
      { label: `$(globe) ${t('ui.languageAuto')}`, description: 'auto', code: 'auto' },
      ...Object.entries(LOCALE_NAMES).map(([code, name]) => ({
        label: name,
        description: code === cfg.language ? '✓' : code,
        code
      }))
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: t('ui.menuLanguage')
    });
    if (picked) {
      await vscode.workspace
        .getConfiguration('sovereignAgent')
        .update('language', picked.code, vscode.ConfigurationTarget.Global);
      this.postInit();
    }
  }

  dispose(): void {
    this.mcp.dispose();
    this.terminal.dispose();
    this.browserPreview.dispose();
    this.graphify.dispose();
  }

  async openPreview(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    await this.browserPreview.openInteractive(root);
  }

  async openGraphify(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    await this.graphify.openInteractive(root);
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
    this.post({
      type: 'init',
      strings: uiStrings(),
      model: cfg.model,
      compareModel: cfg.compareModel,
      userName: cfg.userName,
      language: cfg.language,
      locales: LOCALE_NAMES
    });
    this.post({ type: 'conversation', messages: this.agent.getHistory() });
    if (!cfg.model) {
      void this.autoDetectServer();
    }
  }

  private async autoDetectServer(): Promise<boolean> {
    const discovered = await discoverLocalServer();
    if (!discovered || discovered.models.length === 0) {
      return false;
    }
    const c = vscode.workspace.getConfiguration('sovereignAgent');
    await c.update('provider', discovered.provider, vscode.ConfigurationTarget.Global);
    await c.update('baseUrl', discovered.baseUrl, vscode.ConfigurationTarget.Global);
    if (!c.get<string>('model', '').trim()) {
      await c.update('model', discovered.models[0], vscode.ConfigurationTarget.Global);
    }
    const cfg = this.prepare();
    this.post({
      type: 'init',
      strings: uiStrings(),
      model: cfg.model,
      compareModel: cfg.compareModel,
      userName: cfg.userName,
      language: cfg.language,
      locales: LOCALE_NAMES
    });
    return true;
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postInit();
        break;
      case 'send':
        await this.handleSend(msg.text, msg.mode || 'Code', Boolean(msg.webSearch));
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
      case 'transcribe':
        await this.transcribe(msg.audio, msg.mimeType);
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ertugrul37.sovereign-agent');
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
      case 'attachFile':
        await this.attachFromDialog();
        break;
      case 'attachActive':
        this.attachActive();
        break;
      case 'attachPick':
        await this.attachPick();
        break;
      case 'attachSelection':
        this.addSelectionToChat();
        break;
      case 'listSkills':
        await this.sendSkills();
        break;
      case 'useSkill':
        await this.useSkill(msg.file);
        break;
      case 'openMcpSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'sovereignAgent.mcpServers');
        break;
      case 'openExtensions':
        await vscode.commands.executeCommand('workbench.view.extensions');
        break;
      case 'openExternal':
        if (msg.url.startsWith('mailto:') || msg.url.startsWith('https://')) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
      case 'copyText':
        await vscode.env.clipboard.writeText(msg.text);
        break;
      case 'insertCode':
        await this.insertCodeBlock(msg.code, msg.lang);
        break;
      case 'runCode':
        await this.runCodeBlock(msg.code, msg.lang);
        break;
      case 'selectLanguage':
        await this.selectLanguage();
        break;
      case 'openPreview':
        await this.openPreview();
        break;
      case 'openGraphify':
        await this.openGraphify();
        break;
      case 'setLanguage':
        await vscode.workspace
          .getConfiguration('sovereignAgent')
          .update('language', msg.language, vscode.ConfigurationTarget.Global);
        this.postInit();
        break;
      case 'confirmResponse': {
        const resolve = this.pendingConfirms.get(msg.id);
        if (resolve) {
          this.pendingConfirms.delete(msg.id);
          resolve(msg.allow);
        }
        break;
      }
    }
  }

  private static readonly IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff']);
  private static readonly MAX_ATTACHMENT_BYTES = 512 * 1024;
  private static readonly MAX_ATTACHMENT_CHARS = 30000;

  private clipAttachment(text: string): string {
    const max = ChatViewProvider.MAX_ATTACHMENT_CHARS;
    return text.length > max ? text.slice(0, max) + '\n… (truncated)' : text;
  }

  private async readAttachment(uri: vscode.Uri): Promise<{ name: string; language: string; content: string } | undefined> {
    const ext = path.extname(uri.fsPath).toLowerCase();
    if (ChatViewProvider.IMAGE_EXTENSIONS.has(ext)) {
      this.post({ type: 'error', text: t('ui.imageUnsupported') });
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.length > ChatViewProvider.MAX_ATTACHMENT_BYTES || bytes.subarray(0, 8000).includes(0)) {
      this.post({ type: 'error', text: t('ui.attachUnsupported', { name: path.basename(uri.fsPath) }) });
      return undefined;
    }
    return {
      name: vscode.workspace.asRelativePath(uri, false),
      language: ext.replace('.', ''),
      content: this.clipAttachment(Buffer.from(bytes).toString('utf8'))
    };
  }

  private async postAttachments(uris: vscode.Uri[]): Promise<void> {
    const items: { name: string; language: string; content: string }[] = [];
    for (const uri of uris) {
      try {
        const item = await this.readAttachment(uri);
        if (item) {
          items.push(item);
        }
      } catch (err) {
        this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
      }
    }
    if (items.length) {
      this.post({ type: 'attachments', items });
    }
  }

  private async attachFromDialog(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      openLabel: t('ui.menuAttach')
    });
    await this.postAttachments(uris ?? []);
  }

  private attachActive(): void {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) {
      this.post({ type: 'error', text: t('ui.noActiveFile') });
      return;
    }
    this.post({
      type: 'attachments',
      items: [
        {
          name: doc.isUntitled ? doc.fileName : vscode.workspace.asRelativePath(doc.uri, false),
          language: doc.languageId,
          content: this.clipAttachment(doc.getText())
        }
      ]
    });
  }

  private async attachPick(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,out,dist,build}/**', 500);
    const picks = files
      .map((uri) => ({ label: vscode.workspace.asRelativePath(uri, false), uri }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const chosen = await vscode.window.showQuickPick(picks, {
      canPickMany: true,
      placeHolder: t('ui.projectPickFile')
    });
    if (chosen?.length) {
      await this.postAttachments(chosen.map((item) => item.uri));
    }
  }

  private promptsDir(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, '.github', 'prompts') : undefined;
  }

  private async sendSkills(): Promise<void> {
    const dir = this.promptsDir();
    let items: { name: string }[] = [];
    if (dir) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        items = entries
          .filter(([name, kind]) => kind === vscode.FileType.File && name.endsWith('.prompt.md'))
          .map(([name]) => ({ name: name.replace(/\.prompt\.md$/, '') }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        items = [];
      }
    }
    this.post({ type: 'skills', items });
  }

  private async useSkill(file: string): Promise<void> {
    const dir = this.promptsDir();
    if (!dir) {
      return;
    }
    const safeName = path.basename(file);
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, safeName + '.prompt.md'));
      const body = Buffer.from(bytes).toString('utf8').replace(/^---[\s\S]*?---\s*/, '').trim();
      this.post({ type: 'insertText', text: body });
    } catch (err) {
      this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleSend(text: string, mode: string, webSearch = false): Promise<void> {
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
    let baseInstructions = await this.loadWorkspaceInstructions(folder?.uri.fsPath);
    let effectiveText = text;
    if (/^\/graphify\b/i.test(text.trim())) {
      const graphData = await this.graphify.openInteractive(folder?.uri.fsPath);
      if (graphData) {
        baseInstructions = `${baseInstructions}\n\nGRAPHIFY KNOWLEDGE GRAPH:\n${formatGraphSummary(graphData)}`.trim();
      }
      const rest = text.trim().replace(/^\/graphify\b/i, '').trim();
      effectiveText = rest || 'Summarize the Graphify Knowledge Graph of this workspace, including key module clusters, top architectural hubs, and any potential bottlenecks.';
    }
    const workspaceInstructions = webSearch
      ? `${baseInstructions}\n\nWEB SEARCH ACTIVE: The user enabled Web Search for this request. Call <web_search><query>...</query></web_search> first to retrieve current web results before answering.`.trim()
      : baseInstructions;
    const abort = new AbortController();
    this.abort = abort;
    const startedAt = performance.now();
    let outputCharacters = 0;
    let currentReply = '';
    let assistantReplies = 0;
    let lastPostedAt = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flushStream = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      lastPostedAt = performance.now();
      this.post({ type: 'assistantText', text: currentReply });
    };
    this.post({ type: 'busy', value: true });

    try {
      const provider = createProvider(cfg);
      await this.agent.run(
        effectiveText,
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
        this.toolContext(cfg, folder?.uri.fsPath, abort),
        {
          onAssistantStart: () => {
            currentReply = '';
            lastPostedAt = 0;
            this.post({ type: 'assistantStart' });
          },
          onAssistantText: (visible) => {
            currentReply = visible;
            const now = performance.now();
            if (now - lastPostedAt >= 25) {
              flushStream();
            } else if (!flushTimer) {
              flushTimer = setTimeout(flushStream, 25);
            }
          },
          onAssistantEnd: () => {
            if (flushTimer) {
              flushStream();
            } else {
              this.post({ type: 'assistantText', text: currentReply });
            }
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
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      this.post({ type: 'assistantEnd' });
      this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      const durationMs = Math.max(1, performance.now() - startedAt);
      const outputTokens = Math.max(0, Math.round(outputCharacters / 4));
      const inputTokens = Math.max(1, Math.round(text.length / 4));
      const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
      this.post({
        type: 'metrics',
        durationMs: Math.round(durationMs),
        inputTokens,
        outputTokens,
        tokensPerSecond: Math.round((outputTokens / durationMs) * 1000 * 10) / 10,
        replies: assistantReplies,
        memory: `${rssMb} MB`
      });
      this.abort = undefined;
      void this.extensionContext.workspaceState.update('agentHistory', this.agent.getHistory());
      this.post({ type: 'busy', value: false });
      if (assistantReplies > 0) {
        void this.maybePromptReview();
      }
    }
  }

  private async maybePromptReview(): Promise<void> {
    const prompted = this.extensionContext.globalState.get<boolean>('reviewPrompted', false);
    if (prompted) return;
    const count = (this.extensionContext.globalState.get<number>('completedRuns', 0) || 0) + 1;
    await this.extensionContext.globalState.update('completedRuns', count);
    if (count !== 3 && count !== 10 && count !== 25) return;
    const rateBtn = t('review.rateNow');
    const githubBtn = t('review.starGithub');
    const laterBtn = t('review.later');
    const choice = await vscode.window.showInformationMessage(t('review.prompt'), rateBtn, githubBtn, laterBtn);
    if (choice === rateBtn) {
      await this.extensionContext.globalState.update('reviewPrompted', true);
      await vscode.env.openExternal(
        vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=ertugrul37.sovereign-agent&ssr=false#review-details')
      );
    } else if (choice === githubBtn) {
      await this.extensionContext.globalState.update('reviewPrompted', true);
      await vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/ertugrul37/sovereign-agent')
      );
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
        const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
        this.post({
          type: 'metrics',
          durationMs: Math.round(durationMs),
          inputTokens: Math.max(1, Math.round(text.length / 4)),
          outputTokens,
          tokensPerSecond: Math.round((outputTokens / durationMs) * 1000 * 10) / 10,
          replies: candidates.size,
          memory: `${rssMb} MB`
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
      let cfg = this.prepare();
      try {
        let models = await createProvider(cfg).listModels();
        if (models.length === 0 && (await this.autoDetectServer())) {
          cfg = this.prepare();
          models = await createProvider(cfg).listModels();
        }
        this.post({ type: 'modelOptions', models, selected: cfg.model });
      } catch (err) {
        if (await this.autoDetectServer()) {
          cfg = this.prepare();
          try {
            const models = await createProvider(cfg).listModels();
            this.post({ type: 'modelOptions', models, selected: cfg.model });
            return;
          } catch {
            // fall through
          }
        }
        this.post({ type: 'modelOptions', models: [], error: err instanceof Error ? err.message : String(err) });
      }
    }

    private async insertCodeBlock(code: string, lang: string): Promise<void> {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await editor.edit((builder) => {
          if (editor.selection.isEmpty) {
            builder.insert(editor.selection.active, code);
          } else {
            builder.replace(editor.selection, code);
          }
        });
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        content: code,
        language: lang || 'plaintext'
      });
      await vscode.window.showTextDocument(doc);
    }

    private async runCodeBlock(code: string, lang: string): Promise<void> {
      const cfg = this.prepare();
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      const normalized = (lang || '').toLowerCase();
      let command = code.trim();

      if (normalized === 'python' || normalized === 'py') {
        const tmpFile = path.join(os.tmpdir(), 'sovereign_snippet.py');
        await fs.writeFile(tmpFile, code, 'utf8');
        command = `python "${tmpFile}"`;
      } else if (normalized === 'javascript' || normalized === 'js' || normalized === 'node') {
        const tmpFile = path.join(os.tmpdir(), 'sovereign_snippet.js');
        await fs.writeFile(tmpFile, code, 'utf8');
        command = `node "${tmpFile}"`;
      }

      if (cfg.requireCommandApproval && !this.autoApprove) {
        const ok = await this.confirm(t('approval.command'), command);
        if (!ok) {
          return;
        }
      }
      const abort = new AbortController();
      await this.terminal.run(command, root, abort.signal);
    }

    private async pickModel(model: string): Promise<void> {
      if (!model.trim()) return;
      await vscode.workspace
        .getConfiguration('sovereignAgent')
        .update('model', model.trim(), vscode.ConfigurationTarget.Global);
      this.postInit();
    }

    private async transcribe(audioDataUrl: string, mimeType: string): Promise<void> {
      const match = /^data:[^;]+;base64,(.+)$/.exec(audioDataUrl);
      if (!match) {
        this.post({ type: 'transcriptionError', text: t('error.invalidAudio') });
        return;
      }
      try {
        const audio = Uint8Array.from(Buffer.from(match[1], 'base64'));
        const cfg = this.prepare();
        const text = await transcribeAudio(audio, mimeType, {
          baseUrl: cfg.asrBaseUrl,
          model: cfg.asrModel,
          allowLanHosts: cfg.allowLanHosts
        });
        this.post({ type: 'transcription', text });
      } catch (err) {
        this.post({ type: 'transcriptionError', text: err instanceof Error ? err.message : String(err) });
      }
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
        callMcp: (server: string, tool: string, argsJson: string) => this.mcp.call(server, tool, argsJson),
        runCommand: (command: string) => this.terminal.run(command, root ?? process.cwd(), abort.signal),
        webSearch: (query: string) => performWebSearch(query, abort.signal),
        browserAction: (params) => this.browserPreview.execute(params, root),
        codeGraph: (params) => this.graphify.execute(params, root)
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

  /**
   * Asks the user to approve an agent action. Rendered inline in the chat
   * (right under the tool call it belongs to) instead of a native modal
   * dialog, so approving doesn't interrupt whatever else the user is doing
   * in the editor. Falls back to a native modal only if the webview isn't
   * currently visible to receive it.
   */
  private async confirm(message: string, detail: string): Promise<boolean> {
    if (!this.view) {
      const allow = t('approval.allow');
      const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, allow);
      return choice === allow;
    }
    const id = randomUUID();
    return new Promise<boolean>((resolve) => {
      this.pendingConfirms.set(id, resolve);
      this.post({ type: 'confirmRequest', id, message, detail });
    });
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('chat.css')}">
</head>
<body class="empty">
  <header>
    <div class="header-actions">
      <button id="graphifyBtn" class="icon-button" data-icon="graph" data-i18n-title="ui.graphify" title="" aria-label="Graphify Codebase Knowledge Graph"></button>
      <button id="previewBtn" class="icon-button" data-icon="monitor" data-i18n-title="ui.livePreview" title="" aria-label="Live Web Preview & Tester"></button>
      <button id="compareModel" class="icon-button" data-icon="columns" data-i18n-title="ui.compareModel" title="" aria-label="Compare models"></button>
      <button id="approval" class="icon-button" data-icon="shield" data-i18n-title="ui.autoApprove" title="" aria-haspopup="true" aria-label="Approvals"></button>
      <button id="undo" class="icon-button" data-icon="undo" data-i18n-title="ui.undo" title="" aria-label="Undo"></button>
      <button id="historyToggle" class="icon-button" data-icon="history" data-i18n-title="ui.history" title="" aria-label="History" aria-expanded="false"></button>
      <button id="langToggle" class="icon-button" data-icon="globe" data-i18n-title="ui.menuLanguage" title="" aria-label="Language"></button>
      <button id="rateBtn" class="icon-button rate-star-btn" data-icon="star" data-i18n-title="ui.rateExtension" title="" aria-label="Rate 5 Stars"></button>
      <button id="feedbackToggle" class="icon-button" data-icon="alertCircle" data-i18n-title="ui.feedback" title="" aria-label="Support & Feedback" aria-expanded="false"></button>
    </div>
  </header>
  <div id="approvalPanel" class="popover approval-panel" hidden>
    <p data-i18n="ui.approvalHint"></p>
    <button id="approvalToggle" type="button" data-i18n="ui.approveNext"></button>
  </div>
  <div id="feedbackPanel" class="popover feedback-panel" hidden>
    <div class="feedback-header">
      <div class="feedback-title">
        <span class="feedback-icon" data-icon="alertCircle"></span>
        <span data-i18n="ui.feedbackTitle"></span>
      </div>
      <button id="feedbackClose" class="icon-button close-button" data-icon="x" title="Close" aria-label="Close"></button>
    </div>
    <div class="rate-banner">
      <div class="rate-stars" id="rateStarsRow" role="group" aria-label="5 Star Rating">
        <button type="button" class="star-pick" data-star="1">★</button>
        <button type="button" class="star-pick" data-star="2">★</button>
        <button type="button" class="star-pick" data-star="3">★</button>
        <button type="button" class="star-pick" data-star="4">★</button>
        <button type="button" class="star-pick" data-star="5">★</button>
      </div>
      <p class="rate-desc" data-i18n="ui.rateDesc"></p>
      <div class="rate-actions">
        <button id="rateMarketplaceBtn" type="button" class="rate-cta-btn" data-i18n="ui.rateExtension"></button>
        <button id="starGithubBtn" type="button" class="rate-gh-btn" data-i18n="ui.starGithub"></button>
      </div>
    </div>
    <p class="feedback-desc" data-i18n="ui.feedbackDesc"></p>
    <div class="feedback-email-card">
      <div class="feedback-email-meta">
        <span class="feedback-email-badge">E-mail</span>
        <span class="feedback-email-addr">destekai.sovereign.ai@gmail.com</span>
      </div>
      <button id="copyEmailBtn" class="icon-button feedback-copy-btn" data-icon="copy" data-i18n-title="ui.copyEmail" title="Copy Email" aria-label="Copy Email"></button>
    </div>
    <div class="feedback-form">
      <textarea id="feedbackText" rows="4" data-i18n-placeholder="ui.feedbackPlaceholder"></textarea>
      <div class="feedback-footer">
        <button id="sendEmailBtn" type="button" class="feedback-send-btn">
          <span class="feedback-btn-icon" data-icon="mail"></span>
          <span data-i18n="ui.sendEmail"></span>
        </button>
      </div>
    </div>
  </div>
  <section id="metrics" class="metrics collapsed" aria-label="Response metrics" hidden>
    <button id="metricsToggle" type="button" class="metrics-heading" aria-expanded="false" aria-controls="metricsBody">
      <span class="eyebrow" data-i18n="ui.performance"></span>
      <span class="metrics-live" data-i18n="ui.live"></span>
      <span class="metrics-chevron" data-icon="chevronRight"></span>
    </button>
    <div id="metricsBody" class="metrics-body">
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
    <div id="hero" class="hero">
      <img class="hero-mark" src="${media('logo.svg')}" alt="" />
      <h1 id="greeting"></h1>
    </div>
    <div class="composer-wrap">
      <div id="plusMenu" class="popover plus-menu" role="menu" hidden>
        <div id="plusMain"></div>
        <div id="plusSub" hidden></div>
      </div>
      <section id="modelPanel" class="popover model-panel" hidden>
        <div class="popover-search">
          <span data-icon="search"></span>
          <input id="modelSearch" type="search" data-i18n-placeholder="ui.searchModels" />
        </div>
        <div id="modelOptions" class="model-options"></div>
        <button id="compareModelOption" class="popover-link" data-i18n="ui.configureCompare"></button>
      </section>
      <div class="composer">
        <div id="attachments" class="attachments" hidden></div>
        <textarea id="input" rows="2" data-i18n-placeholder="ui.placeholder"></textarea>
        <div class="composer-toolbar">
          <button id="plus" class="toolbar-button" data-icon="plus" data-i18n-title="ui.attach" title="" aria-haspopup="true" aria-expanded="false" aria-label="Add"></button>
          <button id="webSearchToggle" type="button" class="toolbar-button web-toggle" data-icon="globe" data-i18n-title="ui.webSearch" title="" aria-pressed="false" aria-label="Web Search"></button>
          <div class="segmented" role="group">
            <button id="segChat" type="button" data-mode="Ask" data-i18n="ui.modeChat"></button>
            <button id="segAgent" type="button" data-mode="Code" data-i18n="ui.modeAgent"></button>
          </div>
          <span class="composer-spacer"></span>
          <button id="model" class="model-trigger" data-i18n-title="ui.changeModel" title="" aria-haspopup="true" aria-expanded="false">
            <span id="modelName"></span>
          </button>
          <button id="send" class="send-button" data-icon="arrowUp" data-i18n-title="ui.send" title="" aria-label="Send" disabled></button>
          <button id="stop" class="send-button stop-button" data-icon="stop" data-i18n-title="ui.stop" title="" aria-label="Stop" hidden></button>
        </div>
      </div>
    </div>
    <div id="chips" class="chips">
      <button type="button" class="chip" data-mode="Code" data-starter="ui.starterCode" data-icon="code"><span data-i18n="ui.chipCode"></span></button>
      <button type="button" class="chip" data-mode="Ask" data-starter="ui.starterLearn" data-icon="cap"><span data-i18n="ui.chipLearn"></span></button>
      <button type="button" class="chip" data-mode="Code" data-starter="ui.starterWrite" data-icon="pencil"><span data-i18n="ui.chipWrite"></span></button>
      <button type="button" class="chip" data-mode="Debug" data-starter="ui.starterDebug" data-icon="bug"><span data-i18n="ui.chipDebug"></span></button>
      <button type="button" class="chip" data-mode="Plan" data-starter="ui.starterPlan" data-icon="list"><span data-i18n="ui.chipPlan"></span></button>
    </div>
    <div class="actions"><span id="status" class="status"></span></div>
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

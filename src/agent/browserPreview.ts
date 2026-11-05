import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { checkLocalUrl } from '../localGuard';
import { resolveInside, ToolResult } from './tools';

export interface BrowserActionParams {
  action?: string;
  target?: string;
  selector?: string;
  text?: string;
}

interface SnapshotResponse {
  ok: boolean;
  title: string;
  urlOrFile: string;
  actionSummary: string;
  visibleText: string;
  interactiveElements: Array<{
    tag: string;
    selector: string;
    text: string;
    value?: string;
    rect: string;
    visible: boolean;
  }>;
  consoleLogs: string[];
  errors: string[];
}

export interface ElementPickEvent {
  selector: string;
  tag: string;
  text: string;
  htmlSnippet: string;
  file?: string;
  line?: number;
}

export class BrowserPreviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private currentTarget = '';
  private pendingWaiters = new Map<string, (res: SnapshotResponse) => void>();
  private reqCounter = 0;
  public onElementPicked?: (info: ElementPickEvent) => void;

  dispose(): void {
    for (const resolve of this.pendingWaiters.values()) {
      resolve({
        ok: false,
        title: '',
        urlOrFile: this.currentTarget,
        actionSummary: 'Preview closed.',
        visibleText: '',
        interactiveElements: [],
        consoleLogs: [],
        errors: ['Preview panel was closed.']
      });
    }
    this.pendingWaiters.clear();
    this.panel?.dispose();
    this.panel = undefined;
  }

  private ensurePanel(root: string | undefined): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      return this.panel;
    }
    const localRoots = root ? [vscode.Uri.file(root)] : [];
    const panel = vscode.window.createWebviewPanel(
      'sovereignAgent.browserPreview',
      '🌐 Sovereign Live Preview & Tester',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: localRoots
      }
    );
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    panel.webview.onDidReceiveMessage((msg: { type?: string; reqId?: string; snapshot?: SnapshotResponse }) => {
      if (msg.type === 'snapshotResult' && msg.reqId && msg.snapshot) {
        const waiter = this.pendingWaiters.get(msg.reqId);
        if (waiter) {
          this.pendingWaiters.delete(msg.reqId);
          waiter(msg.snapshot);
        }
      } else if (msg.type === 'reloadPreview' && this.currentTarget) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        void this.openTarget(this.currentTarget, workspaceRoot);
      } else if (msg.type === 'elementPicked') {
        const info = msg as unknown as ElementPickEvent;
        void this.handleElementPicked(info, root);
      }
    });
    this.panel = panel;
    return panel;
  }

  private async handleElementPicked(info: ElementPickEvent, root: string | undefined): Promise<void> {
    let resolvedFile = this.currentTarget;
    let foundLine: number | undefined;

    if (root && resolvedFile && !resolvedFile.startsWith('http://') && !resolvedFile.startsWith('https://')) {
      try {
        const abs = resolveInside(root, resolvedFile);
        const text = await fs.readFile(abs, 'utf8');
        const lines = text.split(/\r?\n/);

        // Search for ID or class or tag
        const cleanSel = (info.selector || '').replace(/^[#.]/, '');
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (cleanSel && l.includes(cleanSel)) {
            foundLine = i + 1;
            break;
          }
          if (info.text && info.text.length > 3 && l.includes(info.text)) {
            foundLine = i + 1;
            break;
          }
        }

        // Open in editor at line
        const doc = await vscode.workspace.openTextDocument(abs);
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: true
        });
        if (foundLine !== undefined && editor) {
          const pos = new vscode.Position(foundLine - 1, 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      } catch {
        // Ignore file reading errors
      }
    }

    if (this.onElementPicked) {
      this.onElementPicked({
        ...info,
        file: resolvedFile,
        line: foundLine
      });
    }
  }

  /**
   * Executes a browser action (`open`, `click`, `type`, `inspect`, `snapshot`) inside the
   * in-editor Live Preview panel and returns a structured DOM + visual layout + console report.
   */
  async execute(params: BrowserActionParams, root: string | undefined): Promise<ToolResult> {
    const action = (params.action || (params.selector ? 'click' : 'open')).toLowerCase().trim();
    const target = (params.target || '').trim();
    const selector = (params.selector || '').trim();
    const text = params.text ?? '';

    if (action === 'open' || (!this.panel && target)) {
      const openTarget = target || this.currentTarget || 'index.html';
      return await this.openTarget(openTarget, root);
    }

    if (!this.panel) {
      const defaultTarget = target || 'index.html';
      const opened = await this.openTarget(defaultTarget, root);
      if (!opened.ok || action === 'open') {
        return opened;
      }
    }

    if (action === 'click') {
      if (!selector) {
        return {
          ok: false,
          output:
            'Missing <selector> for browser_action click.\nExample:\n<browser_action>\n<action>click</action>\n<selector>#submitBtn</selector>\n</browser_action>'
        };
      }
      const snap = await this.sendCommand({ cmd: 'click', selector });
      return this.formatSnapshot(snap);
    }

    if (action === 'type') {
      if (!selector) {
        return {
          ok: false,
          output:
            'Missing <selector> for browser_action type.\nExample:\n<browser_action>\n<action>type</action>\n<selector>#username</selector>\n<text>admin</text>\n</browser_action>'
        };
      }
      const snap = await this.sendCommand({ cmd: 'type', selector, text });
      return this.formatSnapshot(snap);
    }

    // Default: inspect / snapshot current DOM, layout, and console logs
    const snap = await this.sendCommand({ cmd: 'inspect', selector });
    return this.formatSnapshot(snap);
  }

  async openInteractive(root: string | undefined): Promise<void> {
    let target = this.currentTarget;
    if (!target && root) {
      const candidates = ['index.html', 'public/index.html', 'src/index.html', 'dist/index.html'];
      for (const c of candidates) {
        try {
          await fs.access(path.join(root, c));
          target = c;
          break;
        } catch {
          // continue
        }
      }
    }
    const picked = await vscode.window.showInputBox({
      prompt: 'Open workspace HTML file or local URL in Sovereign Live Preview',
      value: target || 'index.html',
      placeHolder: 'index.html or http://localhost:3000'
    });
    if (!picked) {
      return;
    }
    await this.openTarget(picked.trim(), root);
  }

  private async openTarget(target: string, root: string | undefined): Promise<ToolResult> {
    let pageHtml = '';
    let displayUrl = target;

    if (/^https?:\/\//i.test(target)) {
      const check = checkLocalUrl(target, true);
      if (!check.ok) {
        return {
          ok: false,
          output: `Blocked non-local URL in browser_action: ${target}. Only localhost/LAN or workspace HTML files are allowed.`
        };
      }
      try {
        const res = await fetch(target);
        pageHtml = await res.text();
      } catch (err) {
        return {
          ok: false,
          output: `Could not connect to local server ${target}: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    } else {
      if (!root) {
        return { ok: false, output: 'No workspace folder is open.' };
      }
      const filePath = resolveInside(root, target);
      try {
        pageHtml = await fs.readFile(filePath, 'utf8');
        pageHtml = await this.inlineLocalAssets(pageHtml, path.dirname(filePath), root);
        displayUrl = path.relative(root, filePath).split(path.sep).join('/');
      } catch (err) {
        return {
          ok: false,
          output: `Could not open HTML file "${target}": ${err instanceof Error ? err.message : String(err)}`
        };
      }
    }

    this.currentTarget = displayUrl;
    const panel = this.ensurePanel(root);
    panel.title = `🌐 Preview: ${displayUrl}`;
    panel.webview.html = this.buildHarnessHtml(pageHtml, displayUrl);

    const snap = await this.waitForInitialSnapshot();
    return this.formatSnapshot(snap);
  }

  /**
   * Resolves relative <link rel="stylesheet" href="..."> and <script src="..."></script>
   * inside workspace files so they execute cleanly inside the editor preview webview.
   */
  private async inlineLocalAssets(html: string, baseDir: string, root: string): Promise<string> {
    let out = html;

    // Inline local CSS stylesheets
    const linkRe = /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"':]+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(html)) !== null) {
      const href = match[1].trim();
      if (href.startsWith('//') || href.startsWith('data:')) continue;
      try {
        const cssFile = resolveInside(root, path.relative(root, path.resolve(baseDir, href)));
        const cssContent = await fs.readFile(cssFile, 'utf8');
        out = out.replace(match[0], `<style data-inlined="${href}">\n${cssContent}\n</style>`);
      } catch {
        // Leave original tag if file missing
      }
    }

    // Inline local JS scripts
    const scriptRe = /<script\b[^>]*src=["']([^"':]+)["'][^>]*>\s*<\/script>/gi;
    while ((match = scriptRe.exec(html)) !== null) {
      const src = match[1].trim();
      if (src.startsWith('//') || src.startsWith('data:')) continue;
      try {
        const jsFile = resolveInside(root, path.relative(root, path.resolve(baseDir, src)));
        const jsContent = await fs.readFile(jsFile, 'utf8');
        out = out.replace(match[0], `<script data-inlined="${src}">\n${jsContent}\n</script>`);
      } catch {
        // Leave original tag if file missing
      }
    }

    return out;
  }

  private waitForInitialSnapshot(): Promise<SnapshotResponse> {
    const reqId = `init_${++this.reqCounter}`;
    return new Promise<SnapshotResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingWaiters.delete(reqId);
        resolve({
          ok: true,
          title: this.currentTarget,
          urlOrFile: this.currentTarget,
          actionSummary: `Opened ${this.currentTarget}`,
          visibleText: '(Page loaded)',
          interactiveElements: [],
          consoleLogs: [],
          errors: []
        });
      }, 2500);
      this.pendingWaiters.set('__init__', (snap) => {
        clearTimeout(timer);
        resolve(snap);
      });
    });
  }

  private sendCommand(payload: { cmd: 'click' | 'type' | 'inspect'; selector?: string; text?: string }): Promise<SnapshotResponse> {
    const reqId = `req_${++this.reqCounter}`;
    return new Promise<SnapshotResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingWaiters.delete(reqId);
        resolve({
          ok: false,
          title: this.currentTarget,
          urlOrFile: this.currentTarget,
          actionSummary: `Timed out waiting for ${payload.cmd}`,
          visibleText: '',
          interactiveElements: [],
          consoleLogs: [],
          errors: ['Command timed out inside preview webview.']
        });
      }, 3000);
      this.pendingWaiters.set(reqId, (snap) => {
        clearTimeout(timer);
        resolve(snap);
      });
      void this.panel?.webview.postMessage({ type: 'agentCommand', reqId, ...payload });
    });
  }

  private formatSnapshot(snap: SnapshotResponse): ToolResult {
    const elementsText =
      snap.interactiveElements.length > 0
        ? snap.interactiveElements
            .map(
              (el, idx) =>
                `  ${idx + 1}. <${el.tag}> selector="${el.selector}" text="${el.text}"${el.value ? ` value="${el.value}"` : ''} [${el.rect}] ${el.visible ? 'visible' : 'HIDDEN'}`
            )
            .join('\n')
        : '  (No interactive buttons/inputs found)';

    const errorsText = snap.errors.length > 0 ? `\nJS / Runtime Errors (${snap.errors.length}):\n  - ${snap.errors.join('\n  - ')}` : '\nJS / Runtime Errors: None (0)';
    const logsText = snap.consoleLogs.length > 0 ? `\nConsole Output:\n  ${snap.consoleLogs.slice(-10).join('\n  ')}` : '';

    const report = [
      `[Live Browser Preview — ${snap.urlOrFile}]`,
      `Action: ${snap.actionSummary}`,
      `Page Title: ${snap.title || '(untitled)'}`,
      `Visible Text Snapshot:\n${snap.visibleText || '(empty)'}`,
      `Interactive DOM Elements (${snap.interactiveElements.length}):\n${elementsText}`,
      errorsText,
      logsText
    ]
      .filter(Boolean)
      .join('\n');

    return { ok: snap.ok, output: report };
  }

  private buildHarnessHtml(userHtml: string, displayUrl: string): string {
    const safeUrl = displayUrl.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const harnessScript = /* html */ `
<style id="__sovereign_harness_css__">
  #__sov_bar__ {
    position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important;
    width: 100% !important; box-sizing: border-box !important; z-index: 2147483640 !important;
    display: flex; align-items: center; gap: 6px;
    padding: 5px 10px; background: rgba(15, 23, 42, 0.96); color: #e2e8f0;
    font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-bottom: 1px solid #1e293b; box-shadow: 0 2px 10px rgba(0,0,0,0.28);
    backdrop-filter: blur(6px);
  }
  #__sov_bar__[hidden] { display: none !important; }
  #__sov_url__ {
    flex: 1; min-width: 60px; padding: 3px 8px; border-radius: 5px;
    background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 11.5px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .__sov_btn__ {
    padding: 3px 8px; border-radius: 6px; border: 1px solid #334155;
    background: #1e293b; color: #e2e8f0; font-size: 11px; font-weight: 600;
    cursor: pointer; white-space: nowrap;
  }
  .__sov_btn__:hover { background: #334155; border-color: #475569; }
  .__sov_btn__.primary {
    background: rgba(16, 185, 129, 0.18); border-color: rgba(16, 185, 129, 0.45); color: #34d399;
  }
  .__sov_btn__.primary:hover { background: rgba(16, 185, 129, 0.28); }
  .__sov_btn__.err {
    background: rgba(239, 68, 68, 0.22); border-color: rgba(239, 68, 68, 0.5); color: #f87171;
  }
  #__sov_fab__ {
    position: fixed !important; bottom: 12px !important; right: 12px !important; z-index: 2147483641 !important;
    padding: 5px 10px; border-radius: 999px; border: 1px solid #334155;
    background: rgba(15, 23, 42, 0.92); color: #38bdf8; font: 600 11.5px sans-serif;
    cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  #__sov_drawer__ {
    position: fixed !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
    max-height: 44vh; overflow-y: auto; z-index: 2147483642 !important;
    background: rgba(15, 23, 42, 0.97); color: #e2e8f0;
    border-top: 1px solid #334155; padding: 10px 12px;
    font: 12px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    box-shadow: 0 -4px 16px rgba(0,0,0,0.35);
  }
  #__sov_drawer__[hidden] { display: none !important; }
  .__sov_dom_row__ {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 5px 8px; border-bottom: 1px solid #1e293b; font-family: monospace; font-size: 11.5px;
  }
  .__sov_dom_row__:hover { background: #1e293b; }
  .__sov_pulse__ {
    outline: 3px solid #f59e0b !important;
    outline-offset: 2px !important;
    box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.35) !important;
    transition: outline 0.2s ease, box-shadow 0.2s ease !important;
  }
  #__sov_toast__ {
    position: fixed !important; bottom: 14px !important; left: 14px !important; z-index: 2147483645 !important;
    padding: 7px 12px; border-radius: 8px; background: #0f172a; color: #f8fafc;
    border: 1px solid #38bdf8; font: 12px sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,0.35);
    display: none;
  }
  .__sov_hover_pick__ {
    outline: 2px dashed #6366f1 !important;
    outline-offset: 2px !important;
    cursor: crosshair !important;
  }
  .__sov_btn__.active {
    background: rgba(99, 102, 241, 0.22);
    border-color: #6366f1;
    color: #818cf8;
  }
</style>
<div id="__sov_bar__">
  <span style="font-weight:600">🌐 Live Preview</span>
  <span id="__sov_url__">${safeUrl}</span>
  <button type="button" id="__sov_pick_btn__" class="__sov_btn__" title="Click any element on page to inspect and prompt agent in chat (or Alt+Click)">🎯 Pick & Prompt</button>
  <button type="button" id="__sov_dom_btn__" class="__sov_btn__ primary" title="Inspect DOM Elements & Console">✓ DOM Ready</button>
  <button type="button" id="__sov_autotest_btn__" class="__sov_btn__" title="Auto-test inputs and buttons on this page">▶ Test UI</button>
  <button type="button" id="__sov_reload_btn__" class="__sov_btn__" title="Reload Page">↻</button>
  <button type="button" id="__sov_min_btn__" class="__sov_btn__" title="Minimize Toolbar">✕</button>
</div>
<button type="button" id="__sov_fab__" hidden title="Show Live Preview Toolbar">🌐 DevTools</button>
<div id="__sov_drawer__" hidden>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
    <strong style="color:#38bdf8">🔍 Live DOM Elements & Console Inspector</strong>
    <button type="button" id="__sov_drawer_close__" class="__sov_btn__">Close</button>
  </div>
  <div id="__sov_dom_list__"></div>
</div>
<div id="__sov_toast__"></div>
<script id="__sovereign_harness_js__">
(function() {
  const vscode = acquireVsCodeApi();
  const logs = [];
  const errors = [];
  const barEl = document.getElementById('__sov_bar__');
  const fabEl = document.getElementById('__sov_fab__');
  const domBtn = document.getElementById('__sov_dom_btn__');
  const autoTestBtn = document.getElementById('__sov_autotest_btn__');
  const reloadBtn = document.getElementById('__sov_reload_btn__');
  const minBtn = document.getElementById('__sov_min_btn__');
  const drawerEl = document.getElementById('__sov_drawer__');
  const drawerCloseBtn = document.getElementById('__sov_drawer_close__');
  const domListEl = document.getElementById('__sov_dom_list__');
  const toastEl = document.getElementById('__sov_toast__');

  function isHarnessNode(el) {
    return Boolean(el && el.closest && el.closest('#__sov_bar__, #__sov_drawer__, #__sov_fab__, #__sov_toast__'));
  }

  function showToast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    setTimeout(() => { toastEl.style.display = 'none'; }, 2000);
  }

  function updateBadge() {
    if (!domBtn) return;
    const count = getInteractiveNodes().length;
    if (errors.length > 0) {
      domBtn.textContent = '✕ ' + errors.length + ' Error · 🔍 DOM (' + count + ')';
      domBtn.className = '__sov_btn__ err';
    } else {
      domBtn.textContent = '✓ 0 Errors · 🔍 DOM (' + count + ')';
      domBtn.className = '__sov_btn__ primary';
    }
  }

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = function(...args) {
    logs.push(args.map(String).join(' '));
    origLog.apply(console, args);
  };
  console.warn = function(...args) {
    logs.push('[WARN] ' + args.map(String).join(' '));
    origWarn.apply(console, args);
  };
  console.error = function(...args) {
    errors.push(args.map(String).join(' '));
    updateBadge();
    origError.apply(console, args);
  };
  window.addEventListener('error', (e) => {
    errors.push(e.message || 'Uncaught runtime error');
    updateBadge();
  });

  function uniqueSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/).filter(c => !c.startsWith('__sov_'))[0];
      if (cls) return el.tagName.toLowerCase() + '.' + cls;
    }
    return el.tagName.toLowerCase();
  }

  function getInteractiveNodes() {
    return Array.from(document.querySelectorAll('button, input, select, textarea, a, [role="button"]'))
      .filter(el => !isHarnessNode(el));
  }

  function findTargetElement(sel) {
    if (!sel) return null;
    if (sel.startsWith('text:')) {
      const needle = sel.slice(5).trim().toLowerCase();
      return getInteractiveNodes().find(el => (el.textContent || el.value || '').trim().toLowerCase().includes(needle)) || null;
    }
    try {
      const found = document.querySelector(sel);
      if (found && !isHarnessNode(found)) return found;
    } catch {}
    const needle = sel.replace(/^[#.]/, '').trim().toLowerCase();
    return getInteractiveNodes().find(el => (el.textContent || el.value || el.id || el.getAttribute('placeholder') || '').trim().toLowerCase().includes(needle)) || null;
  }

  function highlight(el, label) {
    if (!el) return;
    el.classList.add('__sov_pulse__');
    showToast('🤖 ' + label);
    setTimeout(() => el.classList.remove('__sov_pulse__'), 1400);
  }

  function collectSnapshot(ok, actionSummary) {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (clone) {
      clone.querySelectorAll('#__sov_bar__, #__sov_drawer__, #__sov_fab__, #__sov_toast__, script, style').forEach(n => n.remove());
    }
    const visibleText = clone ? (clone.innerText || clone.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 4000) : '';
    const interactive = getInteractiveNodes()
      .slice(0, 40)
      .map(el => {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        return {
          tag: el.tagName.toLowerCase(),
          selector: uniqueSelector(el),
          text: (el.innerText || el.textContent || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').trim().slice(0, 60),
          value: 'value' in el ? String(el.value || '').slice(0, 60) : undefined,
          rect: Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top),
          visible
        };
      });

    updateBadge();
    return {
      ok,
      title: document.title || '',
      urlOrFile: ${JSON.stringify(displayUrl)},
      actionSummary,
      visibleText,
      interactiveElements: interactive,
      consoleLogs: logs.slice(-15),
      errors: errors.slice(-15)
    };
  }

  function renderDomDrawer() {
    if (!domListEl) return;
    const snap = collectSnapshot(true, 'Manual DOM inspect');
    domListEl.replaceChildren();
    if (snap.interactiveElements.length === 0) {
      domListEl.textContent = 'No interactive elements found on page.';
      return;
    }
    snap.interactiveElements.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = '__sov_dom_row__';
      const info = document.createElement('span');
      info.textContent = (idx + 1) + '. <' + item.tag + '> ' + item.selector + (item.text ? ' "' + item.text + '"' : '') + ' [' + item.rect + ']';
      const act = document.createElement('button');
      act.type = 'button';
      act.className = '__sov_btn__';
      act.textContent = item.tag === 'input' || item.tag === 'textarea' ? 'Test Fill' : 'Test Click';
      act.addEventListener('click', () => {
        const nodes = getInteractiveNodes();
        const target = nodes[idx];
        if (!target) return;
        if (item.tag === 'input' || item.tag === 'textarea') {
          highlight(target, 'Fill ' + item.selector);
          target.focus();
          target.value = target.type === 'password' ? 'TestPass123!' : 'test_user';
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          highlight(target, 'Click ' + item.selector);
          target.click();
        }
        setTimeout(renderDomDrawer, 200);
      });
      row.append(info, act);
      domListEl.appendChild(row);
    });
  }

  const pickBtn = document.getElementById('__sov_pick_btn__');
  let pickMode = false;
  let hoveredPickEl = null;

  function setPickMode(active) {
    pickMode = active;
    if (pickBtn) {
      pickBtn.classList.toggle('active', active);
      pickBtn.textContent = active ? '🎯 Pick Mode ON' : '🎯 Pick & Prompt';
    }
    if (!active && hoveredPickEl) {
      hoveredPickEl.classList.remove('__sov_hover_pick__');
      hoveredPickEl = null;
    }
    showToast(active ? '🎯 Click any element on page' : 'Pick mode off');
  }

  pickBtn?.addEventListener('click', () => setPickMode(!pickMode));

  document.addEventListener('mouseover', (e) => {
    if (!pickMode && !e.altKey) return;
    const target = e.target;
    if (isHarnessNode(target)) return;
    if (hoveredPickEl && hoveredPickEl !== target) {
      hoveredPickEl.classList.remove('__sov_hover_pick__');
    }
    hoveredPickEl = target;
    target.classList.add('__sov_hover_pick__');
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (e.target && e.target.classList) {
      e.target.classList.remove('__sov_hover_pick__');
    }
  }, true);

  document.addEventListener('click', (e) => {
    if (!pickMode && !e.altKey) return;
    const target = e.target;
    if (isHarnessNode(target)) return;

    e.preventDefault();
    e.stopPropagation();

    highlight(target, 'Selected element');
    const selector = uniqueSelector(target);
    const tag = target.tagName.toLowerCase();
    const text = (target.innerText || target.textContent || target.getAttribute('placeholder') || '').trim().slice(0, 80);
    const htmlSnippet = target.outerHTML ? target.outerHTML.slice(0, 300) : '';

    vscode.postMessage({
      type: 'elementPicked',
      selector,
      tag,
      text,
      htmlSnippet
    });

    setPickMode(false);
  }, true);
    const nextHidden = !drawerEl.hidden;
    drawerEl.hidden = nextHidden;
    if (!nextHidden) renderDomDrawer();
  });
  drawerCloseBtn?.addEventListener('click', () => { drawerEl.hidden = true; });
  reloadBtn?.addEventListener('click', () => vscode.postMessage({ type: 'reloadPreview' }));
  minBtn?.addEventListener('click', () => {
    barEl.hidden = true;
    drawerEl.hidden = true;
    fabEl.hidden = false;
  });
  fabEl?.addEventListener('click', () => {
    fabEl.hidden = true;
    barEl.hidden = false;
  });

  autoTestBtn?.addEventListener('click', async () => {
    const nodes = getInteractiveNodes();
    if (nodes.length === 0) {
      showToast('No inputs or buttons to test');
      return;
    }
    let step = 0;
    for (const node of nodes) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        const type = (node.getAttribute('type') || 'text').toLowerCase();
        if (type !== 'submit' && type !== 'button') {
          highlight(node, 'Auto-Test Fill ' + uniqueSelector(node));
          node.focus();
          node.value = type === 'password' ? 'Sovereign123!' : type === 'email' ? 'test@example.com' : type === 'number' ? '42' : 'test_user';
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 450));
          step++;
        }
      }
    }
    const submitBtn = nodes.find(n => n.tagName.toLowerCase() === 'button' || (n.tagName.toLowerCase() === 'input' && ['submit', 'button'].includes((n.getAttribute('type') || '').toLowerCase())));
    if (submitBtn) {
      highlight(submitBtn, 'Auto-Test Click ' + uniqueSelector(submitBtn));
      submitBtn.click();
      step++;
    }
    updateBadge();
    if (!drawerEl.hidden) renderDomDrawer();
    showToast('✓ Auto-tested ' + step + ' element(s) · ' + errors.length + ' JS Error(s)');
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'agentCommand') return;
    const { reqId, cmd, selector, text } = msg;

    if (cmd === 'click') {
      const el = findTargetElement(selector);
      if (!el) {
        vscode.postMessage({
          type: 'snapshotResult',
          reqId,
          snapshot: collectSnapshot(false, 'Element not found for selector: ' + selector)
        });
        return;
      }
      highlight(el, 'click ' + selector);
      el.click();
      setTimeout(() => {
        vscode.postMessage({
          type: 'snapshotResult',
          reqId,
          snapshot: collectSnapshot(true, 'Clicked "' + selector + '"')
        });
      }, 150);
    } else if (cmd === 'type') {
      const el = findTargetElement(selector);
      if (!el) {
        vscode.postMessage({
          type: 'snapshotResult',
          reqId,
          snapshot: collectSnapshot(false, 'Input element not found for selector: ' + selector)
        });
        return;
      }
      highlight(el, 'type "' + text + '" into ' + selector);
      el.focus();
      if ('value' in el) {
        el.value = text || '';
      } else {
        el.textContent = text || '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => {
        vscode.postMessage({
          type: 'snapshotResult',
          reqId,
          snapshot: collectSnapshot(true, 'Typed "' + text + '" into "' + selector + '"')
        });
      }, 150);
    } else {
      vscode.postMessage({
        type: 'snapshotResult',
        reqId,
        snapshot: collectSnapshot(true, 'Inspected live DOM & layout')
      });
    }
  });

  window.addEventListener('load', () => {
    setTimeout(() => {
      updateBadge();
      vscode.postMessage({
        type: 'snapshotResult',
        reqId: '__init__',
        snapshot: collectSnapshot(true, 'Opened page in Live Preview & captured initial DOM snapshot')
      });
    }, 120);
  });
})();
</script>`;

    if (/<body\b[^>]*>/i.test(userHtml)) {
      return userHtml.replace(/<body\b[^>]*>/i, (m) => `${m}\n${harnessScript}`);
    }
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${harnessScript}\n${userHtml}</body></html>`;
  }
}


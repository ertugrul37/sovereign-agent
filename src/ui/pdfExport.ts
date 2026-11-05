import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import type { ChatMessage } from '../llm/types';
import { parseToolCall, visibleText, ToolCall } from '../agent/protocol';

export interface ChatExportOptions {
  history: ChatMessage[];
  workspaceName: string;
  model: string;
  date: Date;
}

export interface PdfExportResult {
  ok: boolean;
  targetPath: string;
  isPdf: boolean;
  browserUsed?: string;
  error?: string;
}

export function findHeadlessBrowser(): string | null {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const candidates: string[] = [];

  if (isWindows) {
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    candidates.push(
      path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    );
  } else if (isMac) {
    candidates.push(
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    );
  } else {
    // Linux
    candidates.push(
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/brave-browser',
      '/snap/bin/chromium'
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }

  // PATH lookup
  const binNames = isWindows
    ? ['msedge.exe', 'chrome.exe']
    : ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser'];
  const envPath = process.env.PATH || '';
  const pathDirs = envPath.split(path.delimiter);
  for (const dir of pathDirs) {
    for (const bin of binNames) {
      const full = path.join(dir, bin);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }

  return null;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeEncoding(str: string): string {
  return str
    .replace(/bulam\uFFFDyor/g, 'bulamıyor')
    .replace(/bulunam\uFFFDyor/g, 'bulunamıyor')
    .replace(/çal\uFFFD\uFFFD/g, 'çalış')
    .replace(/yap\uFFFDl/g, 'yapıl')
    .replace(/\uFFFD/g, 'ı');
}

function renderInline(str: string): string {
  let s = escapeHtml(normalizeEncoding(str));

  // LaTeX arrows
  s = s.replace(/\$\\rightarrow\$/g, '→');
  s = s.replace(/\$\\leftarrow\$/g, '←');
  s = s.replace(/\$\\leftrightarrow\$/g, '↔');

  // Inline code with filepath recognition
  s = s.replace(/`([^`]+)`/g, (_match, code: string) => {
    const isPath = /^[\w\-./\\]+\.(?:ts|js|json|css|html|md|py|go|rs|cpp|c|h|sh|sql|yaml|yml|env)$/i.test(code)
      || code.includes('/') || code.includes('\\');
    if (isPath) {
      return `<code class="code-filepath">${code}</code>`;
    }
    return `<code class="inline-code">${code}</code>`;
  });

  // Bold & Italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return s;
}

function parseTableLine(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const parts = parseTableLine(line);
  return parts.length > 0 && parts.every((p) => /^:?-{2,}:?$/.test(p));
}

export function renderMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';

  return markdown
    .split('```')
    .map((part, i) => {
      if (i % 2 === 1) {
        const nl = part.indexOf('\n');
        const lang = (nl >= 0 ? part.slice(0, nl) : '').trim().replace(/[^a-zA-Z0-9_+#.-]/g, '');
        const code = nl >= 0 ? part.slice(nl + 1) : part;
        return (
          `<div class="code-block">` +
            `<div class="code-header">` +
              `<span class="code-lang">${escapeHtml(lang || 'terminal')}</span>` +
            `</div>` +
            `<pre><code>${escapeHtml(normalizeEncoding(code.replace(/\n$/, '')))}</code></pre>` +
          `</div>`
        );
      }

      const lines = part.split('\n');
      const out: string[] = [];
      let idx = 0;

      while (idx < lines.length) {
        const line = lines[idx];
        const trimmed = line.trim();

        if (!trimmed) {
          out.push('');
          idx++;
          continue;
        }

        // Table
        if (trimmed.includes('|') && idx + 1 < lines.length && isTableSeparator(lines[idx + 1])) {
          const headers = parseTableLine(trimmed);
          const seps = parseTableLine(lines[idx + 1]);
          const alignments = seps.map((c) => {
            const l = c.startsWith(':');
            const r = c.endsWith(':');
            if (l && r) return 'center';
            if (r) return 'right';
            return 'left';
          });

          let tableHtml = '<div class="chat-table-wrap"><table class="chat-table"><thead><tr>';
          headers.forEach((h, hIdx) => {
            const align = alignments[hIdx] || 'left';
            tableHtml += `<th style="text-align:${align}">${renderInline(h)}</th>`;
          });
          tableHtml += '</tr></thead><tbody>';

          idx += 2;
          while (idx < lines.length && lines[idx].trim().includes('|')) {
            const rowLine = lines[idx].trim();
            if (!rowLine || isTableSeparator(rowLine)) {
              idx++;
              continue;
            }
            const cells = parseTableLine(rowLine);
            tableHtml += '<tr>';
            headers.forEach((_, cIdx) => {
              const align = alignments[cIdx] || 'left';
              const val = cells[cIdx] !== undefined ? cells[cIdx] : '';
              tableHtml += `<td style="text-align:${align}">${renderInline(val)}</td>`;
            });
            tableHtml += '</tr>';
            idx++;
          }
          tableHtml += '</tbody></table></div>';
          out.push(tableHtml);
          continue;
        }

        // Headings
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          const lvl = headingMatch[1].length;
          out.push(`<h${lvl}>${renderInline(headingMatch[2])}</h${lvl}>`);
          idx++;
          continue;
        }

        // Blockquotes
        if (trimmed.startsWith('>')) {
          const qLines: string[] = [];
          while (idx < lines.length && lines[idx].trim().startsWith('>')) {
            qLines.push(lines[idx].trim().replace(/^>\s?/, ''));
            idx++;
          }
          out.push(`<blockquote class="chat-quote">${qLines.map(renderInline).join('<br>')}</blockquote>`);
          continue;
        }

        // Bullet lists
        if (/^[*+-]\s+/.test(trimmed)) {
          let listHtml = '<ul class="chat-list">';
          while (idx < lines.length) {
            const m = lines[idx].trim().match(/^[*+-]\s+(.+)$/);
            if (!m) break;
            listHtml += `<li>${renderInline(m[1])}</li>`;
            idx++;
          }
          listHtml += '</ul>';
          out.push(listHtml);
          continue;
        }

        // Numbered lists
        if (/^\d+\.\s+/.test(trimmed)) {
          let listHtml = '<ol class="chat-list">';
          while (idx < lines.length) {
            const m = lines[idx].trim().match(/^\d+\.\s+(.+)$/);
            if (!m) break;
            listHtml += `<li>${renderInline(m[1])}</li>`;
            idx++;
          }
          listHtml += '</ol>';
          out.push(listHtml);
          continue;
        }

        // Horizontal rule
        if (/^(---|---|\*\*\*|___)\s*$/.test(trimmed)) {
          out.push('<hr class="chat-divider">');
          idx++;
          continue;
        }

        // Regular line
        out.push(renderInline(trimmed));
        idx++;
      }

      let result = '';
      for (const cur of out) {
        if (!cur) {
          if (result && !result.endsWith('</div>') && !result.endsWith('</ul>') && !result.endsWith('</ol>') && !result.endsWith('</blockquote>') && !/<\/h[1-6]>$/.test(result) && !result.endsWith('<br>')) {
            result += '<br>';
          }
          continue;
        }
        const isBlock = cur.startsWith('<h') || cur.startsWith('<div class="chat-table') || cur.startsWith('<ul') || cur.startsWith('<ol') || cur.startsWith('<blockquote') || cur.startsWith('<hr');
        if (result) {
          const prevBlock = result.endsWith('</div>') || result.endsWith('</ul>') || result.endsWith('</ol>') || result.endsWith('</blockquote>') || /<\/h[1-6]>$/.test(result) || result.endsWith('<hr class="chat-divider">');
          if (prevBlock || isBlock) {
            result += '\n' + cur;
          } else {
            result += '<br>' + cur;
          }
        } else {
          result = cur;
        }
      }
      return result;
    })
    .join('');
}

function getToolIcon(name: string): string {
  switch (name) {
    case 'read_file': return '📖';
    case 'write_file': return '📝';
    case 'replace_in_file': return '✏️';
    case 'list_files': return '📂';
    case 'search_files': return '🔍';
    case 'run_command': return '💻';
    case 'run_tests': return '🧪';
    case 'web_search': return '🌐';
    case 'code_graph': return '🕸️';
    default: return '🛠️';
  }
}

function formatToolParam(call: ToolCall): string {
  const p = call.params;
  if (p.path) return p.path;
  if (p.command) return p.command;
  if (p.pattern) return p.pattern;
  if (p.query) return p.query;
  if (p.target) return p.target;
  return Object.values(p).filter(Boolean)[0] || '';
}

function renderToolCallCard(call: ToolCall): string {
  const icon = getToolIcon(call.name);
  const param = formatToolParam(call);
  return `
    <div class="tool-call-pill">
      <span class="tool-icon">${icon}</span>
      <span class="tool-name">${escapeHtml(call.name)}</span>
      ${param ? `<span class="tool-param">${escapeHtml(param)}</span>` : ''}
      <span class="tool-status">✓ Executed</span>
    </div>`;
}

export function buildChatHtml(options: ChatExportOptions): string {
  const { history, workspaceName, model, date } = options;

  let messagesHtml = '';

  for (const msg of history) {
    const isUser = msg.role === 'user';
    const isToolOutput = isUser && msg.content.startsWith('[');

    if (isToolOutput) {
      // Parse [toolName result] or [toolName error]
      const match = msg.content.match(/^\[([a-zA-Z0-9_]+)\s+(result|error)\]\s*([\s\S]*)$/);
      const toolName = match ? match[1] : 'tool';
      const isError = match ? match[2] === 'error' : false;
      const body = match ? match[3].trim() : msg.content;
      const icon = isError ? '✕' : '⚙️';
      const statusLabel = isError ? 'Failed' : 'Success';

      messagesHtml += `
      <div class="msg-wrap tool-result ${isError ? 'failed' : 'succeeded'}">
        <div class="tool-result-header">
          <span class="tool-result-icon">${icon}</span>
          <span class="tool-result-title">${escapeHtml(toolName)} ${isError ? 'Error' : 'Output'}</span>
          <span class="tool-result-badge ${isError ? 'failed' : 'succeeded'}">${statusLabel}</span>
        </div>
        <pre class="tool-result-pre"><code>${escapeHtml(normalizeEncoding(body))}</code></pre>
      </div>`;
      continue;
    }

    if (isUser) {
      messagesHtml += `
      <div class="msg-wrap user">
        <div class="msg-bubble user-bubble">
          <div class="bubble-author">
            <span class="author-user">👤 You</span>
          </div>
          <div class="msg-content">
            ${renderMarkdownToHtml(msg.content)}
          </div>
        </div>
      </div>`;
    } else if (msg.role === 'assistant') {
      // Extract human-facing text before any tool call tag
      const textToRender = visibleText(msg.content);
      const toolCall = parseToolCall(msg.content);

      // Clean any unclosed or trailing tool tags from remaining text
      const cleanText = textToRender.replace(/<[a-zA-Z0-9_]+[\s\S]*$/, '').trim();

      messagesHtml += `
      <div class="msg-wrap assistant">
        <div class="msg-bubble assistant-bubble">
          <div class="bubble-author">
            <span class="author-bot">⚡ Sovereign Agent</span>
            <span class="model-tag">${escapeHtml(model || 'local-model')}</span>
          </div>
          <div class="msg-content">
            ${cleanText ? renderMarkdownToHtml(cleanText) : ''}
            ${toolCall ? renderToolCallCard(toolCall) : ''}
          </div>
        </div>
      </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sovereign Agent — Chat Transcript (${escapeHtml(workspaceName)})</title>
<style>
  @page {
    size: A4 portrait;
    margin: 0;
  }
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  html {
    background-color: #0d0f12 !important;
  }
  body {
    background-color: #0d0f12 !important;
    color: #f1f3f7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    width: 100%;
    min-height: 100vh;
  }
  .pdf-page-container {
    padding: 16mm 14mm 16mm 14mm;
    margin: 0 auto;
    max-width: 860px;
    box-sizing: border-box;
  }
  .header-card {
    background: #15181e;
    border: 1px solid #262c36;
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo-icon {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 17px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
  }
  .brand-text h1 {
    font-size: 15.5px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.2px;
  }
  .brand-text p {
    font-size: 11px;
    color: #9c9a95;
  }
  .meta-pills {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    align-items: center;
  }
  .pill {
    padding: 3px 9px;
    border-radius: 12px;
    background: #242428;
    border: 1px solid #38383f;
    font-size: 11px;
    color: #c5c2ba;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .pill strong { color: #ffffff; }
  .pill.secure {
    border-color: rgba(74, 222, 128, 0.4);
    color: #4ade80;
    background: rgba(74, 222, 128, 0.08);
    font-weight: 600;
  }
  .chat-feed {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .msg-wrap {
    page-break-inside: avoid;
    break-inside: avoid;
    display: flex;
    flex-direction: column;
  }
  .msg-wrap.user {
    align-items: flex-end;
  }
  .msg-wrap.assistant {
    align-items: flex-start;
  }
  .msg-bubble {
    border-radius: 12px;
    padding: 12px 16px;
    position: relative;
  }
  .msg-wrap.user .msg-bubble {
    background: #1c2027;
    border: 1px solid #262c36;
    color: #f1f3f7;
    max-width: 95%;
  }
  .msg-wrap.assistant .msg-bubble {
    background: #15181e;
    border: 1px solid #262c36;
    color: #f1f3f7;
    width: 100%;
  }
  .bubble-author {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
    font-size: 12px;
    font-weight: 600;
  }
  .author-user { color: #38bdf8; }
  .author-bot { color: #818cf8; }
  .model-tag {
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(99, 102, 241, 0.15);
    color: #818cf8;
    border: 1px solid rgba(99, 102, 241, 0.35);
    font-weight: 500;
  }
  .msg-content h1, .msg-content h2, .msg-content h3, .msg-content h4 {
    color: #ffffff;
    margin: 12px 0 6px 0;
    font-weight: 600;
  }
  .msg-content h1 { font-size: 16px; }
  .msg-content h2 { font-size: 15px; }
  .msg-content h3 {
    font-size: 14px;
    border-left: 3px solid #6366f1;
    padding-left: 8px;
  }
  .msg-content h4 { font-size: 13px; }
  .msg-content p {
    margin-bottom: 8px;
  }
  .msg-content p:last-child {
    margin-bottom: 0;
  }
  .inline-code {
    background: #242429;
    border: 1px solid #3c3c44;
    color: #fca5a5;
    padding: 1px 5px;
    border-radius: 4px;
    font-family: Consolas, 'Cascadia Code', monospace;
    font-size: 11.5px;
  }
  .code-filepath {
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.35);
    color: #38bdf8;
    padding: 2px 7px;
    border-radius: 5px;
    font-family: Consolas, monospace;
    font-size: 11.5px;
    font-weight: 500;
  }
  .code-block {
    background: #111113;
    border: 1px solid #28282e;
    border-radius: 8px;
    margin: 10px 0;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .code-header {
    background: #18181c;
    border-bottom: 1px solid #28282e;
    padding: 4px 12px;
    font-size: 10.5px;
    color: #9c9a95;
    font-family: Consolas, monospace;
    display: flex;
    justify-content: space-between;
  }
  .code-block pre {
    padding: 10px 12px;
    overflow-x: auto;
    font-family: Consolas, 'Cascadia Code', 'Fira Code', monospace;
    font-size: 11.5px;
    line-height: 1.5;
    color: #e2e8f0;
  }

  /* Tool execution card */
  .tool-call-pill {
    margin-top: 10px;
    padding: 7px 12px;
    border-radius: 8px;
    background: #15181e;
    border: 1px solid #262c36;
    border-left: 3px solid #6366f1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .tool-call-pill .tool-icon {
    font-size: 13px;
  }
  .tool-call-pill .tool-name {
    font-weight: 600;
    color: #f1f5f9;
  }
  .tool-call-pill .tool-param {
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.1);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid rgba(56, 189, 248, 0.25);
    font-family: Consolas, monospace;
    font-size: 11px;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool-call-pill .tool-status {
    margin-left: auto;
    font-size: 10.5px;
    color: #4ade80;
    font-weight: 500;
  }

  /* Tool result output */
  .tool-result {
    border-radius: 9px;
    background: #131316;
    border: 1px solid #28282e;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .tool-result.succeeded {
    border-left: 3px solid #4ade80;
  }
  .tool-result.failed {
    border-left: 3px solid #f85149;
  }
  .tool-result-header {
    background: #18181d;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    border-bottom: 1px solid #24242a;
  }
  .tool-result-title {
    font-weight: 600;
    color: #cbd5e1;
  }
  .tool-result-badge {
    margin-left: auto;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
  }
  .tool-result-badge.succeeded {
    background: rgba(74, 222, 128, 0.12);
    color: #4ade80;
    border: 1px solid rgba(74, 222, 128, 0.3);
  }
  .tool-result-badge.failed {
    background: rgba(248, 81, 73, 0.12);
    color: #f85149;
    border: 1px solid rgba(248, 81, 73, 0.3);
  }
  .tool-result-pre {
    padding: 8px 12px;
    overflow-x: auto;
    font-family: Consolas, 'Cascadia Code', monospace;
    font-size: 11.5px;
    line-height: 1.45;
    color: #94a3b8;
  }

  .chat-table-wrap {
    margin: 10px 0;
    overflow-x: auto;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .chat-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    background: #17171a;
    border: 1px solid #2d2d33;
    border-radius: 8px;
    overflow: hidden;
  }
  .chat-table th {
    background: #202025;
    color: #f1f5f9;
    font-weight: 600;
    padding: 7px 11px;
    border: 1px solid #2d2d33;
  }
  .chat-table td {
    padding: 6px 11px;
    border: 1px solid #28282e;
    color: #cbd5e1;
  }
  .chat-table tr:nth-child(even) {
    background: #1b1b1f;
  }
  .chat-list {
    margin: 6px 0 6px 22px;
  }
  .chat-list li {
    margin-bottom: 3px;
  }
  .chat-quote {
    border-left: 3px solid #52525b;
    padding-left: 10px;
    color: #a1a1aa;
    margin: 6px 0;
    font-style: italic;
  }
  .chat-divider {
    border: 0;
    border-top: 1px solid #2e2e33;
    margin: 12px 0;
  }
  .footer-note {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid #28282e;
    font-size: 10.5px;
    color: #737373;
    text-align: center;
    page-break-inside: avoid;
    break-inside: avoid;
  }
</style>
</head>
<body>
  <div class="pdf-page-container">
    <div class="header-card">
      <div class="brand">
        <div class="logo-icon">⚡</div>
        <div class="brand-text">
          <h1>Sovereign Agent — Chat Transcript</h1>
          <p>100% Offline, Local AI Companion</p>
        </div>
      </div>
      <div class="meta-pills">
        <div class="pill">📁 <strong>${escapeHtml(workspaceName)}</strong></div>
        <div class="pill">🤖 <strong>${escapeHtml(model || 'Default')}</strong></div>
        <div class="pill">📅 <strong>${escapeHtml(date.toLocaleString())}</strong></div>
        <div class="pill secure">🔒 Zero Telemetry</div>
      </div>
    </div>

    <div class="chat-feed">
      ${messagesHtml}
    </div>

    <div class="footer-note">
      Exported with Sovereign Agent · 100% Local AI & Zero Telemetry · ${escapeHtml(date.toLocaleString())}
    </div>
  </div>
</body>
</html>`;
}

export async function exportToPdf(html: string, targetPdfPath: string): Promise<PdfExportResult> {
  const browserPath = findHeadlessBrowser();

  if (browserPath) {
    const tempHtml = path.join(os.tmpdir(), `sovereign-agent-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
    try {
      await fs.promises.writeFile(tempHtml, html, 'utf8');

      await new Promise<void>((resolve, reject) => {
        cp.execFile(
          browserPath,
          [
            '--headless',
            '--disable-gpu',
            '--no-pdf-header-footer',
            '--run-all-compositor-stages-before-draw',
            `--print-to-pdf=${targetPdfPath}`,
            tempHtml
          ],
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });

      if (fs.existsSync(targetPdfPath) && fs.statSync(targetPdfPath).size > 0) {
        return {
          ok: true,
          targetPath: targetPdfPath,
          isPdf: true,
          browserUsed: path.basename(browserPath)
        };
      }
    } catch (err) {
      // Fall through to HTML export if headless execution had issues
    } finally {
      try {
        if (fs.existsSync(tempHtml)) {
          await fs.promises.unlink(tempHtml);
        }
      } catch {
        // ignore cleanup error
      }
    }
  }

  // Fallback: save as self-contained standalone HTML document that user can open and print to PDF
  const fallbackHtmlPath = targetPdfPath.endsWith('.pdf')
    ? targetPdfPath.slice(0, -4) + '.html'
    : targetPdfPath + '.html';

  const printableHtml = html.replace('</body>', '<script>window.onload = function() { window.print(); };</script></body>');
  await fs.promises.writeFile(fallbackHtmlPath, printableHtml, 'utf8');

  return {
    ok: true,
    targetPath: fallbackHtmlPath,
    isPdf: false,
    error: 'No headless browser found; saved as pixel-perfect printable HTML.'
  };
}

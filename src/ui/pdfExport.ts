import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import type { ChatMessage } from '../llm/types';

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

function renderInline(str: string): string {
  let s = escapeHtml(str);

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
              `<span class="code-lang">${escapeHtml(lang || 'code')}</span>` +
              `<span class="code-tag">Source</span>` +
            `</div>` +
            `<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>` +
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

export function buildChatHtml(options: ChatExportOptions): string {
  const { history, workspaceName, model, date } = options;

  let messagesHtml = '';

  for (const msg of history) {
    const isUser = msg.role === 'user';
    const isToolResult = isUser && msg.content.startsWith('[');

    if (isToolResult) {
      messagesHtml += `
      <div class="msg-wrap tool-result">
        <div class="msg-bubble tool-bubble">
          <div class="bubble-author">
            <span class="author-tool">⚙️ System & Tool Output</span>
          </div>
          <div class="msg-content">
            <pre class="tool-content"><code>${escapeHtml(msg.content)}</code></pre>
          </div>
        </div>
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
            <p>${renderMarkdownToHtml(msg.content)}</p>
          </div>
        </div>
      </div>`;
    } else if (msg.role === 'assistant') {
      messagesHtml += `
      <div class="msg-wrap assistant">
        <div class="msg-bubble assistant-bubble">
          <div class="bubble-author">
            <span class="author-bot">⚡ Sovereign Agent</span>
            <span class="model-tag">${escapeHtml(model || 'local-model')}</span>
          </div>
          <div class="msg-content">
            ${renderMarkdownToHtml(msg.content)}
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
    margin: 12mm 10mm 12mm 10mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #141416 !important;
    color: #ece9e4;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13.5px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    padding: 24px;
    margin: 0 auto;
    max-width: 900px;
  }
  .header-card {
    background: #1b1b1e;
    border: 1px solid #2e2e33;
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 24px;
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
    width: 34px;
    height: 34px;
    background: linear-gradient(135deg, #d97757 0%, #b85a3c 100%);
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 18px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(217, 119, 87, 0.35);
  }
  .brand-text h1 {
    font-size: 16px;
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
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .pill {
    padding: 4px 10px;
    border-radius: 14px;
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
    gap: 20px;
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
    padding: 14px 18px;
    max-width: 96%;
    position: relative;
  }
  .msg-wrap.user .msg-bubble {
    background: #2a2926;
    border: 1px solid #3d3b37;
    color: #f5f3ef;
  }
  .msg-wrap.assistant .msg-bubble {
    background: #1a1a1d;
    border: 1px solid #2e2e33;
    color: #ece9e4;
    width: 100%;
  }
  .msg-wrap.tool-result .msg-bubble {
    background: #131315;
    border: 1px dashed #34343a;
    width: 100%;
    color: #94a3b8;
  }
  .bubble-author {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 600;
  }
  .author-user { color: #e0a952; }
  .author-bot { color: #d97757; }
  .author-tool { color: #94a3b8; font-size: 11px; }
  .model-tag {
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 4px;
    background: #2c2420;
    color: #d97757;
    border: 1px solid rgba(217, 119, 87, 0.35);
    font-weight: 500;
  }
  .msg-content h1, .msg-content h2, .msg-content h3, .msg-content h4 {
    color: #ffffff;
    margin: 14px 0 8px 0;
    font-weight: 600;
  }
  .msg-content h1 { font-size: 17px; }
  .msg-content h2 { font-size: 15.5px; }
  .msg-content h3 {
    font-size: 14.5px;
    border-left: 3px solid #d97757;
    padding-left: 8px;
  }
  .msg-content h4 { font-size: 13.5px; }
  .msg-content p {
    margin-bottom: 10px;
  }
  .msg-content p:last-child {
    margin-bottom: 0;
  }
  .inline-code {
    background: #26262b;
    border: 1px solid #3c3c44;
    color: #fca5a5;
    padding: 1px 5px;
    border-radius: 4px;
    font-family: Consolas, 'Cascadia Code', monospace;
    font-size: 12px;
  }
  .code-filepath {
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.35);
    color: #38bdf8;
    padding: 2px 7px;
    border-radius: 5px;
    font-family: Consolas, monospace;
    font-size: 12px;
    font-weight: 500;
  }
  .code-block {
    background: #111113;
    border: 1px solid #28282e;
    border-radius: 8px;
    margin: 12px 0;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .code-header {
    background: #18181c;
    border-bottom: 1px solid #28282e;
    padding: 5px 12px;
    font-size: 11px;
    color: #9c9a95;
    font-family: Consolas, monospace;
    display: flex;
    justify-content: space-between;
  }
  .code-tag {
    color: #64748b;
    font-size: 10px;
  }
  .code-block pre {
    padding: 12px 14px;
    overflow-x: auto;
    font-family: Consolas, 'Cascadia Code', 'Fira Code', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #e2e8f0;
  }
  .tool-content {
    font-family: Consolas, monospace;
    font-size: 11.5px;
    color: #94a3b8;
    background: transparent;
    border: none;
    padding: 4px 0;
  }
  .chat-table-wrap {
    margin: 12px 0;
    overflow-x: auto;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .chat-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    background: #17171a;
    border: 1px solid #2d2d33;
    border-radius: 8px;
    overflow: hidden;
  }
  .chat-table th {
    background: #202025;
    color: #f1f5f9;
    font-weight: 600;
    padding: 8px 12px;
    border: 1px solid #2d2d33;
  }
  .chat-table td {
    padding: 7px 12px;
    border: 1px solid #28282e;
    color: #cbd5e1;
  }
  .chat-table tr:nth-child(even) {
    background: #1b1b1f;
  }
  .chat-list {
    margin: 8px 0 8px 24px;
  }
  .chat-list li {
    margin-bottom: 4px;
  }
  .chat-quote {
    border-left: 3px solid #52525b;
    padding-left: 10px;
    color: #a1a1aa;
    margin: 8px 0;
    font-style: italic;
  }
  .chat-divider {
    border: 0;
    border-top: 1px solid #2e2e33;
    margin: 14px 0;
  }
  .footer-note {
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid #28282e;
    font-size: 11px;
    color: #737373;
    text-align: center;
    page-break-inside: avoid;
    break-inside: avoid;
  }
</style>
</head>
<body>
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

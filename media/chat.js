(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const messages = $('messages');
  const input = $('input');
  const sendBtn = $('send');
  const stopBtn = $('stop');
  const statusEl = $('status');
  const metrics = $('metrics');
  const historyPanel = $('historyPanel');
  const historyList = $('historyList');
  const historyStatus = $('historyStatus');
  const commitDetail = $('commitDetail');
  const comparison = $('comparison');
  const modelPanel = $('modelPanel');
  const plusMenu = $('plusMenu');
  const approvalPanel = $('approvalPanel');
  const feedbackPanel = $('feedbackPanel');
  // The empty state is a body class so the greeting, composer and chips re-flow together.
  const empty = {
    get hidden() { return !document.body.classList.contains('empty'); },
    set hidden(value) { document.body.classList.toggle('empty', !value); }
  };

  let strings = {};
  let busy = false;
  let bubble = null; // current assistant bubble
  let bubbleText = '';
  let lastTool = null;
  let comparisonTexts = {};
  let selectedMode = 'Code';
  let attachments = [];
  let skillsLoaded = null;
  let subKind = '';
  let userName = '';
  let currentLanguage = 'auto';
  let availableLocales = {
    tr: 'Türkçe (Turkish)',
    en: 'English',
    de: 'Deutsch (German)',
    es: 'Español (Spanish)',
    fr: 'Français (French)',
    zh: '中文 (Chinese)',
    ru: 'Русский (Russian)',
    ja: '日本語 (Japanese)',
    ko: '한국어 (Korean)',
    pt: 'Português (Portuguese)',
    it: 'Italiano (Italian)',
    ar: 'العربية (Arabic)',
    nl: 'Nederlands (Dutch)',
    pl: 'Polski (Polish)',
    hi: 'हिन्दी (Hindi)',
    az: 'Azərbaycan (Azerbaijani)'
  };
  let theme = (vscode.getState() || {}).theme || 'auto';
  let autoApproveNext = false;
  let webSearchEnabled = false;
  let renderRaf = 0;
  let compareRaf = 0;
  const metricHistory = [];

  function flushBubbleRender() {
    if (renderRaf) {
      cancelAnimationFrame(renderRaf);
      renderRaf = 0;
    }
    if (bubble) {
      bubble.innerHTML = render(bubbleText);
      scrollDown();
    }
  }

  const s = (key) => strings[key] || '';

  function applyStrings() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = s(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = s(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = s(el.dataset.i18nTitle);
    });
    if (busy) statusEl.textContent = s('ui.working');
    updateGreeting();
    setMode(selectedMode);
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function replaceLatexMath(str) {
    if (!str) return '';
    // 1. LaTeX arrows (handles $, $$, \, \\, and surrounded or standalone)
    str = str.replace(/\$?\s*\\+(leftrightarrow|Leftrightarrow)\s*\$?|\\+(leftrightarrow|Leftrightarrow)/g, '↔');
    str = str.replace(/\$?\s*\\+(rightarrow|to(?![a-zA-Z]))\s*\$?|\\+(rightarrow|to(?![a-zA-Z]))/g, '→');
    str = str.replace(/\$?\s*\\+(leftarrow|gets(?![a-zA-Z]))\s*\$?|\\+(leftarrow|gets(?![a-zA-Z]))/g, '←');
    str = str.replace(/\$?\s*\\+(Rightarrow)\s*\$?|\\+(Rightarrow)/g, '⇒');
    str = str.replace(/\$?\s*\\+(Leftarrow)\s*\$?|\\+(Leftarrow)/g, '⇐');
    str = str.replace(/\$?\s*\\+(uparrow)\s*\$?|\\+(uparrow)/g, '↑');
    str = str.replace(/\$?\s*\\+(downarrow)\s*\$?|\\+(downarrow)/g, '↓');
    str = str.replace(/\$?\s*\\+(nearrow)\s*\$?|\\+(nearrow)/g, '↗');
    str = str.replace(/\$?\s*\\+(searrow)\s*\$?|\\+(searrow)/g, '↘');
    str = str.replace(/\$?\s*\\+(mapsto)\s*\$?|\\+(mapsto)/g, '↦');

    // 2. Math comparison & operations
    str = str.replace(/\$?\s*\\+(leq|le(?![a-zA-Z]))\s*\$?|\\+(leq|le(?![a-zA-Z]))/g, '≤');
    str = str.replace(/\$?\s*\\+(geq|ge(?![a-zA-Z]))\s*\$?|\\+(geq|ge(?![a-zA-Z]))/g, '≥');
    str = str.replace(/\$?\s*\\+(neq|ne(?![a-zA-Z]))\s*\$?|\\+(neq|ne(?![a-zA-Z]))/g, '≠');
    str = str.replace(/\$?\s*\\+(approx)\s*\$?|\\+(approx)/g, '≈');
    str = str.replace(/\$?\s*\\+(equiv)\s*\$?|\\+(equiv)/g, '≡');
    str = str.replace(/\$?\s*\\+(times)\s*\$?|\\+(times)/g, '×');
    str = str.replace(/\$?\s*\\+(div)\s*\$?|\\+(div)/g, '÷');
    str = str.replace(/\$?\s*\\+(pm)\s*\$?|\\+(pm)/g, '±');
    str = str.replace(/\$?\s*\\+(mp)\s*\$?|\\+(mp)/g, '∓');
    str = str.replace(/\$?\s*\\+(cdot)\s*\$?|\\+(cdot)/g, '·');
    str = str.replace(/\$?\s*\\+(in(?![a-zA-Z]))\s*\$?|\\+(in(?![a-zA-Z]))/g, '∈');
    str = str.replace(/\$?\s*\\+(notin)\s*\$?|\\+(notin)/g, '∉');
    str = str.replace(/\$?\s*\\+(subseteq)\s*\$?|\\+(subseteq)/g, '⊆');
    str = str.replace(/\$?\s*\\+(subset(?![a-zA-Z]))\s*\$?|\\+(subset(?![a-zA-Z]))/g, '⊂');
    str = str.replace(/\$?\s*\\+(forall)\s*\$?|\\+(forall)/g, '∀');
    str = str.replace(/\$?\s*\\+(exists)\s*\$?|\\+(exists)/g, '∃');
    str = str.replace(/\$?\s*\\+(infty)\s*\$?|\\+(infty)/g, '∞');
    str = str.replace(/\$?\s*\\+(sum)\s*\$?|\\+(sum)/g, '∑');
    str = str.replace(/\$?\s*\\+(prod)\s*\$?|\\+(prod)/g, '∏');
    str = str.replace(/\$?\s*\\+(sqrt)\s*\$?|\\+(sqrt)/g, '√');

    // 3. Clean $ delimiters around arrows and simple inline math
    str = str.replace(/\$\s*([→←↔⇒⇐⇔↦↑↓↗↘≤≥≠≈≡×÷±∓·∈∉⊆⊂∀∃∞∑∏√\s]+)\s*\$/g, '$1');

    // 4. Any remaining $inline math$ rendered cleanly
    str = str.replace(/\$([^\$\n]+)\$/g, (m, content) => {
      const trimmed = content.trim();
      return '<span class="chat-math">' + escapeHtml(trimmed) + '</span>';
    });

    return str;
  }

  function isFilePath(str) {
    if (!str || str.length > 150 || /\s/.test(str)) return false;
    if (str.includes('(') || str.includes(')') || str.includes('{') || str.includes('}') || str.startsWith('http://') || str.startsWith('https://')) return false;

    const hasKnownExt = /\.(ts|tsx|js|jsx|json|py|html|css|scss|md|rs|go|java|c|cpp|h|hpp|sh|bat|cmd|yml|yaml|toml|sql|svg|png|jpg|ico|vue|svelte|rb|php|xml|env|lock|wasm|map|txt|graphql)$/i.test(str);
    const hasSlash = /[/\\]/.test(str);
    const isSpecial = /^(dockerfile|makefile|license|readme|changelog|\.gitignore|\.env(\.[a-z0-9_-]+)?|\.eslintrc|\.prettierrc)$/i.test(str);
    const isDirPath = hasSlash && (str.endsWith('/') || str.endsWith('\\'));

    if (hasKnownExt) return true;
    if (isSpecial) return true;
    if (isDirPath) return true;
    if (hasSlash && /^(\.\/|\.\.\/|src\/|lib\/|media\/|test\/|tests\/|app\/|dist\/|build\/|packages\/)/i.test(str)) return true;

    return false;
  }

  function renderInline(rawText) {
    if (!rawText) return '';
    // 1. Extract inline code spans to preserve literal content
    const codeSpans = [];
    let s = rawText.replace(/`([^`\n]+)`/g, (match, code) => {
      const idx = codeSpans.length;
      codeSpans.push(code);
      return '___CODESPAN_' + idx + '___';
    });

    // 2. LaTeX arrows and math
    s = replaceLatexMath(s);

    // 3. Escape HTML
    s = escapeHtml(s);

    // 4. Bold: **text**
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

    // 5. Italic: *text* or _text_
    s = s.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3');
    s = s.replace(/(^|[^_])_([^_\n]+)_([^_]|$)/g, '$1<em>$2</em>$3');

    // 6. Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 7. Auto-detect standalone file paths in plain text (so user easily notices them in color)
    s = s.replace(/(^|[\s(,;:[])((?:[\w.-]+[/\\])+[\w.-]+\.(?:ts|tsx|js|jsx|json|py|html|css|scss|md|rs|go|java|c|cpp|h|hpp|sh|bat|cmd|yml|yaml|toml|sql|svg|png|jpg|ico|vue|svelte|rb|php|xml|env|lock)|[\w.-]+\.(?:ts|tsx|js|jsx|json|py|html|css|scss|rs|go|java|sql|vue|svelte|md))(?=[\s),;:\]]|$)/g, (match, prefix, filepath) => {
      const isDir = filepath.endsWith('/') || filepath.endsWith('\\');
      const icon = isDir ? '📁' : '📄';
      return prefix + '<code class="code-filepath' + (isDir ? ' code-dirpath' : '') + '" data-filepath="' + escapeHtml(filepath) + '" title="Dosyayı aç: ' + escapeHtml(filepath) + '"><span class="filepath-icon">' + icon + '</span><span class="filepath-name">' + escapeHtml(filepath) + '</span></code>';
    });

    // 8. Restore inline code spans with file path badge styling
    s = s.replace(/___CODESPAN_(\d+)___/g, (match, idx) => {
      const code = codeSpans[Number(idx)];
      const trimmed = (code || '').trim();
      if (isFilePath(trimmed)) {
        const isDir = trimmed.endsWith('/') || trimmed.endsWith('\\');
        const icon = isDir ? '📁' : '📄';
        return '<code class="code-filepath' + (isDir ? ' code-dirpath' : '') + '" data-filepath="' + escapeHtml(trimmed) + '" title="Dosyayı aç: ' + escapeHtml(trimmed) + '"><span class="filepath-icon">' + icon + '</span><span class="filepath-name">' + escapeHtml(trimmed) + '</span></code>';
      }
      return '<code>' + escapeHtml(code) + '</code>';
    });

    return s;
  }

  function parseTableLine(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function isTableSeparator(line) {
    const parts = parseTableLine(line);
    return parts.length > 0 && parts.every((p) => /^:?-{2,}:?$/.test(p));
  }

  function renderMarkdownBlock(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        out.push('');
        i++;
        continue;
      }

      // 1. Table check
      if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const headerCells = parseTableLine(trimmed);
        const sepCells = parseTableLine(lines[i + 1]);
        const alignments = sepCells.map((c) => {
          const l = c.startsWith(':');
          const r = c.endsWith(':');
          if (l && r) return 'center';
          if (r) return 'right';
          return 'left';
        });

        let tableHtml = '<div class="chat-table-wrap"><table class="chat-table"><thead><tr>';
        headerCells.forEach((c, idx) => {
          const align = alignments[idx] || 'left';
          tableHtml += '<th style="text-align:' + align + '">' + renderInline(c) + '</th>';
        });
        tableHtml += '</tr></thead><tbody>';

        i += 2;
        while (i < lines.length && lines[i].trim().includes('|')) {
          const rowLine = lines[i].trim();
          if (!rowLine || isTableSeparator(rowLine)) {
            i++;
            continue;
          }
          const cells = parseTableLine(rowLine);
          tableHtml += '<tr>';
          headerCells.forEach((_, idx) => {
            const align = alignments[idx] || 'left';
            const cellVal = cells[idx] !== undefined ? cells[idx] : '';
            tableHtml += '<td style="text-align:' + align + '">' + renderInline(cellVal) + '</td>';
          });
          tableHtml += '</tr>';
          i++;
        }
        tableHtml += '</tbody></table></div>';
        out.push(tableHtml);
        continue;
      }

      // 2. Headings: # through ######
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const lvl = headingMatch[1].length;
        const hContent = renderInline(headingMatch[2]);
        out.push('<h' + lvl + '>' + hContent + '</h' + lvl + '>');
        i++;
        continue;
      }

      // 3. Blockquote: > ...
      if (trimmed.startsWith('>')) {
        const quoteLines = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote class="chat-quote">' + quoteLines.map(renderInline).join('<br>') + '</blockquote>');
        continue;
      }

      // 4. Bullet list: * , - , +
      if (/^[*+-]\s+/.test(trimmed)) {
        let listHtml = '<ul class="chat-list">';
        while (i < lines.length) {
          const itemMatch = lines[i].trim().match(/^[*+-]\s+(.+)$/);
          if (!itemMatch) break;
          listHtml += '<li>' + renderInline(itemMatch[1]) + '</li>';
          i++;
        }
        listHtml += '</ul>';
        out.push(listHtml);
        continue;
      }

      // 5. Numbered list: 1. , 2.
      if (/^\d+\.\s+/.test(trimmed)) {
        let listHtml = '<ol class="chat-list">';
        while (i < lines.length) {
          const itemMatch = lines[i].trim().match(/^\d+\.\s+(.+)$/);
          if (!itemMatch) break;
          listHtml += '<li>' + renderInline(itemMatch[1]) + '</li>';
          i++;
        }
        listHtml += '</ol>';
        out.push(listHtml);
        continue;
      }

      // 6. Horizontal rule: --- or *** or ___
      if (/^(---|---|\*\*\*|___)\s*$/.test(trimmed)) {
        out.push('<hr class="chat-divider">');
        i++;
        continue;
      }

      // 7. Regular paragraph line
      out.push(renderInline(trimmed));
      i++;
    }

    // Join pieces sensibly
    let result = '';
    for (let k = 0; k < out.length; k++) {
      const cur = out[k];
      if (!cur) {
        if (result && !result.endsWith('</div>') && !result.endsWith('</ul>') && !result.endsWith('</ol>') && !result.endsWith('</blockquote>') && !/<\/h[1-6]>$/.test(result) && !result.endsWith('<br>')) {
          result += '<br>';
        }
        continue;
      }
      const isCurBlock = cur.startsWith('<h') || cur.startsWith('<div class="chat-table') || cur.startsWith('<ul') || cur.startsWith('<ol') || cur.startsWith('<blockquote') || cur.startsWith('<hr');
      if (result) {
        const prevEndsWithBlock = result.endsWith('</div>') || result.endsWith('</ul>') || result.endsWith('</ol>') || result.endsWith('</blockquote>') || /<\/h[1-6]>$/.test(result) || result.endsWith('<hr class="chat-divider">');
        if (prevEndsWithBlock || isCurBlock) {
          result += '\n' + cur;
        } else {
          result += '<br>' + cur;
        }
      } else {
        result = cur;
      }
    }
    return result;
  }

  const TOOL_NAMES_RE = 'list_files|read_file|write_file|replace_in_file|search_files|get_editor_context|run_command|mcp_call|web_search|browser_action|code_graph|run_tests|craft_anything';

  const TOOL_ICON_MAP = {
    list_files: 'folder',
    read_file: 'file',
    write_file: 'pencil',
    replace_in_file: 'pencil',
    search_files: 'search',
    run_command: 'terminal',
    mcp_call: 'plug',
    get_editor_context: 'code',
    web_search: 'globe',
    browser_action: 'monitor',
    code_graph: 'graph',
    run_tests: 'terminal',
    craft_anything: 'sparkles'
  };

  function stripToolXml(text) {
    if (!text) return '';
    let clean = text.replace(new RegExp('<(' + TOOL_NAMES_RE + ')(?:\\s+[^>]*)?>[\\s\\S]*?<\\/\\1>', 'gi'), '');
    clean = clean.replace(new RegExp('<(' + TOOL_NAMES_RE + ')(?:\\s+[^>]*)?\\s*\\/>', 'gi'), '');
    clean = clean.replace(new RegExp('<\\/?(' + TOOL_NAMES_RE + ')(?:\\s+[^>]*)?\\/?>', 'gi'), '');
    clean = clean.replace(/<\/?(?:path|file|filepath|old_text|new_text|content|command|cmd|query|pattern|replace_all|action|target|selector|server|arguments|stack|prompt|mode|candidate)>/gi, '');
    return clean.trim();
  }

  function extractToolTarget(name, body, attrs) {
    if (name === 'craft_anything') {
      const act = (body && body.match(/<action>([\s\S]*?)<\/action>/i))?.[1]?.trim() || '';
      const tgt = (body && body.match(/<target>([\s\S]*?)<\/target>/i))?.[1]?.trim() || '';
      const prompt = (body && body.match(/<prompt>([\s\S]*?)<\/prompt>/i))?.[1]?.trim() || '';
      const summary = `${act} ${tgt || prompt}`.trim();
      return summary.length > 55 ? summary.slice(0, 52) + '...' : summary;
    }

    const pathMatch = (body && body.match(/<(?:path|file|filepath|target)>([\s\S]*?)<\/(?:path|file|filepath|target)>/i))
      || (attrs && attrs.match(/\b(?:path|file|target)=["']([^"']+)["']/i));
    if (pathMatch) return pathMatch[1].trim();

    const cmdMatch = (body && body.match(/<(?:command|cmd)>([\s\S]*?)<\/(?:command|cmd)>/i))
      || (attrs && attrs.match(/\b(?:command|cmd)=["']([^"']+)["']/i));
    if (cmdMatch) {
      const c = cmdMatch[1].trim().split('\n')[0].trim();
      return c.length > 50 ? c.slice(0, 48) + '...' : c;
    }

    const queryMatch = (body && body.match(/<(?:query|pattern)>([\s\S]*?)<\/(?:query|pattern)>/i))
      || (attrs && attrs.match(/\b(?:query|pattern)=["']([^"']+)["']/i));
    if (queryMatch) {
      const q = queryMatch[1].trim().split('\n')[0].trim();
      return q.length > 50 ? q.slice(0, 48) + '...' : q;
    }

    if (name === 'mcp_call') {
      const server = (body && body.match(/<server>([\s\S]*?)<\/server>/i))?.[1]?.trim() || '';
      const tool = (body && body.match(/<tool>([\s\S]*?)<\/tool>/i))?.[1]?.trim() || '';
      if (server || tool) return (server + '/' + tool).trim();
    }

    if (body) {
      const trimmed = body.trim();
      if (!trimmed.startsWith('<')) {
        const line = trimmed.split('\n')[0].trim();
        return line.length > 50 ? line.slice(0, 48) + '...' : line;
      }
    }
    return '';
  }

  function createToolCard(toolName, toolArg, ok, outputText) {
    const card = document.createElement('details');
    card.className = 'msg tool ' + (ok ? 'succeeded' : 'failed');
    card.dataset.tool = toolName;
    card.open = false;

    const summary = document.createElement('summary');
    summary.className = 'tool-summary';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'tool-icon';
    iconWrap.innerHTML = icon(TOOL_ICON_MAP[toolName] || 'code', 14);
    summary.appendChild(iconWrap);

    const badge = document.createElement('span');
    badge.className = 'tool-badge';
    badge.textContent = toolName;
    summary.appendChild(badge);

    if (toolArg) {
      const target = document.createElement('code');
      target.className = 'tool-target';
      target.textContent = toolArg;
      summary.appendChild(target);
    }

    const meta = document.createElement('span');
    meta.className = 'tool-meta';
    const status = document.createElement('span');
    status.className = 'tool-status';
    status.textContent = ok ? '✓' : '✕';
    meta.appendChild(status);

    const chev = document.createElement('span');
    chev.className = 'tool-chevron';
    chev.innerHTML = icon('chevronRight', 14);
    meta.appendChild(chev);
    summary.appendChild(meta);
    card.appendChild(summary);

    if (outputText !== undefined && outputText !== null && outputText !== '') {
      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'tool-body';
      if (toolName === 'list_files' && ok && outputText.trim() !== '(empty)') {
        const entries = outputText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        status.textContent = entries.length + ' ✓';
        const grid = document.createElement('div');
        grid.className = 'tool-file-grid';
        entries.forEach((entry) => {
          const isDir = entry.endsWith('/');
          const chip = document.createElement('span');
          chip.className = 'tool-file-chip' + (isDir ? ' is-dir' : '');
          const chipIcon = document.createElement('span');
          chipIcon.className = 'tool-file-icon';
          chipIcon.innerHTML = icon(isDir ? 'folder' : 'file', 13);
          const chipName = document.createElement('span');
          chipName.className = 'tool-file-name';
          chipName.textContent = entry;
          chip.appendChild(chipIcon);
          chip.appendChild(chipName);
          grid.appendChild(chip);
        });
        bodyWrap.appendChild(grid);
      } else {
        const pre = document.createElement('pre');
        pre.className = 'tool-output';
        pre.textContent = outputText;
        bodyWrap.appendChild(pre);
      }
      card.appendChild(bodyWrap);
    }

    return card;
  }

  function renderAssistantRestored(content) {
    if (!content) return;
    const re = new RegExp('<(' + TOOL_NAMES_RE + ')(?:\\s+([^>]*?))?>([\\s\\S]*?)<\\/\\1>|<(' + TOOL_NAMES_RE + ')(?:\\s+([^>]*?))?\\s*\\/>', 'gi');
    let lastIndex = 0;
    let match;
    let foundTools = false;

    while ((match = re.exec(content)) !== null) {
      foundTools = true;
      const textBefore = content.slice(lastIndex, match.index).trim();
      const cleanText = stripToolXml(textBefore);
      if (cleanText) {
        const el = document.createElement('div');
        el.className = 'msg assistant';
        el.innerHTML = render(cleanText);
        messages.appendChild(el);
      }

      const name = (match[1] || match[4] || '').toLowerCase();
      const attrs = match[2] || match[5] || '';
      const body = match[3] || '';
      const target = extractToolTarget(name, body, attrs);

      const card = createToolCard(name, target, true, null);
      messages.appendChild(card);

      lastIndex = match.index + match[0].length;
    }

    if (foundTools) {
      const textAfter = content.slice(lastIndex).trim();
      const cleanAfter = stripToolXml(textAfter);
      if (cleanAfter) {
        const el = document.createElement('div');
        el.className = 'msg assistant';
        el.innerHTML = render(cleanAfter);
        messages.appendChild(el);
      }
    } else {
      const clean = stripToolXml(content);
      if (clean) {
        const el = document.createElement('div');
        el.className = 'msg assistant';
        el.innerHTML = render(clean);
        messages.appendChild(el);
      }
    }
  }

  function renderRestoredConversation(msgList) {
    if (!Array.isArray(msgList)) return;
    for (let i = 0; i < msgList.length; i++) {
      const message = msgList[i];
      if (!message || !message.content) continue;

      if (message.role === 'user') {
        const toolResMatch = message.content.match(/^\[([a-zA-Z0-9_]+)\s+(result|error)\]\s*([\s\S]*)$/i);
        if (toolResMatch) {
          const toolName = toolResMatch[1];
          const isOk = toolResMatch[2].toLowerCase() === 'result';
          const output = (toolResMatch[3] || '').trim();

          const lastEl = messages.lastElementChild;
          if (lastEl && lastEl.classList.contains('tool') && !lastEl.dataset.hasResult) {
            lastEl.classList.remove('running', 'succeeded', 'failed');
            lastEl.classList.add(isOk ? 'succeeded' : 'failed');
            const status = lastEl.querySelector('.tool-status');
            if (status) status.textContent = isOk ? '✓' : '✕';
            if (output) {
              const bodyWrap = document.createElement('div');
              bodyWrap.className = 'tool-body';
              if (toolName === 'list_files' && isOk && output !== '(empty)') {
                const entries = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
                if (status) status.textContent = entries.length + ' ✓';
                const grid = document.createElement('div');
                grid.className = 'tool-file-grid';
                entries.forEach((entry) => {
                  const isDir = entry.endsWith('/');
                  const chip = document.createElement('span');
                  chip.className = 'tool-file-chip' + (isDir ? ' is-dir' : '');
                  const chipIcon = document.createElement('span');
                  chipIcon.className = 'tool-file-icon';
                  chipIcon.innerHTML = icon(isDir ? 'folder' : 'file', 13);
                  const chipName = document.createElement('span');
                  chipName.className = 'tool-file-name';
                  chipName.textContent = entry;
                  chip.appendChild(chipIcon);
                  chip.appendChild(chipName);
                  grid.appendChild(chip);
                });
                bodyWrap.appendChild(grid);
              } else {
                const pre = document.createElement('pre');
                pre.className = 'tool-output';
                pre.textContent = output;
                bodyWrap.appendChild(pre);
              }
              lastEl.appendChild(bodyWrap);
            }
            lastEl.dataset.hasResult = 'true';
          } else {
            const card = createToolCard(toolName, '', isOk, output);
            card.dataset.hasResult = 'true';
            messages.appendChild(card);
          }
        } else {
          add('user', message.content);
        }
      } else if (message.role === 'assistant') {
        renderAssistantRestored(message.content);
      }
    }
  }

  function renderChatSessions(sessions, activeId) {
    const listEl = $('chatSessionsList');
    const statusEl = $('chatSessionsStatus');
    if (!listEl) return;
    listEl.replaceChildren();

    if (!sessions || !sessions.length) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = s('ui.noPastChats') || 'Henüz geçmiş sohbet yok';
      }
      return;
    }
    if (statusEl) statusEl.hidden = true;

    sessions.forEach((sObj) => {
      const card = document.createElement('div');
      card.className = 'chat-session-card' + (sObj.isActive ? ' active' : '');

      const info = document.createElement('div');
      info.className = 'chat-session-info';

      const title = document.createElement('div');
      title.className = 'chat-session-title';
      title.textContent = sObj.title || s('ui.newChat') || 'Sohbet';

      const meta = document.createElement('div');
      meta.className = 'chat-session-meta';

      const dateSpan = document.createElement('span');
      dateSpan.textContent = sObj.date || '';
      meta.appendChild(dateSpan);

      if (sObj.count) {
        const countSpan = document.createElement('span');
        countSpan.textContent = sObj.count + ' msg';
        meta.appendChild(countSpan);
      }

      if (sObj.model) {
        const modelSpan = document.createElement('span');
        modelSpan.textContent = sObj.model;
        meta.appendChild(modelSpan);
      }

      if (sObj.isActive) {
        const badge = document.createElement('span');
        badge.className = 'chat-session-badge';
        badge.textContent = s('ui.activeChat') || 'Aktif';
        meta.appendChild(badge);
      }

      info.append(title, meta);
      card.appendChild(info);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'chat-session-delete';
      delBtn.title = s('ui.deleteChat') || 'Sohbeti Sil';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'deleteChatSession', id: sObj.id });
      });
      card.appendChild(delBtn);

      card.addEventListener('click', () => {
        vscode.postMessage({ type: 'loadChatSession', id: sObj.id });
        showHistory(false);
      });

      listEl.appendChild(card);
    });
  }

  // Safe rendering: code fences, tables, headers, lists, blockquotes, file paths, latex arrows & math.
  function render(text) {
    if (!text) return '';
    text = stripToolXml(text);
    if (!text) return '';
    return text
      .split('```')
      .map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf('\n');
          const lang = (nl >= 0 ? part.slice(0, nl) : '').trim().replace(/[^a-zA-Z0-9_+#.-]/g, '');
          const code = nl >= 0 ? part.slice(nl + 1) : part;
          const copyLbl = escapeHtml(s('ui.copyCode') || 'Copy');
          const insertLbl = escapeHtml(s('ui.insertCode') || 'Insert');
          const runLbl = escapeHtml(s('ui.runCode') || 'Run');
          return (
            '<div class="code-block" data-lang="' + escapeHtml(lang) + '">' +
              '<div class="code-header">' +
                '<span class="code-lang">' + escapeHtml(lang || 'code') + '</span>' +
                '<div class="code-actions">' +
                  '<button type="button" class="code-btn" data-action="copy" data-i18n="ui.copyCode">' + copyLbl + '</button>' +
                  '<button type="button" class="code-btn" data-action="insert" data-i18n="ui.insertCode">' + insertLbl + '</button>' +
                  '<button type="button" class="code-btn code-btn-run" data-action="run" data-i18n="ui.runCode">▶ ' + runLbl + '</button>' +
                '</div>' +
              '</div>' +
              '<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>' +
            '</div>'
          );
        }
        return renderMarkdownBlock(part);
      })
      .join('');
  }

  document.addEventListener('click', (e) => {
    const fileBadge = e.target.closest('.code-filepath');
    if (fileBadge && fileBadge.dataset.filepath) {
      vscode.postMessage({ type: 'openFile', file: fileBadge.dataset.filepath });
      return;
    }
    const btn = e.target.closest('.code-btn');
    if (!btn) return;
    const block = btn.closest('.code-block');
    const codeEl = block && block.querySelector('pre > code');
    if (!codeEl) return;
    const code = codeEl.textContent || '';
    const lang = block.dataset.lang || '';
    const action = btn.dataset.action;
    if (action === 'copy') {
      vscode.postMessage({ type: 'copyText', text: code });
      const orig = btn.textContent;
      btn.textContent = '✓ ' + (s('ui.emailCopied') || 'Copied!');
      setTimeout(() => { btn.textContent = s('ui.copyCode') || orig; }, 1600);
    } else if (action === 'insert') {
      vscode.postMessage({ type: 'insertCode', code, lang });
    } else if (action === 'run') {
      vscode.postMessage({ type: 'runCode', code, lang });
    }
  });

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }

  function add(className, text) {
    empty.hidden = true;
    const el = document.createElement('div');
    el.className = 'msg ' + className;
    el.textContent = text;
    messages.appendChild(el);
    scrollDown();
    return el;
  }

  function setBusy(value) {
    busy = value;
    sendBtn.hidden = value;
    stopBtn.hidden = !value;
    statusEl.textContent = value ? s('ui.working') : '';
  }

  function formatDuration(ms) {
    return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s';
  }

  function renderTrend() {
    const recent = metricHistory.slice(-12);
    if (!recent.length) return;
    const maxSpeed = Math.max(...recent.map((item) => item.speed), 1);
    const maxDuration = Math.max(...recent.map((item) => item.duration), 1);
    const points = (items, max) => items.map((value, index) => {
      const x = recent.length === 1 ? 160 : 8 + index * (304 / (recent.length - 1));
      const y = 60 - (value / max) * 48;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    $('speedLine').setAttribute('points', points(recent.map((item) => item.speed), maxSpeed));
    $('durationLine').setAttribute('points', points(recent.map((item) => item.duration), maxDuration));
    const latest = recent[recent.length - 1];
    $('trendSummary').textContent = latest.speed.toFixed(1) + ' tok/s · ' + formatDuration(latest.duration);
  }

  function showHistory(open) {
    historyPanel.hidden = !open;
    $('historyToggle').setAttribute('aria-expanded', String(open));
    if (open) {
      vscode.postMessage({ type: 'getChatSessions' });
      if (historyStatus) historyStatus.textContent = s('ui.loadingHistory');
      if (historyList) historyList.replaceChildren();
      if (commitDetail) commitDetail.hidden = true;
      vscode.postMessage({ type: 'history' });
    }
  }

  function renderHistory(commits, error) {
    historyList.replaceChildren();
    if (error) {
      historyStatus.textContent = error;
      return;
    }
    if (!commits.length) {
      historyStatus.textContent = s('ui.noHistory');
      return;
    }
    historyStatus.textContent = s('ui.historyHint');
    commits.forEach((commit) => {
      const item = document.createElement('button');
      item.className = 'commit-item';
      item.type = 'button';
      const title = document.createElement('strong');
      title.textContent = commit.subject;
      const meta = document.createElement('span');
      meta.textContent = commit.shortHash + ' · ' + commit.date + ' · ' + commit.author;
      item.append(title, meta);
      item.addEventListener('click', () => vscode.postMessage({ type: 'showCommit', hash: commit.hash }));
      historyList.appendChild(item);
    });
  }

  function updateSend() {
    sendBtn.disabled = !input.value.trim();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }

  function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    const bubbleEl = add('user', text);
    if (attachments.length) {
      const files = document.createElement('div');
      files.className = 'user-files';
      files.textContent = attachments.map((a) => a.name).join(', ');
      bubbleEl.appendChild(files);
    }
    const blocks = attachments
      .map((a) => '\n\n' + a.name + ':\n```' + a.language + '\n' + a.content + '\n```')
      .join('');
    input.value = '';
    attachments = [];
    renderAttachments();
    autosize();
    updateSend();
    vscode.postMessage({ type: 'send', text: text + blocks, mode: selectedMode, webSearch: webSearchEnabled });
  }

  // Opens upward by default; flips below the composer when there is no room above (e.g. the centred empty state).
  function placePopover(panel) {
    panel.classList.remove('drop-down');
    panel.style.maxHeight = '';
    const wrap = panel.parentElement.getBoundingClientRect();
    const above = wrap.top - 12;
    const below = window.innerHeight - wrap.bottom - 12;
    const needed = panel.scrollHeight + 2;
    const down = needed > above && below > above;
    panel.classList.toggle('drop-down', down);
    panel.style.maxHeight = Math.max(140, down ? below : above) + 'px';
  }

  function closePopovers(except) {
    [modelPanel, plusMenu, approvalPanel, feedbackPanel].forEach((panel) => {
      if (panel && panel !== except) panel.hidden = true;
    });
    $('plus').setAttribute('aria-expanded', String(!plusMenu.hidden));
    $('model').setAttribute('aria-expanded', String(!modelPanel.hidden));
    if ($('feedbackToggle')) {
      $('feedbackToggle').setAttribute('aria-expanded', String(!feedbackPanel.hidden));
    }
  }

  function renderModelOptions(models, selected, error) {
    const list = $('modelOptions');
    list.replaceChildren();
    if (error) {
      const message = document.createElement('p');
      message.className = 'popover-error';
      message.textContent = error;
      list.appendChild(message);
      return;
    }
    models.forEach((model) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'model-option' + (model === selected ? ' selected' : '');
      option.textContent = model;
      option.addEventListener('click', () => {
        vscode.postMessage({ type: 'modelPick', model });
        modelPanel.hidden = true;
      });
      list.appendChild(option);
    });
    if (!models.length) {
      const empty = document.createElement('p');
      empty.className = 'popover-error';
      empty.textContent = s('ui.noModels');
      list.appendChild(empty);
    }
  }

  // ---- Icons (inline, stroke-based) ----
  const ICONS = {
    plus: '<path d="M5 12h14M12 5v14"/>',
    arrowUp: '<path d="m5 12 7-7 7 7M12 19V5"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    layers: '<path d="m12 2 9 4.5-9 4.5-9-4.5L12 2Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 17 9 4.5 9-4.5"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/>',
    blocks: '<rect x="14" y="3" width="7" height="7" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".6" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".6" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".6" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.43-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2Z"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    history: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    cap: '<path d="M21.4 10.9a1 1 0 0 0 0-1.8L12.8 5.2a2 2 0 0 0-1.6 0L2.6 9.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0Z"/><path d="M22 10v6M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    pencil: '<path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5Z"/><path d="m15 5 4 4"/>',
    bug: '<path d="m8 2 1.9 1.9M14.1 3.9 16 2M9 7.1v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6ZM12 20v-9M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
    list: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/><path d="M10 12h-1v4h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1z"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    graph: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="8.7" y1="7.4" x2="15.3" y2="6"/><line x1="7.3" y1="8.7" x2="10.7" y2="15.3"/><line x1="16.7" y1="8.7" x2="13.3" y2="15.3"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
  };

  function icon(name, size) {
    const px = size || 16;
    return '<svg class="icon" viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  function hydrateIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => {
      if (!el.querySelector(':scope > svg.icon')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    });
  }

  // ---- Greeting, mode, theme ----
  function updateGreeting() {
    const hour = new Date().getHours();
    const key = hour >= 5 && hour < 12 ? 'ui.greetingMorning' : hour >= 12 && hour < 18 ? 'ui.greetingAfternoon' : 'ui.greetingEvening';
    const base = s(key);
    $('greeting').textContent = userName ? base + ', ' + userName : base;
  }

  function setMode(mode) {
    selectedMode = mode;
    const chat = $('segChat');
    const agent = $('segAgent');
    chat.classList.toggle('active', mode === 'Ask');
    agent.classList.toggle('active', mode === 'Code');
    chat.setAttribute('aria-pressed', String(mode === 'Ask'));
    agent.setAttribute('aria-pressed', String(mode === 'Code'));
    // Debug and Plan have no segment, so they show as a removable chip above the input.
    renderAttachments();
  }

  function applyTheme() {
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme === 'light');
  }

  function setTheme(value) {
    theme = value;
    applyTheme();
    vscode.setState({ ...(vscode.getState() || {}), theme });
  }

  function setWebSearch(value) {
    webSearchEnabled = Boolean(value);
    const btn = $('webSearchToggle');
    if (btn) {
      btn.classList.toggle('active', webSearchEnabled);
      btn.setAttribute('aria-pressed', String(webSearchEnabled));
    }
    renderAttachments();
  }

  // ---- Attachments ----
  function renderAttachments() {
    const box = $('attachments');
    box.replaceChildren();
    const extraMode = selectedMode !== 'Ask' && selectedMode !== 'Code';
    box.hidden = attachments.length === 0 && !extraMode && !webSearchEnabled;
    if (webSearchEnabled) {
      const chip = document.createElement('span');
      chip.className = 'attachment mode-chip web-chip';
      chip.insertAdjacentHTML('beforeend', icon('globe', 13));
      const name = document.createElement('span');
      name.textContent = s('ui.webSearch') || s('ui.menuWebSearch') || 'Web Search';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = s('ui.removeAttachment');
      remove.setAttribute('aria-label', s('ui.removeAttachment'));
      remove.innerHTML = icon('x', 12);
      remove.addEventListener('click', () => setWebSearch(false));
      chip.append(name, remove);
      box.appendChild(chip);
    }
    if (extraMode) {
      const chip = document.createElement('span');
      chip.className = 'attachment mode-chip';
      chip.insertAdjacentHTML('beforeend', icon(selectedMode === 'Debug' ? 'bug' : 'list', 13));
      const name = document.createElement('span');
      name.textContent = selectedMode === 'Debug' ? s('ui.chipDebug') : s('ui.chipPlan');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = s('ui.removeAttachment');
      remove.setAttribute('aria-label', s('ui.removeAttachment'));
      remove.innerHTML = icon('x', 12);
      remove.addEventListener('click', () => setMode('Code'));
      chip.append(name, remove);
      box.appendChild(chip);
    }
    attachments.forEach((item, index) => {
      const chip = document.createElement('span');
      chip.className = 'attachment';
      const name = document.createElement('span');
      name.textContent = item.name;
      name.title = item.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = s('ui.removeAttachment');
      remove.setAttribute('aria-label', s('ui.removeAttachment'));
      remove.innerHTML = icon('x', 12);
      remove.addEventListener('click', () => {
        attachments.splice(index, 1);
        renderAttachments();
      });
      chip.append(name, remove);
      box.appendChild(chip);
    });
  }

  // ---- "+" menu ----
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘U' : 'Ctrl+U';

  function menuRow(opts) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'menu-item';
    row.setAttribute('role', 'menuitem');
    if (opts.icon) row.insertAdjacentHTML('beforeend', icon(opts.icon));
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = opts.label;
    row.appendChild(label);
    if (opts.badge) {
      const badge = document.createElement('span');
      badge.className = 'menu-badge';
      badge.textContent = opts.badge;
      row.appendChild(badge);
    }
    if (opts.end === 'chevron' || opts.end === 'check') {
      const end = document.createElement('span');
      end.className = 'menu-end' + (opts.end === 'check' ? ' checked' : '');
      end.innerHTML = icon(opts.end === 'check' ? 'check' : 'chevronRight', opts.end === 'check' ? 16 : 14);
      row.appendChild(end);
    } else if (opts.end) {
      const end = document.createElement('span');
      end.className = 'menu-end';
      end.textContent = opts.end;
      row.appendChild(end);
    }
    if (opts.disabled) row.disabled = true;
    else row.addEventListener('click', opts.onClick);
    return row;
  }

  function menuSep() {
    const sep = document.createElement('div');
    sep.className = 'menu-sep';
    sep.setAttribute('role', 'separator');
    return sep;
  }

  function showPlusMain() {
    subKind = '';
    const main = $('plusMain');
    main.replaceChildren(
      menuRow({ icon: 'paperclip', label: s('ui.menuAttach'), end: shortcut, onClick: attachFile }),
      menuRow({ icon: 'layers', label: s('ui.menuProject'), end: 'chevron', onClick: () => showSub('ui.menuProject', projectRows()) }),
      menuSep(),
      menuRow({ icon: 'sparkles', label: s('ui.menuSkills'), end: 'chevron', onClick: openSkills }),
      menuRow({ icon: 'blocks', label: s('ui.menuConnectors'), end: 'chevron', onClick: () => showSub('ui.menuConnectors', connectorRows()) }),
      menuRow({ icon: 'palette', label: s('ui.menuDesign'), end: 'chevron', onClick: () => { subKind = 'design'; showSub('ui.menuDesign', themeRows()); } }),
      menuRow({ icon: 'globe', label: s('ui.menuLanguage') || 'Dil Seçimi / Language', end: 'chevron', onClick: () => { subKind = 'language'; showSub('ui.menuLanguage', languageRows()); } }),
      menuSep(),
      menuRow({ icon: 'plug', label: s('ui.openSettings') || 'Ayarlar / Settings', onClick: () => post({ type: 'openSettings' }) }),
      menuRow({ icon: 'alertCircle', label: s('ui.feedback') || 'Destek & İstek', onClick: () => {
        closePopovers(feedbackPanel);
        feedbackPanel.hidden = false;
        $('feedbackToggle').setAttribute('aria-expanded', 'true');
        $('feedbackText').focus();
      } }),
      menuRow({ icon: 'plug', label: s('ui.menuExtension'), onClick: () => { closePopovers(); vscode.postMessage({ type: 'openExtensions' }); } }),
      menuSep(),
      menuRow({
        icon: 'globe',
        label: s('ui.menuWebSearch') || s('ui.webSearch') || 'Web Search',
        end: webSearchEnabled ? 'check' : '',
        onClick: () => {
          setWebSearch(!webSearchEnabled);
          closePopovers();
        }
      }),
      menuRow({
        icon: 'graph',
        label: s('ui.graphify') || 'Graphify Knowledge Graph',
        onClick: () => post({ type: 'openGraphify' })
      }),
      menuRow({
        icon: 'sparkles',
        label: s('ui.craftAnything') || '🛠️ Craft Anything (Reverse-Engineer & Rebuild)',
        onClick: () => {
          closePopovers();
          input.value = '/craft ';
          input.focus();
        }
      }),
      menuRow({
        icon: 'download',
        label: s('ui.exportChat') || 'Sohbeti Dışa Aktar',
        end: 'chevron',
        onClick: () => {
          subKind = 'export';
          showSub('ui.exportChat', exportRows());
        }
      })
    );
    main.hidden = false;
    $('plusSub').hidden = true;
  }

  function exportRows() {
    return [
      menuRow({ icon: 'pdf', label: s('ui.exportPdf') || 'PDF Olarak Kaydet (.pdf)', onClick: () => post({ type: 'exportChat', format: 'pdf' }) }),
      menuRow({ icon: 'file', label: s('ui.exportMarkdown') || 'Markdown Olarak Kaydet (.md)', onClick: () => post({ type: 'exportChat', format: 'markdown' }) }),
      menuRow({ icon: 'code', label: s('ui.exportEditor') || 'Yeni Sekmede Aç', onClick: () => post({ type: 'exportChat', format: 'editor' }) }),
      menuRow({ icon: 'copy', label: s('ui.exportClipboard') || 'Panoya Kopyala', onClick: () => post({ type: 'exportChat', format: 'clipboard' }) }),
      menuRow({ icon: 'terminal', label: s('ui.exportJson') || 'JSON Olarak Kaydet (.json)', onClick: () => post({ type: 'exportChat', format: 'json' }) })
    ];
  }

  function showSub(titleKey, rows) {
    const sub = $('plusSub');
    const back = menuRow({ icon: 'chevronLeft', label: s(titleKey), onClick: showPlusMain });
    back.classList.add('menu-back');
    sub.replaceChildren(back, menuSep(), ...rows);
    $('plusMain').hidden = true;
    sub.hidden = false;
    placePopover(plusMenu);
  }

  function post(message) {
    closePopovers();
    vscode.postMessage(message);
  }

  function attachFile() { post({ type: 'attachFile' }); }

  function projectRows() {
    return [
      menuRow({ label: s('ui.projectActiveFile'), onClick: () => post({ type: 'attachActive' }) }),
      menuRow({ label: s('ui.projectPickFile'), onClick: () => post({ type: 'attachPick' }) }),
      menuRow({ label: s('ui.projectSelection'), onClick: () => post({ type: 'attachSelection' }) })
    ];
  }

  function connectorRows() {
    return [menuRow({ label: s('ui.connectorsOpen'), onClick: () => post({ type: 'openMcpSettings' }) })];
  }

  function themeRows() {
    return [['auto', 'ui.themeAuto'], ['dark', 'ui.themeDark'], ['light', 'ui.themeLight']].map(([value, key]) =>
      menuRow({
        label: s(key),
        end: theme === value ? 'check' : '',
        onClick: () => {
          setTheme(value);
          showSub('ui.menuDesign', themeRows());
        }
      })
    );
  }

  function languageRows() {
    const entries = [['auto', s('ui.languageAuto') || 'Otomatik (VS Code)'], ...Object.entries(availableLocales)];
    return entries.map(([code, name]) =>
      menuRow({
        label: name,
        end: currentLanguage === code ? 'check' : '',
        onClick: () => {
          currentLanguage = code;
          post({ type: 'setLanguage', language: code });
        }
      })
    );
  }

  function skillRows() {
    if (skillsLoaded === null) return [menuRow({ label: s('ui.skillsLoading'), disabled: true })];
    if (!skillsLoaded.length) return [menuRow({ label: s('ui.skillsEmpty'), disabled: true })];
    return skillsLoaded.map((item) =>
      menuRow({ label: item.name, onClick: () => post({ type: 'useSkill', file: item.name }) })
    );
  }

  function openSkills() {
    subKind = 'skills';
    skillsLoaded = null;
    showSub('ui.menuSkills', skillRows());
    vscode.postMessage({ type: 'listSkills' });
  }

  $('plus').addEventListener('click', () => {
    const open = plusMenu.hidden;
    closePopovers(plusMenu);
    plusMenu.hidden = !open;
    if (open) {
      showPlusMain();
      placePopover(plusMenu);
    }
    $('plus').setAttribute('aria-expanded', String(open));
  });
  if ($('webSearchToggle')) {
    $('webSearchToggle').addEventListener('click', () => setWebSearch(!webSearchEnabled));
  }

  document.addEventListener('click', (event) => {
    const path = event.composedPath();
    const inside = path.some((node) => node.classList && (node.classList.contains('popover') || ['plus', 'model', 'approval', 'feedbackToggle', 'rateBtn', 'langToggle'].includes(node.id)));
    if (!inside) closePopovers();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopovers();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      attachFile();
    }
  });

  $('segChat').addEventListener('click', () => setMode('Ask'));
  $('segAgent').addEventListener('click', () => setMode('Code'));
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.id === 'graphifyChipBtn') {
        vscode.postMessage({ type: 'openGraphify' });
        return;
      }
      if (chip.dataset.command) {
        setMode(chip.dataset.mode || 'Code');
        input.value = chip.dataset.command;
        autosize();
        updateSend();
        send();
        return;
      }
      setMode(chip.dataset.mode);
      input.value = s(chip.dataset.starter);
      autosize();
      updateSend();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  hydrateIcons();
  applyTheme();
  setMode(selectedMode);

  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  $('model').addEventListener('click', () => {
    const open = modelPanel.hidden;
    closePopovers(modelPanel);
    modelPanel.hidden = !open;
    $('model').setAttribute('aria-expanded', String(!modelPanel.hidden));
    if (open) {
      placePopover(modelPanel);
      vscode.postMessage({ type: 'modelMenu' });
    }
  });
  function switchViewTab(tab) {
    const isGraph = tab === 'graphify';
    $('navChatBtn')?.classList.toggle('active', !isGraph);
    $('navGraphifyBtn')?.classList.toggle('active', isGraph);
    $('navChatBtn')?.setAttribute('aria-selected', String(!isGraph));
    $('navGraphifyBtn')?.setAttribute('aria-selected', String(isGraph));
    const chatSec = $('chatViewSection');
    const graphSec = $('graphifyViewSection');
    if (chatSec) chatSec.hidden = isGraph;
    if (graphSec) graphSec.hidden = !isGraph;

    if (isGraph) {
      if (!embeddedGraphData) {
        vscode.postMessage({ type: 'openGraphify' });
      }
      requestAnimationFrame(() => {
        resizeAndRedrawGraph();
        embedFitToViewport();
        startEmbeddedLoop();
      });
    } else {
      if (embedRaf) {
        cancelAnimationFrame(embedRaf);
        embedRaf = 0;
      }
      scrollDown();
    }
  }

  $('navChatBtn')?.addEventListener('click', () => switchViewTab('chat'));
  $('navGraphifyBtn')?.addEventListener('click', () => switchViewTab('graphify'));
  $('graphifyBtn')?.addEventListener('click', () => switchViewTab('graphify'));
  $('graphifyComposerBtn')?.addEventListener('click', () => switchViewTab('graphify'));
  $('graphifyChipBtn')?.addEventListener('click', () => switchViewTab('graphify'));

  if ($('previewBtn')) {
    $('previewBtn').addEventListener('click', () => vscode.postMessage({ type: 'openPreview' }));
  }
  $('compareModel').addEventListener('click', () => vscode.postMessage({ type: 'selectCompareModel' }));
  $('compareModelOption').addEventListener('click', () => vscode.postMessage({ type: 'selectCompareModel' }));
  $('approval').addEventListener('click', () => {
    const open = approvalPanel.hidden;
    closePopovers(approvalPanel);
    approvalPanel.hidden = !open;
  });
  $('approvalToggle').addEventListener('click', () => {
    autoApproveNext = !autoApproveNext;
    vscode.postMessage({ type: 'setAutoApprove', value: autoApproveNext });
    $('approvalToggle').textContent = autoApproveNext ? s('ui.approvalEnabled') : s('ui.approveNext');
  });
  $('modelSearch').addEventListener('input', () => {
    const query = $('modelSearch').value.toLowerCase();
    document.querySelectorAll('.model-option').forEach((option) => {
      option.hidden = !option.textContent.toLowerCase().includes(query);
    });
  });
  $('newChatBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'newChat' });
  });
  $('newChatHistoryBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'newChat' });
    showHistory(false);
  });
  $('tabChatsBtn')?.addEventListener('click', () => {
    $('tabChatsBtn')?.classList.add('active');
    $('tabCommitsBtn')?.classList.remove('active');
    const cv = $('chatHistoryView');
    const gv = $('gitHistoryView');
    if (cv) cv.hidden = false;
    if (gv) gv.hidden = true;
  });
  $('tabCommitsBtn')?.addEventListener('click', () => {
    $('tabCommitsBtn')?.classList.add('active');
    $('tabChatsBtn')?.classList.remove('active');
    const cv = $('chatHistoryView');
    const gv = $('gitHistoryView');
    if (cv) cv.hidden = true;
    if (gv) gv.hidden = false;
  });
  $('undo').addEventListener('click', () => vscode.postMessage({ type: 'undo' }));
  $('exportChat')?.addEventListener('click', () => vscode.postMessage({ type: 'exportChat' }));
  $('historyToggle').addEventListener('click', () => showHistory(historyPanel.hidden));
  $('langToggle').addEventListener('click', () => vscode.postMessage({ type: 'selectLanguage' }));
  if ($('rateBtn')) {
    $('rateBtn').addEventListener('click', () => {
      const open = feedbackPanel.hidden;
      closePopovers(feedbackPanel);
      feedbackPanel.hidden = !open;
      $('feedbackToggle').setAttribute('aria-expanded', String(open));
    });
  }
  if ($('rateMarketplaceBtn')) {
    $('rateMarketplaceBtn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'openExternal',
        url: 'https://marketplace.visualstudio.com/items?itemName=ertugrul37.sovereign-agent&ssr=false#review-details'
      });
    });
  }
  if ($('starGithubBtn')) {
    $('starGithubBtn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'openExternal',
        url: 'https://github.com/ertugrul37/sovereign-agent'
      });
    });
  }
  document.querySelectorAll('.star-pick').forEach((starBtn) => {
    starBtn.addEventListener('click', () => {
      vscode.postMessage({
        type: 'openExternal',
        url: 'https://marketplace.visualstudio.com/items?itemName=ertugrul37.sovereign-agent&ssr=false#review-details'
      });
    });
  });
  $('feedbackToggle').addEventListener('click', () => {
    const open = feedbackPanel.hidden;
    closePopovers(feedbackPanel);
    feedbackPanel.hidden = !open;
    $('feedbackToggle').setAttribute('aria-expanded', String(open));
    if (open) {
      $('feedbackText').focus();
    }
  });
  $('feedbackClose').addEventListener('click', () => {
    feedbackPanel.hidden = true;
    $('feedbackToggle').setAttribute('aria-expanded', 'false');
  });
  $('copyEmailBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'copyText', text: 'destekai.sovereign.ai@gmail.com' });
    const orig = $('copyEmailBtn').getAttribute('title') || '';
    $('copyEmailBtn').setAttribute('title', s('ui.emailCopied') || 'Kopyalandı!');
    $('copyEmailBtn').classList.add('copied');
    setTimeout(() => {
      $('copyEmailBtn').setAttribute('title', orig);
      $('copyEmailBtn').classList.remove('copied');
    }, 2000);
  });
  $('sendEmailBtn').addEventListener('click', () => {
    const text = $('feedbackText').value.trim();
    const subject = encodeURIComponent('Sovereign Agent - Kullanıcı Talebi / Geri Bildirim');
    const body = encodeURIComponent(text ? text + '\n\n---\nSovereign Agent User Request' : 'Merhaba Sovereign Agent Ekibi,\n\n');
    const mailto = 'mailto:destekai.sovereign.ai@gmail.com?subject=' + subject + '&body=' + body;
    vscode.postMessage({ type: 'openExternal', url: mailto });
    $('feedbackText').value = '';
    feedbackPanel.hidden = true;
    $('feedbackToggle').setAttribute('aria-expanded', 'false');
  });
  $('metricsToggle').addEventListener('click', () => {
    const open = metrics.classList.contains('collapsed');
    metrics.classList.toggle('collapsed', !open);
    $('metricsToggle').setAttribute('aria-expanded', String(open));
  });
  $('historyClose').addEventListener('click', () => showHistory(false));
  input.addEventListener('input', () => {
    autosize();
    updateSend();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        strings = msg.strings;
        userName = msg.userName || '';
        if (msg.language) currentLanguage = msg.language;
        if (msg.locales) availableLocales = msg.locales;
        applyStrings();
        $('modelName').textContent = msg.compareModel
          ? (msg.model || s('ui.noModel')) + ' + ' + msg.compareModel
          : (msg.model || s('ui.noModel'));
        break;
      case 'openFeedback':
        closePopovers(feedbackPanel);
        feedbackPanel.hidden = false;
        $('feedbackToggle').setAttribute('aria-expanded', 'true');
        $('feedbackText').focus();
        break;
      case 'attachments':
        (msg.items || []).forEach((item) => {
          if (!attachments.some((a) => a.name === item.name)) attachments.push(item);
        });
        renderAttachments();
        updateSend();
        break;
      case 'skills':
        skillsLoaded = msg.items || [];
        if (subKind === 'skills' && !plusMenu.hidden) showSub('ui.menuSkills', skillRows());
        break;
      case 'modelOptions':
        renderModelOptions(msg.models || [], msg.selected, msg.error);
        break;
      case 'transcription':
        input.value = (input.value + ' ' + msg.text).trim();
        input.focus();
        statusEl.textContent = '';
        break;
      case 'transcriptionError':
        statusEl.textContent = msg.text;
        break;
      case 'conversation':
        messages.querySelectorAll('.msg').forEach((el) => el.remove());
        bubble = null;
        lastTool = null;
        renderRestoredConversation(msg.messages || []);
        empty.hidden = messages.querySelectorAll('.msg').length > 0;
        scrollDown();
        break;
      case 'chatSessions':
        renderChatSessions(msg.sessions || [], msg.activeId);
        break;
      case 'metrics':
        metrics.hidden = false;
        $('metricTime').textContent = formatDuration(msg.durationMs);
        $('metricTokens').textContent = msg.inputTokens + ' in / ' + msg.outputTokens + ' out';
        $('metricSpeed').textContent = msg.tokensPerSecond.toFixed(1) + ' tok/s';
        $('metricMemory').textContent = msg.memory === 'unavailable' ? s('ui.memoryUnavailable') : msg.memory;
        metricHistory.push({ speed: msg.tokensPerSecond, duration: msg.durationMs });
        renderTrend();
        break;
      case 'history':
        if (!historyPanel.hidden) {
          renderHistory(msg.commits || [], msg.error);
        }
        break;
      case 'commit':
        commitDetail.hidden = false;
        commitDetail.textContent = msg.output;
        break;
      case 'insertText':
        input.value += msg.text;
        input.focus();
        input.dispatchEvent(new Event('input'));
        break;
      case 'busy':
        setBusy(msg.value);
        break;
      case 'compareStart':
        comparison.hidden = false;
        comparisonTexts = { primary: '', secondary: '' };
        $('compareModelPrimary').textContent = msg.models[0];
        $('compareModelSecondary').textContent = msg.models[1];
        ['primary', 'secondary'].forEach((id) => {
          $('compareText' + id[0].toUpperCase() + id.slice(1)).textContent = '';
          $('compareState' + id[0].toUpperCase() + id.slice(1)).textContent = s('ui.working');
          const button = document.querySelector('.compare-choice[data-id="' + id + '"]');
          button.disabled = true;
        });
        $('comparisonStatus').textContent = s('ui.compareRunning');
        empty.hidden = true;
        break;
      case 'compareText': {
        comparisonTexts[msg.id] = msg.text;
        if (!compareRaf) {
          compareRaf = requestAnimationFrame(() => {
            compareRaf = 0;
            ['primary', 'secondary'].forEach((id) => {
              if (comparisonTexts[id] !== undefined) {
                const sfx = id[0].toUpperCase() + id.slice(1);
                $('compareText' + sfx).innerHTML = render(comparisonTexts[id]);
              }
            });
            scrollDown();
          });
        }
        break;
      }
      case 'compareCandidateDone': {
        const suffix = msg.id[0].toUpperCase() + msg.id.slice(1);
        if (comparisonTexts[msg.id] !== undefined) {
          $('compareText' + suffix).innerHTML = render(comparisonTexts[msg.id]);
        }
        $('compareState' + suffix).textContent = s('ui.compareReady');
        const button = document.querySelector('.compare-choice[data-id="' + msg.id + '"]');
        button.disabled = !comparisonTexts[msg.id]?.trim();
        break;
      }
      case 'compareError': {
        const suffix = msg.id[0].toUpperCase() + msg.id.slice(1);
        $('compareState' + suffix).textContent = s('ui.compareError');
        const error = document.createElement('div');
        error.className = 'comparison-error';
        error.textContent = msg.text;
        $('compareText' + suffix).appendChild(error);
        break;
      }
      case 'compareFinished':
        $('comparisonStatus').textContent = s('ui.compareChoose');
        break;
      case 'compareChosen': {
        comparison.hidden = true;
        const selected = document.createElement('div');
        selected.className = 'msg assistant';
        selected.innerHTML = render(msg.text);
        messages.appendChild(selected);
        scrollDown();
        break;
      }
      case 'assistantStart':
        empty.hidden = true;
        bubble = document.createElement('div');
        bubble.className = 'msg assistant';
        bubbleText = '';
        messages.appendChild(bubble);
        break;
      case 'assistantText':
        if (bubble) {
          bubbleText = msg.text;
          if (!renderRaf) {
            renderRaf = requestAnimationFrame(flushBubbleRender);
          }
        }
        break;
      case 'assistantEnd':
        flushBubbleRender();
        if (bubble && !bubbleText.trim()) bubble.remove();
        bubble = null;
        break;
      case 'toolCall': {
        const raw = msg.summary || '';
        const spaceIdx = raw.indexOf(' ');
        const toolName = spaceIdx >= 0 ? raw.slice(0, spaceIdx) : (raw || 'tool');
        const toolArg = spaceIdx >= 0 ? raw.slice(spaceIdx + 1).trim() : '';
        const iconMap = {
          list_files: 'folder',
          read_file: 'file',
          write_file: 'pencil',
          replace_in_file: 'pencil',
          search_files: 'search',
          run_command: 'terminal',
          mcp_call: 'plug',
          get_editor_context: 'code',
          web_search: 'globe',
          browser_action: 'monitor',
          code_graph: 'graph',
          run_tests: 'terminal',
          craft_anything: 'sparkles'
        };
        lastTool = document.createElement('details');
        lastTool.className = 'msg tool running';
        lastTool.dataset.tool = toolName;
        lastTool.open = true;

        const summary = document.createElement('summary');
        summary.className = 'tool-summary';

        const iconWrap = document.createElement('span');
        iconWrap.className = 'tool-icon';
        iconWrap.innerHTML = icon(iconMap[toolName] || 'code', 14);
        summary.appendChild(iconWrap);

        const badge = document.createElement('span');
        badge.className = 'tool-badge';
        badge.textContent = toolName;
        summary.appendChild(badge);

        if (toolArg) {
          const target = document.createElement('code');
          target.className = 'tool-target';
          target.textContent = toolArg;
          summary.appendChild(target);
        }

        const meta = document.createElement('span');
        meta.className = 'tool-meta';
        const status = document.createElement('span');
        status.className = 'tool-status';
        meta.appendChild(status);
        const chev = document.createElement('span');
        chev.className = 'tool-chevron';
        chev.innerHTML = icon('chevronRight', 14);
        meta.appendChild(chev);
        summary.appendChild(meta);

        lastTool.appendChild(summary);
        messages.appendChild(lastTool);
        scrollDown();
        break;
      }
      case 'toolResult':
        if (lastTool) {
          lastTool.classList.remove('running');
          lastTool.classList.add(msg.ok ? 'succeeded' : 'failed');
          const status = lastTool.querySelector('.tool-status');
          const toolName = lastTool.dataset.tool || '';
          const bodyWrap = document.createElement('div');
          bodyWrap.className = 'tool-body';

          if (toolName === 'list_files' && msg.ok && msg.output && msg.output.trim() !== '(empty)') {
            const entries = msg.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            if (status) {
              status.textContent = entries.length + ' ✓';
            }
            const grid = document.createElement('div');
            grid.className = 'tool-file-grid';
            entries.forEach((entry) => {
              const isDir = entry.endsWith('/');
              const chip = document.createElement('span');
              chip.className = 'tool-file-chip' + (isDir ? ' is-dir' : '');
              const chipIcon = document.createElement('span');
              chipIcon.className = 'tool-file-icon';
              chipIcon.innerHTML = icon(isDir ? 'folder' : 'file', 13);
              const chipName = document.createElement('span');
              chipName.className = 'tool-file-name';
              chipName.textContent = entry;
              chip.appendChild(chipIcon);
              chip.appendChild(chipName);
              grid.appendChild(chip);
            });
            bodyWrap.appendChild(grid);
          } else if (toolName === 'web_search' && msg.ok && msg.output && msg.output.includes('URL: ')) {
            const blocks = msg.output.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
            if (status) {
              status.textContent = blocks.length + ' ✓';
            }
            const list = document.createElement('div');
            list.className = 'tool-web-list';
            blocks.forEach((b) => {
              const lines = b.split(/\r?\n/);
              const titleLine = (lines[0] || '').replace(/^\[\d+\]\s*/, '').trim();
              const urlLine = (lines.find((l) => l.startsWith('URL: ')) || '').slice(5).trim();
              const snippetLine = (lines.find((l) => l.startsWith('Snippet: ')) || '').slice(9).trim();
              const card = document.createElement('button');
              card.type = 'button';
              card.className = 'tool-web-card';
              const top = document.createElement('div');
              top.className = 'tool-web-top';
              const titleEl = document.createElement('strong');
              titleEl.className = 'tool-web-title';
              titleEl.textContent = titleLine || urlLine;
              const domainEl = document.createElement('span');
              domainEl.className = 'tool-web-domain';
              try {
                domainEl.textContent = new URL(urlLine).hostname.replace(/^www\./, '');
              } catch {
                domainEl.textContent = urlLine;
              }
              top.append(titleEl, domainEl);
              card.appendChild(top);
              if (snippetLine && snippetLine !== '(no snippet)') {
                const snip = document.createElement('p');
                snip.className = 'tool-web-snippet';
                snip.textContent = snippetLine;
                card.appendChild(snip);
              }
              if (urlLine.startsWith('http://') || urlLine.startsWith('https://')) {
                card.addEventListener('click', () => vscode.postMessage({ type: 'openExternal', url: urlLine }));
              }
              list.appendChild(card);
            });
            bodyWrap.appendChild(list);
          } else {
            if (status) {
              status.textContent = msg.ok ? '✓' : '✕';
            }
            const pre = document.createElement('pre');
            pre.className = 'tool-output';
            pre.textContent = msg.output;
            bodyWrap.appendChild(pre);
          }

          lastTool.appendChild(bodyWrap);
          lastTool = null;
          scrollDown();
        }
        break;
      case 'error':
        add('error', msg.text);
        break;
      case 'confirmRequest': {
        empty.hidden = true;
        const card = document.createElement('div');
        card.className = 'msg confirm-card';
        const text = document.createElement('p');
        text.className = 'confirm-message';
        text.textContent = msg.message;
        card.appendChild(text);
        if (msg.detail) {
          const detail = document.createElement('pre');
          detail.className = 'confirm-detail';
          detail.textContent = msg.detail;
          card.appendChild(detail);
        }
        const verdict = document.createElement('span');
        verdict.className = 'confirm-verdict';
        verdict.hidden = true;
        card.appendChild(verdict);
        const actions = document.createElement('div');
        actions.className = 'confirm-actions';
        const allowBtn = document.createElement('button');
        allowBtn.type = 'button';
        allowBtn.className = 'confirm-allow';
        allowBtn.innerHTML = '<svg class="icon btn-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';
        const allowSpan = document.createElement('span');
        allowSpan.dataset.i18n = 'approval.allow';
        allowSpan.textContent = s('approval.allow') || 'İzin ver';
        allowBtn.appendChild(allowSpan);
        const denyBtn = document.createElement('button');
        denyBtn.type = 'button';
        denyBtn.className = 'confirm-deny';
        denyBtn.innerHTML = '<svg class="icon btn-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';
        const denySpan = document.createElement('span');
        denySpan.dataset.i18n = 'approval.deny';
        denySpan.textContent = s('approval.deny') || 'Reddet';
        denyBtn.appendChild(denySpan);
        const settle = (allow) => {
          allowBtn.disabled = true;
          denyBtn.disabled = true;
          actions.hidden = true;
          verdict.hidden = false;
          const label = allow ? (s('approval.allow') || 'İzin ver') : (s('approval.deny') || 'Reddet');
          verdict.textContent = (allow ? '✓ ' : '✕ ') + label;
          card.classList.add(allow ? 'confirm-allowed' : 'confirm-denied');
          vscode.postMessage({ type: 'confirmResponse', id: msg.id, allow });
        };
        allowBtn.addEventListener('click', () => settle(true));
        denyBtn.addEventListener('click', () => settle(false));
        actions.appendChild(allowBtn);
        actions.appendChild(denyBtn);
        card.appendChild(actions);
        messages.appendChild(card);
        scrollDown();
        break;
      }
      case 'cleared':
        messages.querySelectorAll('.msg').forEach((el) => el.remove());
        empty.hidden = false;
        bubble = null;
        lastTool = null;
        comparison.hidden = true;
        break;
      case 'showGraphifyTab':
        switchViewTab('graphify');
        if (msg.data) initOrUpdateEmbeddedGraph(msg.data, msg.locale);
        break;
      case 'graphifyData':
        if (msg.data) initOrUpdateEmbeddedGraph(msg.data, msg.locale);
        break;
    }
  });

  // ====================================================
  // Embedded Graphify Architecture Studio (Unified In-Extension View)
  // ====================================================
  const GRAPHIFY_I18N = {
    tr: {
      files: 'Dosya', edges: 'Bağlantı', health: 'Sağlık',
      star: '⭐ Yıldız & Kollar', diagram: '📦 Blok Diyagramı', hierarchy: '🏛️ Hiyerarşi',
      focus: '🎯 1-Hop Odak', cycles: '⚠️ Döngüler',
      tabInspector: 'İnceleyici', tabHealth: 'Sağlık', tabExport: 'Dışa Aktar',
      archHealth: 'Mimari Sağlığı', archHealthSub: 'Döngüler, dev düğümler ve bağlantı metriği',
      hubsTitle: '👑 Mimari Merkezler (God-Nodes)', cyclesTitleSec: '⚠️ Döngüsel Bağımlılıklar',
      orphansTitle: '📦 İzole Dosyalar (Ölü Kod)', loopPrefix: '⚠️ Döngü:', linesUnit: 'satır',
      exportTitle: 'Bilgi Grafiği Dışa Aktarma', exportDesc: 'Mermaid diyagramları ve metrik tabloları içeren ARCHITECTURE.md oluşturur.',
      exportBtn: '📝 ARCHITECTURE.md Oluştur', clickNodeHint: 'Sembolleri ve bağımlılıkları incelemek için tuvaldeki bir düğüme tıklayın.',
      clusterLabel: 'Modül:', scoreLabel: 'Skor:', openFile: '📂 Dosyayı Aç', analyzeImpact: '🤖 Etki Analizi Yap',
      symbolsSection: 'Semboller / Tanımlar', importedBySection: 'Import Edenler (Bağımlı)', importsSection: 'Import Edilenler (Bağımlılık)',
      none: '(yok)', dependentsTooltip: 'bağımlı dosya', importsTooltip: 'import',
      askPrompt: '{file} dosyasının mimari ve bağımlılık etkisini <code_graph><action>impact</action><target>{file}</target></code_graph> kullanarak analiz et.'
    },
    en: {
      files: 'Files', edges: 'Edges', health: 'Health',
      star: '⭐ Star & Arms', diagram: '📦 Block Diagram', hierarchy: '🏛️ Hierarchy',
      focus: '🎯 1-Hop Focus', cycles: '⚠️ Cycles',
      tabInspector: 'Inspector', tabHealth: 'Health', tabExport: 'Export',
      archHealth: 'Architecture Health', archHealthSub: 'Cycles, god-nodes & coupling metric',
      hubsTitle: '👑 Architectural Hubs (God-Nodes)', cyclesTitleSec: '⚠️ Circular Dependencies',
      orphansTitle: '📦 Orphan Files (Dead Code)', loopPrefix: '⚠️ Loop:', linesUnit: 'lines',
      exportTitle: 'Knowledge Graph Export', exportDesc: 'Generate ARCHITECTURE.md with Mermaid diagrams and metrics.',
      exportBtn: '📝 Generate ARCHITECTURE.md', clickNodeHint: 'Click on any node in the canvas to inspect its symbols and dependencies.',
      clusterLabel: 'Cluster:', scoreLabel: 'Score:', openFile: '📂 Open File', analyzeImpact: '🤖 Analyze Impact',
      symbolsSection: 'Symbols / Definitions', importedBySection: 'Imported By (Dependents)', importsSection: 'Imports (Dependencies)',
      none: '(none)', dependentsTooltip: 'dependents', importsTooltip: 'imports',
      askPrompt: 'Analyze the architecture and dependency impact of {file} using <code_graph><action>impact</action><target>{file}</target></code_graph>.'
    },
    de: {
      files: 'Dateien', edges: 'Kanten', health: 'Gesundheit',
      star: '⭐ Stern & Arme', diagram: '📦 Blockdiagramm', hierarchy: '🏛️ Hierarchie',
      focus: '🎯 1-Hop Fokus', cycles: '⚠️ Zyklen',
      tabInspector: 'Inspektor', tabHealth: 'Gesundheit', tabExport: 'Exportieren',
      archHealth: 'Architektur-Gesundheit', archHealthSub: 'Zyklen, Gott-Knoten und Kopplung',
      hubsTitle: '👑 Architektur-Knotenpunkte', cyclesTitleSec: '⚠️ Zyklische Abhängigkeiten',
      orphansTitle: '📦 Verwaiste Dateien', loopPrefix: '⚠️ Schleife:', linesUnit: 'Zeilen',
      exportTitle: 'Wissensgraph exportieren', exportDesc: 'Erstellen Sie ARCHITECTURE.md mit Mermaid-Diagrammen.',
      exportBtn: '📝 ARCHITECTURE.md generieren', clickNodeHint: 'Klicken Sie auf einen Knoten auf der Leinwand.',
      clusterLabel: 'Cluster:', scoreLabel: 'Score:', openFile: '📂 Datei öffnen', analyzeImpact: '🤖 Auswirkung analysieren',
      symbolsSection: 'Symbole / Definitionen', importedBySection: 'Importiert von', importsSection: 'Importe',
      none: '(keine)', dependentsTooltip: 'Abhängige', importsTooltip: 'Importe',
      askPrompt: 'Analysieren Sie die Architektur- und Abhängigkeitsauswirkungen von {file} mit <code_graph><action>impact</action><target>{file}</target></code_graph>.'
    },
    es: {
      files: 'Archivos', edges: 'Conexiones', health: 'Salud',
      star: '⭐ Estrella y Brazos', diagram: '📦 Diagrama de Bloques', hierarchy: '🏛️ Jerarquía',
      focus: '🎯 Foco 1-Salto', cycles: '⚠️ Ciclos',
      tabInspector: 'Inspector', tabHealth: 'Salud', tabExport: 'Exportar',
      archHealth: 'Salud de Arquitectura', archHealthSub: 'Métricas de ciclos y acoplamiento',
      hubsTitle: '👑 Centros Arquitectónicos', cyclesTitleSec: '⚠️ Dependencias Circulares',
      orphansTitle: '📦 Archivos Huérfanos', loopPrefix: '⚠️ Bucle:', linesUnit: 'líneas',
      exportTitle: 'Exportar Grafo de Conocimiento', exportDesc: 'Genere ARCHITECTURE.md con diagramas Mermaid.',
      exportBtn: '📝 Generar ARCHITECTURE.md', clickNodeHint: 'Haga clic en cualquier nodo para inspeccionar.',
      clusterLabel: 'Módulo:', scoreLabel: 'Puntaje:', openFile: '📂 Abrir Archivo', analyzeImpact: '🤖 Analizar Impacto',
      symbolsSection: 'Símbolos / Definiciones', importedBySection: 'Importado por', importsSection: 'Importaciones',
      none: '(ninguno)', dependentsTooltip: 'dependientes', importsTooltip: 'importaciones',
      askPrompt: 'Analice el impacto de arquitectura de {file} usando <code_graph><action>impact</action><target>{file}</target></code_graph>.'
    },
    fr: {
      files: 'Fichiers', edges: 'Connexions', health: 'Santé',
      star: '⭐ Étoile & Bras', diagram: '📦 Diagramme de Blocs', hierarchy: '🏛️ Hiérarchie',
      focus: '🎯 Focus 1-Saut', cycles: '⚠️ Boucles',
      tabInspector: 'Inspecteur', tabHealth: 'Santé', tabExport: 'Exporter',
      archHealth: 'Santé Architecturale', archHealthSub: 'Métriques de boucles et de couplage',
      hubsTitle: '👑 Pôles Architecturaux', cyclesTitleSec: '⚠️ Dépendances Circulaires',
      orphansTitle: '📦 Fichiers Orphelins', loopPrefix: '⚠️ Boucle :', linesUnit: 'lignes',
      exportTitle: 'Exporter Graphe de Connaissance', exportDesc: 'Générez ARCHITECTURE.md avec diagrammes Mermaid.',
      exportBtn: '📝 Générer ARCHITECTURE.md', clickNodeHint: 'Cliquez sur un nœud pour inspecter ses dépendances.',
      clusterLabel: 'Module :', scoreLabel: 'Score :', openFile: '📂 Ouvrir Fichier', analyzeImpact: '🤖 Analyser Impact',
      symbolsSection: 'Symboles / Définitions', importedBySection: 'Importé par', importsSection: 'Imports',
      none: '(aucun)', dependentsTooltip: 'dépendants', importsTooltip: 'imports',
      askPrompt: 'Analysez l’impact architectural de {file} avec <code_graph><action>impact</action><target>{file}</target></code_graph>.'
    },
    az: {
      files: 'Fayl', edges: 'Əlaqə', health: 'Sağlamlıq',
      star: '⭐ Ulduz & Qollar', diagram: '📦 Blok Diaqramı', hierarchy: '🏛️ Hiyerarxiya',
      focus: '🎯 1-Addım Fokus', cycles: '⚠️ Dövrlər',
      tabInspector: 'Müfəttiş', tabHealth: 'Sağlamlıq', tabExport: 'İxrac Et',
      archHealth: 'Memarlıq Sağlamlığı', archHealthSub: 'Dövrlər və əlaqə metriki',
      hubsTitle: '👑 Memarlıq Mərkəzləri', cyclesTitleSec: '⚠️ Dövri Asılılıqlar',
      orphansTitle: '📦 Təcrid Olunmuş Fayllar', loopPrefix: '⚠️ Dövr:', linesUnit: 'sətir',
      exportTitle: 'Bilik Qrafiki İxracı', exportDesc: 'Mermaid diaqramları ilə ARCHITECTURE.md yaradın.',
      exportBtn: '📝 ARCHITECTURE.md Yarat', clickNodeHint: 'Düyünü yoxlamaq üçün kətan üzərində klikləyin.',
      clusterLabel: 'Modul:', scoreLabel: 'Xal:', openFile: '📂 Faylı Aç', analyzeImpact: '🤖 Təsirini Təhlil Et',
      symbolsSection: 'Simvollar / Təriflər', importedBySection: 'İdxal Edənlər', importsSection: 'İdxal Edilənlər',
      none: '(yoxdur)', dependentsTooltip: 'asılı fayl', importsTooltip: 'idxal',
      askPrompt: '{file} faylının memarlıq təsirini <code_graph><action>impact</action><target>{file}</target></code_graph> istifadə edərək təhlil edin.'
    },
    ru: {
      files: 'Файлов', edges: 'Связей', health: 'Здоровье',
      star: '⭐ Звезда и рукава', diagram: '📦 Блок-схема', hierarchy: '🏛️ Иерархия',
      focus: '🎯 1 шаг', cycles: '⚠️ Циклы',
      tabInspector: 'Инспектор', tabHealth: 'Здоровье', tabExport: 'Экспорт',
      archHealth: 'Архитектурное здоровье', archHealthSub: 'Метрики циклов и связности',
      hubsTitle: '👑 Архитектурные центры', cyclesTitleSec: '⚠️ Циклические зависимости',
      orphansTitle: '📦 Изолированные файлы', loopPrefix: '⚠️ Цикл:', linesUnit: 'строк',
      exportTitle: 'Экспорт графа знаний', exportDesc: 'Создать ARCHITECTURE.md с диаграммами Mermaid.',
      exportBtn: '📝 Сгенерировать ARCHITECTURE.md', clickNodeHint: 'Нажмите на узел для просмотра связей.',
      clusterLabel: 'Модуль:', scoreLabel: 'Оценка:', openFile: '📂 Открыть файл', analyzeImpact: '🤖 Анализ влияния',
      symbolsSection: 'Символы / Определения', importedBySection: 'Кем импортируется', importsSection: 'Импортирует',
      none: '(нет)', dependentsTooltip: 'зависимых', importsTooltip: 'импортов',
      askPrompt: 'Проанализируйте архитектурное влияние {file} с помощью <code_graph><action>impact</action><target>{file}</target></code_graph>.'
    },
    zh: {
      files: '文件', edges: '关联', health: '健康度',
      star: '⭐ 核心星系', diagram: '📦 模块方块图', hierarchy: '🏛️ 层次结构',
      focus: '🎯 1度关注', cycles: '⚠️ 循环依赖',
      tabInspector: '检查器', tabHealth: '健康', tabExport: '导出',
      archHealth: '架构健康度', archHealthSub: '循环依赖与耦合度指标',
      hubsTitle: '👑 关键架构枢纽', cyclesTitleSec: '⚠️ 循环依赖',
      orphansTitle: '📦 孤立文件', loopPrefix: '⚠️ 环路：', linesUnit: '行',
      exportTitle: '知识图谱导出', exportDesc: '生成包含 Mermaid 图的 ARCHITECTURE.md 文件。',
      exportBtn: '📝 生成 ARCHITECTURE.md', clickNodeHint: '点击画布中的节点检查其依赖关系。',
      clusterLabel: '模块：', scoreLabel: '评分：', openFile: '📂 打开文件', analyzeImpact: '🤖 影响分析',
      symbolsSection: '符号 / 导出', importedBySection: '下游引用', importsSection: '依赖项',
      none: '(无)', dependentsTooltip: '下游引用', importsTooltip: '依赖项',
      askPrompt: '请使用 <code_graph><action>impact</action><target>{file}</target></code_graph> 分析 {file} 的架构影响。'
    },
    ja: {
      files: 'ファイル', edges: '依存', health: '健全度',
      star: '⭐ 星座', diagram: '📦 ブロック図', hierarchy: '🏛️ 階層',
      focus: '🎯 1ホップ', cycles: '⚠️ 循環依存',
      tabInspector: 'インスペクタ', tabHealth: '健全性', tabExport: 'エクスポート',
      archHealth: 'アーキテクチャ健全度', archHealthSub: '循環依存と結合度メトリクス',
      hubsTitle: '👑 主要ハブ', cyclesTitleSec: '⚠️ 循環依存関係',
      orphansTitle: '📦 孤立ファイル', loopPrefix: '⚠️ ループ：', linesUnit: '行',
      exportTitle: 'ナレッジグラフ出力', exportDesc: 'Mermaid 図を含む ARCHITECTURE.md を生成します。',
      exportBtn: '📝 ARCHITECTURE.md を生成', clickNodeHint: 'ノードをクリックして依存関係を確認します。',
      clusterLabel: 'モジュール：', scoreLabel: 'スコア：', openFile: '📂 ファイルを開く', analyzeImpact: '🤖 影響度分析',
      symbolsSection: 'シンボル / 定義', importedBySection: '依存先', importsSection: '依存元',
      none: '(なし)', dependentsTooltip: '依存元', importsTooltip: '依存先',
      askPrompt: '<code_graph><action>impact</action><target>{file}</target></code_graph> で {file} の影響を分析してください。'
    }
  };

  let embeddedGraphData = null;
  let embedSimNodes = [];
  let embedNodeById = new Map();
  let embedFilesByCluster = new Map();
  let embedModuleHubs = [];
  let embedCoreStar = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let embedClusterBoxes = [];
  let embedCyclePairs = new Set();
  let embedSelectedNode = null;
  let embedHoveredNode = null;
  let embedDraggingNode = null;
  let embedCamX = 0, embedCamY = 0, embedZoom = 0.9;
  let embedLastMouse = { x: 0, y: 0 }, embedPanning = false;
  let embedCurrentLayout = 'star';
  let embedFocus1HopMode = false;
  let embedCyclesHighlightMode = false;
  let embedCurrentLang = 'tr';
  let embedCanvas = null;
  let embedCtx = null;
  let embedRaf = 0;
  let embedClusterColors = {};
  const EMBED_PALETTE = ['#6366f1', '#00d2b4', '#38bdf8', '#a855f7', '#f43f5e', '#f59e0b', '#10b981', '#ec4899', '#94a3b8'];

  function gtr(key, vars) {
    const dict = GRAPHIFY_I18N[embedCurrentLang] || GRAPHIFY_I18N.en;
    let s = dict[key] || (GRAPHIFY_I18N.en && GRAPHIFY_I18N.en[key]) || key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
      }
    }
    return s;
  }

  function applyEmbeddedLang() {
    $('embedNodesLabel') && ($('embedNodesLabel').textContent = gtr('files'));
    $('embedEdgesLabel') && ($('embedEdgesLabel').textContent = gtr('edges'));
    $('embedHealthLabel') && ($('embedHealthLabel').textContent = gtr('health'));
    $('embedBtnStar') && ($('embedBtnStar').title = gtr('star'));
    $('embedBtnDiagram') && ($('embedBtnDiagram').title = gtr('diagram'));
    $('embedBtnHierarchy') && ($('embedBtnHierarchy').title = gtr('hierarchy'));
    $('embedFocusBtn') && ($('embedFocusBtn').title = gtr('focus'));
    $('embedCyclesBtn') && ($('embedCyclesBtn').title = gtr('cycles'));
    $('embedTabSelLabel') && ($('embedTabSelLabel').textContent = gtr('tabInspector'));
    $('embedTabHltLabel') && ($('embedTabHltLabel').textContent = gtr('tabHealth'));
    $('embedTabExpLabel') && ($('embedTabExpLabel').textContent = gtr('tabExport'));
    renderEmbedDrawer(embedSelectedNode);
  }

  function initOrUpdateEmbeddedGraph(data, locale) {
    embeddedGraphData = data;
    if (locale && GRAPHIFY_I18N[locale]) {
      embedCurrentLang = locale;
    } else if (currentLanguage && GRAPHIFY_I18N[currentLanguage]) {
      embedCurrentLang = currentLanguage;
    }

    $('embedStatNodes').textContent = data.nodes.length;
    $('embedStatEdges').textContent = data.edges.length;
    $('embedStatHealth').textContent = data.healthScore;
    $('embedCycleBadge').textContent = data.cycles.length;

    const langSel = $('embedLangSelect');
    if (langSel) {
      langSel.value = embedCurrentLang;
      langSel.onchange = (e) => {
        embedCurrentLang = e.target.value;
        applyEmbeddedLang();
      };
    }

    embedClusterColors = {};
    data.clusters.forEach((c, idx) => {
      embedClusterColors[c.name] = EMBED_PALETTE[idx % EMBED_PALETTE.length];
    });

    embedCyclePairs.clear();
    data.cycles.forEach(c => {
      for (let i = 0; i < c.length - 1; i++) {
        embedCyclePairs.add(c[i] + '<->' + c[i + 1]);
        embedCyclePairs.add(c[i + 1] + '<->' + c[i]);
      }
    });

    embedFilesByCluster.clear();
    data.clusters.forEach(c => embedFilesByCluster.set(c.name, []));
    data.nodes.forEach(n => {
      if (!embedFilesByCluster.has(n.cluster)) embedFilesByCluster.set(n.cluster, []);
      embedFilesByCluster.get(n.cluster).push(n);
    });

    embedSimNodes = data.nodes.map(n => ({
      ...n,
      x: 0, y: 0, vx: 0, vy: 0,
      targetX: 0, targetY: 0,
      radius: Math.max(6, Math.min(14, 5 + Math.sqrt(n.score) * 1.8)),
      color: embedClusterColors[n.cluster] || '#6366f1',
      isHub: data.hubs.some(h => h.id === n.id)
    }));

    embedNodeById.clear();
    embedSimNodes.forEach(n => embedNodeById.set(n.id, n));

    const totalClusters = data.clusters.length;
    embedModuleHubs = data.clusters.map((c, i) => {
      const angle = (i / totalClusters) * Math.PI * 2 - Math.PI / 2;
      const r = Math.max(160, 36 * Math.min(8, totalClusters));
      return {
        name: c.name,
        count: c.count,
        color: embedClusterColors[c.name] || '#6366f1',
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        targetX: Math.cos(angle) * r,
        targetY: Math.sin(angle) * r,
        angle
      };
    });

    applyEmbedLayout(embedCurrentLayout);
    applyEmbeddedLang();
    bindEmbedEventsOnce();
    requestAnimationFrame(() => {
      resizeAndRedrawGraph();
      embedFitToViewport();
      startEmbeddedLoop();
    });
  }

  function relaxEmbedCollisions() {
    for (let pass = 0; pass < 25; pass++) {
      for (let i = 0; i < embedSimNodes.length; i++) {
        for (let j = i + 1; j < embedSimNodes.length; j++) {
          const a = embedSimNodes[i];
          const b = embedSimNodes[j];
          const dx = b.targetX - a.targetX;
          const dy = b.targetY - a.targetY;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = (a.radius || 8) + (b.radius || 8) + 20;
          if (dist < minDist) {
            const overlap = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;
            a.targetX -= nx * overlap;
            a.targetY -= ny * overlap;
            b.targetX += nx * overlap;
            b.targetY += ny * overlap;
          }
        }
      }
    }
  }

  function applyEmbedLayout(layout) {
    embedCurrentLayout = layout;
    if (!embeddedGraphData) return;
    const totalClusters = embeddedGraphData.clusters.length;

    if (layout === 'star') {
      embedCoreStar.targetX = 0;
      embedCoreStar.targetY = 0;
      embedModuleHubs.forEach((m, i) => {
        const angle = (i / totalClusters) * Math.PI * 2 - Math.PI / 2;
        const r = Math.max(170, 38 * Math.min(8, totalClusters));
        m.targetX = Math.cos(angle) * r;
        m.targetY = Math.sin(angle) * r;
        m.angle = angle;

        const files = (embedFilesByCluster.get(m.name) || []).map(f => embedNodeById.get(f.id)).filter(Boolean);
        const count = files.length;
        const ringCaps = [4, 6, 8, 10, 12];
        let fIdx = 0, ring = 0;
        while (fIdx < count) {
          const cap = ringCaps[ring] || 8;
          const inRing = Math.min(cap, count - fIdx);
          const ringDist = 65 + ring * 50;
          const fanSpan = Math.min(Math.PI * 1.1, 0.28 * inRing + 0.18);
          for (let j = 0; j < inRing; j++) {
            const f = files[fIdx++];
            const subAngle = inRing === 1 ? angle : (angle - fanSpan / 2 + (j / (inRing - 1)) * fanSpan);
            f.targetX = m.targetX + Math.cos(subAngle) * ringDist;
            f.targetY = m.targetY + Math.sin(subAngle) * ringDist;
            f.radius = Math.max(6, Math.min(13, 5 + Math.sqrt(f.score) * 1.6));
          }
          ring++;
        }
      });
      relaxEmbedCollisions();
    } else if (layout === 'diagram') {
      embedClusterBoxes.length = 0;
      const cols = 2;
      const boxW = 220;
      const spacingX = 250;
      const rows = [];
      embeddedGraphData.clusters.forEach((c, idx) => {
        const r = Math.floor(idx / cols);
        if (!rows[r]) rows[r] = [];
        const files = (embedFilesByCluster.get(c.name) || []).map(f => embedNodeById.get(f.id)).filter(Boolean);
        const colsInside = files.length > 6 ? 2 : 1;
        const rowsInside = Math.ceil(files.length / colsInside);
        const boxH = Math.max(80, 40 + rowsInside * 22 + 10);
        rows[r].push({ cluster: c, files, colsInside, boxH });
      });

      let totalGridH = 0;
      rows.forEach(r => {
        const maxH = Math.max(...r.map(item => item.boxH), 100);
        totalGridH += maxH + 50;
      });

      let currentY = -totalGridH / 2;
      rows.forEach(rowClusters => {
        const maxH = Math.max(...rowClusters.map(item => item.boxH), 100);
        const countInRow = rowClusters.length;
        rowClusters.forEach((item, cIdx) => {
          const bx = (cIdx - (countInRow - 1) / 2) * spacingX;
          const by = currentY + item.boxH / 2;
          const box = {
            name: item.cluster.name,
            color: embedClusterColors[item.cluster.name] || '#6366f1',
            x: bx - boxW / 2, y: by - item.boxH / 2,
            w: boxW, h: item.boxH,
            files: item.files
          };
          embedClusterBoxes.push(box);
          const colWidth = (boxW - 24) / item.colsInside;
          item.files.forEach((f, fi) => {
            const inCol = fi % item.colsInside;
            const inRow = Math.floor(fi / item.colsInside);
            f.targetX = box.x + 16 + inCol * colWidth;
            f.targetY = box.y + 36 + inRow * 22;
            f.radius = 5.5;
          });
        });
        currentY += maxH + 50;
      });
    } else if (layout === 'hierarchy') {
      const levels = new Map();
      embedSimNodes.forEach(n => {
        let depth = 1;
        const idLower = n.id.toLowerCase();
        if (n.importedBy.length === 0 || idLower.includes('ui') || idLower.includes('view') || idLower.includes('main') || idLower.includes('index') || idLower.includes('bot')) {
          depth = 0; // Presentation & Entrypoints
        } else if (n.imports.length === 0 || idLower.endsWith('.json') || idLower.endsWith('.md') || idLower.endsWith('.sql') || idLower.endsWith('.css') || idLower.endsWith('.html')) {
          depth = 3; // Leaf configs, assets & docs
        } else if (n.isHub || n.score >= 5) {
          depth = 1; // Core hubs & controllers
        } else {
          depth = 2; // Mid services & utilities
        }
        if (!levels.has(depth)) levels.set(depth, []);
        levels.get(depth).push(n);
      });
      const depths = [0, 1, 2, 3];
      const tierSpacing = 160;
      depths.forEach((d, tierIdx) => {
        const nodesAtLvl = levels.get(d) || [];
        const count = nodesAtLvl.length;
        const colsPerRow = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(count * 2.2))));
        const rowsInTier = Math.ceil(count / colsPerRow);
        const yBase = (tierIdx - 1.5) * tierSpacing;
        nodesAtLvl.forEach((n, idx) => {
          n.radius = Math.max(6, Math.min(13, 5 + Math.sqrt(n.score) * 1.6));
          const subRow = Math.floor(idx / colsPerRow);
          const inRow = idx % colsPerRow;
          const itemsInThisRow = Math.min(colsPerRow, count - subRow * colsPerRow);
          n.targetX = (inRow - (itemsInThisRow - 1) / 2) * 105;
          n.targetY = yBase + (subRow - (rowsInTier - 1) / 2) * 44;
        });
      });
      relaxEmbedCollisions();
    }

    embedSimNodes.forEach(n => {
      n.x = n.targetX;
      n.y = n.targetY;
    });
    embedModuleHubs.forEach(m => {
      m.x = m.targetX;
      m.y = m.targetY;
    });
  }

  function embedFitToViewport() {
    if (!embedSimNodes.length) return;
    if (!embedCanvas) embedCanvas = $('embedGraphCanvas');
    if (!embedCanvas) return;
    const rect = embedCanvas.getBoundingClientRect();
    const rw = rect.width > 0 ? rect.width : 400;
    const rh = rect.height > 0 ? rect.height : 400;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    embedSimNodes.forEach(n => {
      const nx = typeof n.x === 'number' && !isNaN(n.x) ? n.x : (n.targetX || 0);
      const ny = typeof n.y === 'number' && !isNaN(n.y) ? n.y : (n.targetY || 0);
      minX = Math.min(minX, nx - 35);
      maxX = Math.max(maxX, nx + 35);
      minY = Math.min(minY, ny - 35);
      maxY = Math.max(maxY, ny + 35);
    });
    if (!isFinite(minX) || !isFinite(maxX)) {
      minX = -200; maxX = 200; minY = -200; maxY = 200;
    }
    const spanX = Math.max(220, maxX - minX);
    const spanY = Math.max(220, maxY - minY);
    embedZoom = Math.min(2.0, Math.max(0.35, Math.min((rw - 60) / spanX, (rh - 60) / spanY)));
    embedCamX = -(minX + maxX) / 2 * embedZoom;
    embedCamY = -(minY + maxY) / 2 * embedZoom;
  }

  function resizeAndRedrawGraph() {
    embedCanvas = $('embedGraphCanvas');
    if (!embedCanvas) return;
    embedCtx = embedCanvas.getContext('2d');
    const rect = embedCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const tw = Math.floor(rect.width * dpr);
    const th = Math.floor(rect.height * dpr);
    if (embedCanvas.width !== tw || embedCanvas.height !== th) {
      embedCanvas.width = tw;
      embedCanvas.height = th;
    }
  }

  function startEmbeddedLoop() {
    if (embedRaf) {
      cancelAnimationFrame(embedRaf);
      embedRaf = 0;
    }
    embedCanvas = $('embedGraphCanvas');
    if (embedCanvas && !embedCtx) {
      embedCtx = embedCanvas.getContext('2d');
    }
    drawEmbeddedGraph();
  }

  function drawEmbeddedGraph() {
    const graphSec = $('graphifyViewSection');
    if (graphSec && graphSec.hidden) {
      embedRaf = 0;
      return;
    }

    if (!embedCanvas) embedCanvas = $('embedGraphCanvas');
    if (embedCanvas && !embedCtx) embedCtx = embedCanvas.getContext('2d');

    // Keep animation loop ticking as long as graphify view is visible
    embedRaf = requestAnimationFrame(drawEmbeddedGraph);

    if (!embedCanvas || !embedCtx || !embeddedGraphData) return;
    const ctx = embedCtx;
    const dpr = window.devicePixelRatio || 1;
    const rect = embedCanvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    if (width <= 0 || height <= 0) return;

    const tw = Math.floor(width * dpr);
    const th = Math.floor(height * dpr);
    if (embedCanvas.width !== tw || embedCanvas.height !== th) {
      embedCanvas.width = tw;
      embedCanvas.height = th;
      if (embedCamX === 0 && embedCamY === 0) {
        embedFitToViewport();
      }
    }

    const isLight = document.body.classList.contains('vscode-light');

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.translate(width / 2 + embedCamX, height / 2 + embedCamY);
    ctx.scale(embedZoom, embedZoom);

    // 1. Layout Mode Specific Background Elements
    if (embedCurrentLayout === 'star') {
      for (const m of embedModuleHubs) {
        ctx.save();
        const isModuleActive = (embedSelectedNode && embedSelectedNode.cluster === m.name) || (embedHoveredNode && embedHoveredNode.cluster === m.name);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = m.color;
        ctx.lineWidth = isModuleActive ? 4.8 : 2.6;
        if (isModuleActive) {
          ctx.shadowColor = m.color;
          ctx.shadowBlur = 16;
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.55;
        }
        ctx.stroke();

        if (isModuleActive) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(m.x, m.y);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.6;
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 6;
          ctx.stroke();
        }

        const files = (embedFilesByCluster.get(m.name) || []).map(f => embedNodeById.get(f.id)).filter(Boolean);
        for (const f of files) {
          const isSelectedFile = (embedSelectedNode && embedSelectedNode.id === f.id);
          const isHoveredFile = (embedHoveredNode && embedHoveredNode.id === f.id);
          ctx.save();
          if (isSelectedFile || isHoveredFile) {
            const glowColor = isSelectedFile ? '#38bdf8' : '#67e8f9';
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(f.x, f.y);
            ctx.strokeStyle = glowColor;
            ctx.lineWidth = 3.8;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 18;
            ctx.globalAlpha = 1;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(f.x, f.y);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.6;
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 6;
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(f.x, f.y);
            ctx.strokeStyle = isLight ? 'rgba(31, 30, 29, 0.2)' : 'rgba(236, 233, 228, 0.18)';
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.5;
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
      }

      // Draw Center Star
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#6366f1';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = '600 11px system-ui';
      ctx.fillStyle = isLight ? '#1f1e1d' : '#ece9e4';
      ctx.textAlign = 'center';
      ctx.fillText('⭐ ' + embeddedGraphData.workspaceName, 0, 32);
      ctx.restore();

      // Draw Module Hubs
      for (const m of embedModuleHubs) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(m.x, m.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = m.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = '600 10px system-ui';
        ctx.fillStyle = isLight ? '#1f1e1d' : '#ece9e4';
        ctx.textAlign = 'center';
        ctx.fillText('📦 ' + m.name + ' (' + m.count + ')', m.x, m.y + (m.y >= 0 ? 20 : -14));
        ctx.restore();
      }
    } else if (embedCurrentLayout === 'diagram') {
      for (const box of embedClusterBoxes) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 8);
        ctx.fillStyle = isLight ? '#ffffff' : '#1f1f1e';
        ctx.fill();
        ctx.strokeStyle = isLight ? '#dcd9ce' : '#3a3a37';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, 24, [8, 8, 0, 0]);
        ctx.fillStyle = box.color;
        ctx.fill();
        ctx.font = '600 10.5px system-ui';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('📦 ' + box.name + ' (' + box.files.length + ')', box.x + 8, box.y + 16);
        ctx.restore();
      }
    }

    // 2. Inter-file Dependencies (Luminous Glowing Laser Lines)
    const outgoingTargets = new Set();
    const incomingSources = new Set();
    if (embedSelectedNode) {
      for (const e of embeddedGraphData.edges) {
        if (e.from === embedSelectedNode.id) outgoingTargets.add(e.to);
        else if (e.to === embedSelectedNode.id) incomingSources.add(e.from);
      }
    }

    for (const edge of embeddedGraphData.edges) {
      const a = embedNodeById.get(edge.from);
      const b = embedNodeById.get(edge.to);
      if (!a || !b) continue;

      const isCycle = embedCyclePairs.has(edge.from + '<->' + edge.to);
      const isOutgoing = embedSelectedNode && embedSelectedNode.id === a.id;
      const isIncoming = embedSelectedNode && embedSelectedNode.id === b.id;
      const active = isOutgoing || isIncoming;
      const hovered = embedHoveredNode && (embedHoveredNode.id === a.id || embedHoveredNode.id === b.id);

      if (!active && !hovered && !isCycle) {
        if (embedSelectedNode) continue;
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        const midX = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
        const midY = (a.y + b.y) / 2 + (a.x - b.x) * 0.12;
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(midX, midY, b.x, b.y);
        ctx.strokeStyle = isLight ? '#64748b' : '#94a3b8';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        continue;
      }

      ctx.save();
      ctx.globalAlpha = active || hovered || isCycle ? 1 : 0.2;
      ctx.beginPath();
      const midX = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
      const midY = (a.y + b.y) / 2 + (a.x - b.x) * 0.12;
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(midX, midY, b.x, b.y);

      if (isCycle) {
        ctx.strokeStyle = '#f0746a';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
      } else if (active) {
        const beamColor = isOutgoing ? '#38bdf8' : '#4ade80';
        ctx.strokeStyle = beamColor;
        ctx.lineWidth = 3.6;
        ctx.shadowColor = beamColor;
        ctx.shadowBlur = 16;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(midX, midY, b.x, b.y);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 6;
        ctx.stroke();
      } else if (hovered) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.stroke();
      }

      // Arrowhead
      const dx = b.x - midX, dy = b.y - midY;
      const angle = Math.atan2(dy, dx);
      const arrowDist = b.radius + 2;
      const ax = b.x - Math.cos(angle) * arrowDist;
      const ay = b.y - Math.sin(angle) * arrowDist;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - Math.cos(angle - 0.4) * 7, ay - Math.sin(angle - 0.4) * 7);
      ctx.lineTo(ax - Math.cos(angle + 0.4) * 7, ay - Math.sin(angle + 0.4) * 7);
      if (active) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = isOutgoing ? '#38bdf8' : '#4ade80';
        ctx.shadowBlur = 12;
      } else {
        ctx.fillStyle = ctx.strokeStyle;
      }
      ctx.fill();
      ctx.restore();
    }

    // 3. Draw File Nodes
    for (const n of embedSimNodes) {
      const isSelected = embedSelectedNode && embedSelectedNode.id === n.id;
      const isHovered = embedHoveredNode && embedHoveredNode.id === n.id;
      const isTarget = outgoingTargets.has(n.id);
      const isSource = incomingSources.has(n.id);

      if (embedSelectedNode) {
        ctx.globalAlpha = (isSelected || isTarget || isSource) ? 1 : 0.22;
      } else {
        ctx.globalAlpha = 1;
      }

      // Target Halo (cyan)
      if (isTarget) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.restore();
      }

      // Source Halo (green)
      if (isSource) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = '#4ade80';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.restore();
      }

      // Outer Selection Ring
      if (isSelected || isHovered) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#67e8f9';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = isSelected ? '#38bdf8' : '#67e8f9';
        ctx.shadowBlur = 14;
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.28)' : 'rgba(56, 189, 248, 0.16)';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // God-Node Crown Halo
      if (n.isHub) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(224, 169, 82, 0.6)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // Circle Body
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : (isLight ? '#faf9f5' : '#171716');
      ctx.lineWidth = isSelected ? 2.2 : 1.1;
      ctx.stroke();

      // Label
      ctx.font = (isSelected || n.isHub ? '600 ' : '') + '10px system-ui';
      ctx.fillStyle = isLight ? '#1f1e1d' : '#ece9e4';
      ctx.textAlign = 'left';
      let label = (n.isHub ? '👑 ' : '') + n.label;
      if (label.length > 16) label = label.slice(0, 14) + '…';
      ctx.fillText(label, n.x + n.radius + 4, n.y + 3);
    }

    ctx.restore();
  }

  function renderEmbedDrawer(node) {
    const tabSelected = $('embedTabSelected');
    const tabHealth = $('embedTabHealth');
    const tabExport = $('embedTabExport');
    if (!tabSelected || !tabHealth || !tabExport || !embeddedGraphData) return;

    // 1. Health Tab
    tabHealth.replaceChildren();
    const gauge = document.createElement('div');
    gauge.className = 'gauge-box';
    gauge.style.padding = '8px 10px';
    gauge.innerHTML = '<div><strong>' + gtr('archHealth') + '</strong><div class="sub">' + gtr('archHealthSub') + '</div></div><span class="gauge-val" style="font-size:18px;">' + embeddedGraphData.healthScore + '</span>';
    tabHealth.appendChild(gauge);

    const hubTitle = document.createElement('div');
    hubTitle.className = 'section-title';
    hubTitle.textContent = gtr('hubsTitle');
    tabHealth.appendChild(hubTitle);
    embeddedGraphData.hubs.forEach(h => {
      const row = document.createElement('div');
      row.className = 'hub-row';
      row.innerHTML = '<span>' + h.id + '</span><strong>' + h.score + '</strong>';
      row.onclick = () => {
        const target = embedNodeById.get(h.id);
        if (target) {
          embedSelectedNode = target;
          embedCamX = -target.x * embedZoom;
          embedCamY = -target.y * embedZoom;
          renderEmbedDrawer(target);
          switchEmbedDrawerTab('embedTabSelected');
        }
      };
      tabHealth.appendChild(row);
    });

    if (embeddedGraphData.cycles.length > 0) {
      const cycleTitle = document.createElement('div');
      cycleTitle.className = 'section-title';
      cycleTitle.textContent = gtr('cyclesTitleSec') + ' (' + embeddedGraphData.cycles.length + ')';
      tabHealth.appendChild(cycleTitle);
      embeddedGraphData.cycles.forEach(c => {
        const row = document.createElement('div');
        row.className = 'cycle-row';
        row.innerHTML = '<strong>' + gtr('loopPrefix') + '</strong> ' + c.join(' ⟷ ');
        row.onclick = () => {
          const target = embedNodeById.get(c[0]);
          if (target) {
            embedSelectedNode = target;
            embedCamX = -target.x * embedZoom;
            embedCamY = -target.y * embedZoom;
            renderEmbedDrawer(target);
          }
        };
        tabHealth.appendChild(row);
      });
    }

    // 2. Export Tab
    tabExport.replaceChildren();
    const expCard = document.createElement('div');
    expCard.innerHTML = '<div class="section-title">' + gtr('exportTitle') + '</div><p class="sub" style="margin-bottom:8px;">' + gtr('exportDesc') + '</p>';
    const expBtn = document.createElement('button');
    expBtn.className = 'btn primary';
    expBtn.style.width = '100%';
    expBtn.textContent = gtr('exportBtn');
    expBtn.onclick = () => vscode.postMessage({ type: 'exportArchitectureReport' });
    tabExport.append(expCard, expBtn);

    // 3. Selected Node Tab
    tabSelected.replaceChildren();
    if (!node) {
      const placeholder = document.createElement('div');
      placeholder.innerHTML = '<div class="sub" style="text-align:center;padding:16px 0;">' + gtr('clickNodeHint') + '</div>';
      tabSelected.appendChild(placeholder);
      return;
    }

    const header = document.createElement('div');
    header.innerHTML = '<h3 style="font-size:13px;">' + (node.isHub ? '👑 ' : '') + node.id + '</h3><div class="sub">' + gtr('clusterLabel') + ' ' + node.cluster + ' · ' + node.lines + ' ' + gtr('linesUnit') + ' · ' + gtr('scoreLabel') + ' ' + node.score + '</div>';
    tabSelected.appendChild(header);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.marginTop = '6px';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn primary';
    openBtn.style.padding = '3px 8px';
    openBtn.style.fontSize = '11px';
    openBtn.textContent = gtr('openFile');
    openBtn.onclick = () => vscode.postMessage({ type: 'openFile', file: node.id });

    const askBtn = document.createElement('button');
    askBtn.className = 'btn';
    askBtn.style.padding = '3px 8px';
    askBtn.style.fontSize = '11px';
    askBtn.textContent = gtr('analyzeImpact');
    askBtn.onclick = () => {
      switchViewTab('chat');
      input.value = gtr('askPrompt', { file: node.id });
      autosize();
      send();
    };
    actions.append(openBtn, askBtn);
    tabSelected.appendChild(actions);

    const addSection = (titleText, items, clickable) => {
      const st = document.createElement('div');
      st.className = 'section-title';
      st.style.marginTop = '6px';
      st.textContent = titleText + ' (' + items.length + ')';
      tabSelected.appendChild(st);
      const list = document.createElement('div');
      list.className = 'chip-list';
      if (!items.length) {
        const empty = document.createElement('span');
        empty.className = 'sub';
        empty.textContent = gtr('none');
        list.appendChild(empty);
      } else {
        items.forEach(item => {
          const c = document.createElement('span');
          c.className = 'chip';
          c.style.fontSize = '10px';
          c.textContent = item;
          if (clickable) {
            c.onclick = () => {
              const target = embedNodeById.get(item);
              if (target) {
                embedSelectedNode = target;
                embedCamX = -target.x * embedZoom;
                embedCamY = -target.y * embedZoom;
                renderEmbedDrawer(target);
              }
            };
          }
          list.appendChild(c);
        });
      }
      tabSelected.appendChild(list);
    };

    addSection(gtr('symbolsSection'), node.symbols, false);
    addSection(gtr('importedBySection'), node.importedBy, true);
    addSection(gtr('importsSection'), node.imports, true);
  }

  function switchEmbedDrawerTab(tabId) {
    document.querySelectorAll('.embed-drawer-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.embed-pane').forEach(p => {
      p.hidden = p.id !== tabId;
    });
  }

  let embedEventsBound = false;
  function bindEmbedEventsOnce() {
    embedCanvas = $('embedGraphCanvas');
    if (embedCanvas && !embedCtx) {
      embedCtx = embedCanvas.getContext('2d');
    }
    if (embedEventsBound) return;
    embedEventsBound = true;

    $('embedBtnStar')?.addEventListener('click', () => {
      document.querySelectorAll('#embedLayoutSegmented .embed-seg-btn').forEach(b => b.classList.remove('active'));
      $('embedBtnStar')?.classList.add('active');
      applyEmbedLayout('star');
      embedFitToViewport();
    });
    $('embedBtnDiagram')?.addEventListener('click', () => {
      document.querySelectorAll('#embedLayoutSegmented .embed-seg-btn').forEach(b => b.classList.remove('active'));
      $('embedBtnDiagram')?.classList.add('active');
      applyEmbedLayout('diagram');
      embedFitToViewport();
    });
    $('embedBtnHierarchy')?.addEventListener('click', () => {
      document.querySelectorAll('#embedLayoutSegmented .embed-seg-btn').forEach(b => b.classList.remove('active'));
      $('embedBtnHierarchy')?.classList.add('active');
      applyEmbedLayout('hierarchy');
      embedFitToViewport();
    });

    $('embedFocusBtn')?.addEventListener('click', () => {
      embedFocus1HopMode = !embedFocus1HopMode;
      $('embedFocusBtn').classList.toggle('active', embedFocus1HopMode);
    });
    $('embedCyclesBtn')?.addEventListener('click', () => {
      embedCyclesHighlightMode = !embedCyclesHighlightMode;
      $('embedCyclesBtn').classList.toggle('active', embedCyclesHighlightMode);
      if (embedCyclesHighlightMode) switchEmbedDrawerTab('embedTabHealth');
    });

    $('embedZoomIn')?.addEventListener('click', () => {
      embedZoom = Math.min(3, embedZoom * 1.25);
    });
    $('embedZoomOut')?.addEventListener('click', () => {
      embedZoom = Math.max(0.2, embedZoom * 0.8);
    });
    $('embedZoomFit')?.addEventListener('click', embedFitToViewport);

    document.querySelectorAll('.embed-drawer-tab').forEach(btn => {
      btn.addEventListener('click', () => switchEmbedDrawerTab(btn.dataset.tab));
    });

    $('embedDrawerToggle')?.addEventListener('click', () => {
      const drawer = $('embedInspectorDrawer');
      const isCol = drawer.classList.toggle('collapsed');
      $('embedDrawerToggle').textContent = isCol ? '▲' : '▼';
    });

    $('embedRefreshBtn')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshGraphify' });
    });
    $('embedPopoutBtn')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openGraphifyInTab' });
    });

    const canvas = $('embedGraphCanvas');
    const tooltip = $('embedTooltip');
    if (!canvas) return;

    function screenToWorld(sx, sy) {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2 + embedCamX;
      const cy = rect.height / 2 + embedCamY;
      return {
        x: (sx - cx) / embedZoom,
        y: (sy - cy) / embedZoom
      };
    }

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const w = screenToWorld(sx, sy);
      const hit = embedSimNodes.find(n => Math.hypot(n.x - w.x, n.y - w.y) <= n.radius + 5);
      if (hit) {
        embedDraggingNode = hit;
        embedSelectedNode = hit;
        renderEmbedDrawer(hit);
        switchEmbedDrawerTab('embedTabSelected');
      } else {
        embedPanning = true;
      }
      embedLastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!canvas || $('graphifyViewSection').hidden) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const w = screenToWorld(sx, sy);
      if (embedDraggingNode) {
        embedDraggingNode.x = w.x;
        embedDraggingNode.y = w.y;
        embedDraggingNode.targetX = w.x;
        embedDraggingNode.targetY = w.y;
      } else if (embedPanning) {
        embedCamX += e.clientX - embedLastMouse.x;
        embedCamY += e.clientY - embedLastMouse.y;
        embedLastMouse = { x: e.clientX, y: e.clientY };
      } else if (sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height) {
        embedHoveredNode = embedSimNodes.find(n => Math.hypot(n.x - w.x, n.y - w.y) <= n.radius + 5) || null;
        if (embedHoveredNode && tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = (sx + 10) + 'px';
          tooltip.style.top = (sy - 8) + 'px';
          tooltip.innerHTML = '<strong>' + embedHoveredNode.label + '</strong><span>' + embedHoveredNode.cluster + ' · ' + embedHoveredNode.lines + ' ' + gtr('linesUnit') + '<br>' + embedHoveredNode.importedBy.length + ' ' + gtr('dependentsTooltip') + ' · ' + embedHoveredNode.imports.length + ' ' + gtr('importsTooltip') + '</span>';
        } else if (tooltip) {
          tooltip.style.display = 'none';
        }
      }
    });

    window.addEventListener('mouseup', () => {
      embedDraggingNode = null;
      embedPanning = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      embedZoom = Math.max(0.2, Math.min(3, embedZoom * factor));
    }, { passive: false });

    window.addEventListener('resize', () => {
      if (!$('graphifyViewSection').hidden) {
        resizeAndRedrawGraph();
        embedFitToViewport();
        startEmbeddedLoop();
      }
    });

    startEmbeddedLoop();
  }

  document.querySelectorAll('.compare-choice').forEach((button) => {
    button.addEventListener('click', () => {
      vscode.postMessage({ type: 'compareSelect', id: button.dataset.id });
    });
  });

  vscode.postMessage({ type: 'ready' });
})();

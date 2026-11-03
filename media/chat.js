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

  // Minimal, safe rendering: code fences, inline code, bold, line breaks.
  function render(text) {
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
        return escapeHtml(part)
          .replace(/`([^`\n]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
      })
      .join('');
  }

  document.addEventListener('click', (e) => {
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
      historyStatus.textContent = s('ui.loadingHistory');
      historyList.replaceChildren();
      commitDetail.hidden = true;
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
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>'
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
      })
    );
    main.hidden = false;
    $('plusSub').hidden = true;
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
  $('undo').addEventListener('click', () => vscode.postMessage({ type: 'undo' }));
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
        (msg.messages || []).forEach((message) => {
          if (message.role === 'user' && !message.content.startsWith('[')) {
            add('user', message.content);
          } else if (message.role === 'assistant') {
            const el = document.createElement('div');
            el.className = 'msg assistant';
            el.innerHTML = render(message.content);
            messages.appendChild(el);
          }
        });
        empty.hidden = messages.querySelectorAll('.msg').length > 0;
        scrollDown();
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
          browser_action: 'monitor'
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
    }
  });

  document.querySelectorAll('.compare-choice').forEach((button) => {
    button.addEventListener('click', () => {
      vscode.postMessage({ type: 'compareSelect', id: button.dataset.id });
    });
  });

  vscode.postMessage({ type: 'ready' });
})();

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

  let strings = {};
  let busy = false;
  let bubble = null; // current assistant bubble
  let bubbleText = '';
  let lastTool = null;

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
          const code = nl >= 0 ? part.slice(nl + 1) : part;
          return '<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>';
        }
        return escapeHtml(part)
          .replace(/`([^`\n]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
      })
      .join('');
  }

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }

  function add(className, text) {
    $('empty').hidden = true;
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

  function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    add('user', text);
    input.value = '';
    vscode.postMessage({ type: 'send', text });
  }

  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  $('model').addEventListener('click', () => vscode.postMessage({ type: 'selectModel' }));
  $('historyToggle').addEventListener('click', () => showHistory(historyPanel.hidden));
  $('historyClose').addEventListener('click', () => showHistory(false));
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
        applyStrings();
        $('modelName').textContent = msg.model || s('ui.noModel');
        break;
      case 'metrics':
        metrics.hidden = false;
        $('metricTime').textContent = formatDuration(msg.durationMs);
        $('metricTokens').textContent = msg.inputTokens + ' in / ' + msg.outputTokens + ' out';
        $('metricSpeed').textContent = msg.tokensPerSecond.toFixed(1) + ' tok/s';
        $('metricMemory').textContent = msg.memory === 'unavailable' ? s('ui.memoryUnavailable') : msg.memory;
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
      case 'assistantStart':
        $('empty').hidden = true;
        bubble = document.createElement('div');
        bubble.className = 'msg assistant';
        bubbleText = '';
        messages.appendChild(bubble);
        break;
      case 'assistantText':
        if (bubble) {
          bubbleText = msg.text;
          bubble.innerHTML = render(bubbleText);
          scrollDown();
        }
        break;
      case 'assistantEnd':
        if (bubble && !bubbleText.trim()) bubble.remove();
        bubble = null;
        break;
      case 'toolCall': {
        lastTool = document.createElement('details');
        lastTool.className = 'msg tool';
        const summary = document.createElement('summary');
        summary.textContent = msg.summary;
        lastTool.appendChild(summary);
        messages.appendChild(lastTool);
        scrollDown();
        break;
      }
      case 'toolResult':
        if (lastTool) {
          if (!msg.ok) lastTool.classList.add('failed');
          const pre = document.createElement('pre');
          pre.textContent = msg.output;
          lastTool.appendChild(pre);
          lastTool = null;
          scrollDown();
        }
        break;
      case 'error':
        add('error', msg.text);
        break;
      case 'cleared':
        messages.querySelectorAll('.msg').forEach((el) => el.remove());
        $('empty').hidden = false;
        bubble = null;
        lastTool = null;
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();

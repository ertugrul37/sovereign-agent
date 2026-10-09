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
  const modePanel = $('modePanel');
  const approvalPanel = $('approvalPanel');
  const dictationPanel = $('dictationPanel');

  let strings = {};
  let busy = false;
  let bubble = null; // current assistant bubble
  let bubbleText = '';
  let lastTool = null;
  let comparisonTexts = {};
  let selectedMode = 'Code';
  let recognition = null;
  let dictating = false;
  let autoApproveNext = false;
  const metricHistory = [];

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

  function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    add('user', text);
    input.value = '';
    vscode.postMessage({ type: 'send', text, mode: selectedMode });
  }

  function closePopovers(except) {
    [modelPanel, modePanel, approvalPanel].forEach((panel) => {
      if (panel !== except) panel.hidden = true;
    });
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

  function toggleDictation() {
    dictationPanel.hidden = !dictationPanel.hidden;
    if (!dictationPanel.hidden) startDictation();
    else stopDictation();
  }

  function startDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $('status').textContent = s('ui.dictationUnavailable');
      return;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.onstart = () => {
      dictating = true;
      $('mic').classList.add('active');
      $('status').textContent = s('ui.listening');
    };
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript) input.value = (input.value + ' ' + transcript).trim();
    };
    recognition.onerror = () => {
      $('status').textContent = s('ui.dictationError');
      stopDictation();
    };
    recognition.onend = () => {
      if (dictating) recognition.start();
    };
    recognition.start();
  }

  function stopDictation() {
    dictating = false;
    $('mic').classList.remove('active');
    if (recognition) {
      recognition.onend = null;
      recognition.stop();
      recognition = null;
    }
  }

  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  $('model').addEventListener('click', () => {
    const open = modelPanel.hidden;
    closePopovers(modelPanel);
    modelPanel.hidden = !open;
    $('model').setAttribute('aria-expanded', String(!modelPanel.hidden));
    if (open) vscode.postMessage({ type: 'modelMenu' });
  });
  $('compareModel').addEventListener('click', () => vscode.postMessage({ type: 'selectCompareModel' }));
  $('compareModelOption').addEventListener('click', () => vscode.postMessage({ type: 'selectCompareModel' }));
  $('mode').addEventListener('click', () => {
    const open = modePanel.hidden;
    closePopovers(modePanel);
    modePanel.hidden = !open;
    $('mode').setAttribute('aria-expanded', String(!modePanel.hidden));
  });
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
  document.querySelectorAll('#modePanel [data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedMode = button.dataset.mode;
      $('modeName').textContent = selectedMode;
      modePanel.hidden = true;
    });
  });
  $('mic').addEventListener('click', toggleDictation);
  $('dictationClose').addEventListener('click', () => {
    dictationPanel.hidden = true;
    stopDictation();
  });
  $('modelSearch').addEventListener('input', () => {
    const query = $('modelSearch').value.toLowerCase();
    document.querySelectorAll('.model-option').forEach((option) => {
      option.hidden = !option.textContent.toLowerCase().includes(query);
    });
  });
  $('undo').addEventListener('click', () => vscode.postMessage({ type: 'undo' }));
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
        $('modelName').textContent = msg.compareModel
          ? (msg.model || s('ui.noModel')) + ' + ' + msg.compareModel
          : (msg.model || s('ui.noModel'));
        break;
      case 'modelOptions':
        renderModelOptions(msg.models || [], msg.selected, msg.error);
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
        $('empty').hidden = messages.querySelectorAll('.msg').length > 0;
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
        $('empty').hidden = true;
        break;
      case 'compareText': {
        comparisonTexts[msg.id] = msg.text;
        const suffix = msg.id[0].toUpperCase() + msg.id.slice(1);
        $('compareText' + suffix).innerHTML = render(msg.text);
        scrollDown();
        break;
      }
      case 'compareCandidateDone': {
        const suffix = msg.id[0].toUpperCase() + msg.id.slice(1);
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

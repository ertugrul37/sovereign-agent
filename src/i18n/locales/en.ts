export const en = {
  // Webview UI
  'ui.title': 'Sovereign Agent',
  'ui.placeholder': 'Ask about your code… (Enter to send, Shift+Enter for a new line)',
  'ui.send': 'Send',
  'ui.stop': 'Stop',
  'ui.you': 'You',
  'ui.agent': 'Agent',
  'ui.emptyTitle': 'Your code stays on your machine.',
  'ui.emptyBody': 'Sovereign Agent only talks to a local model. No cloud, no telemetry.',
  'ui.noModel': 'No model selected',
  'ui.changeModel': 'Change model',
  'ui.working': 'Working…',
  'ui.toolOutput': 'Output',
  'ui.history': 'Git history',
  'ui.timeline': 'Timeline',
  'ui.close': 'Close',
  'ui.response': 'Response',
  'ui.tokens': 'Tokens',
  'ui.speed': 'Speed',
  'ui.memory': 'RAM',
  'ui.memoryUnavailable': 'Provider N/A',
  'ui.loadingHistory': 'Reading local Git history…',
  'ui.noHistory': 'No Git history found in this workspace.',
  'ui.historyHint': 'Select a commit to inspect its summary.',
  'ui.undo': 'Undo last change',
  'ui.performance': 'Performance',
  'ui.live': 'Live',
  'ui.durationHint': 'end to end',
  'ui.tokenHint': 'prompt / reply',
  'ui.speedHint': 'generation rate',
  'ui.memoryHint': 'runtime status',
  'ui.trend': 'Recent response trend',
  'ui.chartSpeed': 'speed',
  'ui.chartDuration': 'duration',

  // Approvals
  'approval.write': 'Allow the agent to write to "{path}"?',
  'approval.writeDetail': '{bytes} bytes will be written.',
  'approval.command': 'Allow the agent to run this command?',
  'approval.replace': 'Allow the agent to edit "{path}"?',
  'approval.replaceDetail': 'Only the exact matching text will be replaced.',
  'approval.allow': 'Allow',
  'approval.deny': 'Deny',
  'approval.mcp': 'Allow the local MCP server to start?',
  'approval.applyChange': 'Apply the reviewed change to "{path}"?',
  'approval.applyChangeDetail': 'Review the diff before confirming.',

  // Errors and notices
  'error.notLocal': 'Refusing to connect to a non-local address: {url}. Sovereign Agent only talks to local models. Use localhost, or enable sovereignAgent.allowLanHosts for a machine on your LAN.',
  'error.connection': 'Could not reach the model server at {url}. Is Ollama, llama.cpp or LM Studio running?',
  'error.http': 'The model server returned an error ({status}): {detail}',
  'error.noModel': 'No model selected. Choose a local model first.',
  'error.emptyResponse': 'The model returned an empty response.',
  'error.maxIterations': 'Stopped after {count} steps. Send a message to continue.',
  'error.invalidUrl': 'Invalid server address: {url}',
  'editor.noSelection': 'Select code in the active editor first.',

  // Model picker
  'model.pickPlaceholder': 'Select a local model',
  'model.noneFound': 'No models found on the server. Pull or load a model first.',
  'model.set': 'Model set to {model}.'
  ,
  'history.noWorkspace': 'Open a workspace to inspect Git history.',
  'history.unavailable': 'Git history is unavailable in this workspace.',
  'history.invalidCommit': 'Invalid commit identifier.'
  ,'checkpoint.none': 'There is no change to undo.'
  ,'checkpoint.restored': 'Restored {path}.'
  ,'checkpoint.preview': 'Change preview'
};

export type MessageKey = keyof typeof en;

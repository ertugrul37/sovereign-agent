import { ChatMessage, LlmProvider } from '../llm/types';
import { t } from '../i18n';
import { buildSystemPrompt } from './prompt';
import { parseToolCall, ToolCall, visibleText } from './protocol';
import { executeTool, ToolContext, ToolResult, clip } from './tools';

export interface AgentHooks {
  onAssistantStart(): void;
  /** Receives the full visible text of the current reply each time it grows. */
  onAssistantText(visible: string): void;
  onAssistantEnd(): void;
  onToolCall(call: ToolCall): void;
  onToolResult(call: ToolCall, result: ToolResult): void;
  onError(message: string): void;
}

export interface RunSettings {
  model: string;
  temperature: number;
  contextLength: number;
  maxIterations: number;
  workspaceName: string | undefined;
  workspaceInstructions?: string;
  editorContext?: string;
  mode?: string;
}

export class Agent {
  private history: ChatMessage[] = [];

  getHistory(): ChatMessage[] {
    return this.history.map((message) => ({ ...message }));
  }

  restoreHistory(history: ChatMessage[]): void {
    this.history = history
      .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.length <= 40000)
      .slice(-40)
      .map((message) => ({ ...message }));
  }

  adoptHistory(history: ChatMessage[]): void {
    this.restoreHistory(history);
  }

  reset(): void {
    this.history = [];
  }

  async run(
    userText: string,
    provider: LlmProvider,
    settings: RunSettings,
    toolContext: ToolContext,
    hooks: AgentHooks,
    signal: AbortSignal
  ): Promise<void> {
    this.history.push({ role: 'user', content: userText });

    for (let step = 0; step < settings.maxIterations; step++) {
      if (signal.aborted) {
        return;
      }
      const system: ChatMessage = {
        role: 'system',
        content: buildSystemPrompt(settings.workspaceName, settings.workspaceInstructions, settings.editorContext, settings.mode)
      };
      this.trimHistory(system, settings.contextLength);

      hooks.onAssistantStart();
      const stopEarly = new AbortController();
      const forwardAbort = () => stopEarly.abort();
      signal.addEventListener('abort', forwardAbort, { once: true });

      let full = '';
      try {
        await provider.chat([system, ...this.history], {
          model: settings.model,
          temperature: settings.temperature,
          contextLength: settings.contextLength,
          signal: stopEarly.signal,
          onToken: (token) => {
            full += token;
            hooks.onAssistantText(visibleText(full));
            // Small models love to keep going and invent tool results: stop at the first complete call.
            if (parseToolCall(full)) {
              stopEarly.abort();
            }
          }
        });
      } finally {
        signal.removeEventListener('abort', forwardAbort);
      }

      if (signal.aborted) {
        hooks.onAssistantEnd();
        return;
      }

      const call = parseToolCall(full);
      const stored = call ? full.slice(0, call.endIndex) : full;
      hooks.onAssistantText(visibleText(stored));
      hooks.onAssistantEnd();

      if (!stored.trim()) {
        hooks.onError(t('error.emptyResponse'));
        return;
      }
      this.history.push({ role: 'assistant', content: stored });
      if (!call) {
        return;
      }

      hooks.onToolCall(call);
      const result = await executeTool(call, toolContext);
      hooks.onToolResult(call, result);
      this.history.push({
        role: 'user',
        content: `[${call.name} ${result.ok ? 'result' : 'error'}]\n${clip(result.output)}`
      });
    }

    hooks.onError(t('error.maxIterations', { count: settings.maxIterations }));
  }

  /** Drops the oldest user/assistant pairs when the conversation outgrows the context window. */
  private trimHistory(system: ChatMessage, contextLength: number): void {
    const budget = Math.floor(contextLength * 3);
    const size = () => system.content.length + this.history.reduce((n, m) => n + m.content.length, 0);
    while (size() > budget && this.history.length > 2) {
      this.history.splice(0, 2);
    }
  }
}

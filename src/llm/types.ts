export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  temperature: number;
  contextLength: number;
  signal: AbortSignal;
  onToken(token: string): void;
}

export interface LlmProvider {
  /** Streams a reply. If the signal aborts, resolves with what was received so far. */
  chat(messages: ChatMessage[], options: ChatOptions): Promise<void>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}

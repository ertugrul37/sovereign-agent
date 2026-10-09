import { ChatMessage, ChatOptions, LlmProvider } from './types';
import { isAbortError, readLines, request } from './http';

export class OllamaProvider implements LlmProvider {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async chat(messages: ChatMessage[], o: ChatOptions): Promise<void> {
    try {
      const response = await request(
        this.url('/api/chat'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: o.model,
            messages,
            stream: true,
            options: { temperature: o.temperature, num_ctx: o.contextLength }
          }),
          signal: o.signal
        },
        this.baseUrl
      );
      for await (const line of readLines(response)) {
        if (!line.trim()) {
          continue;
        }
        const json = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean };
        if (json.error) {
          throw new Error(json.error);
        }
        if (json.message?.content) {
          o.onToken(json.message.content);
        }
        if (json.done) {
          return;
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      throw err;
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await request(this.url('/api/tags'), { signal }, this.baseUrl);
    const json = (await response.json()) as { models?: { name: string }[] };
    return (json.models ?? []).map((m) => m.name);
  }
}

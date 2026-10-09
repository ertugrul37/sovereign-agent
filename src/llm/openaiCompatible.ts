import { ChatMessage, ChatOptions, LlmProvider } from './types';
import { isAbortError, readLines, request } from './http';

/** Works with llama.cpp's llama-server, LM Studio, vLLM, LocalAI and similar. */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async chat(messages: ChatMessage[], o: ChatOptions): Promise<void> {
    try {
      const response = await request(
        this.url('/chat/completions'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: o.model,
            messages,
            stream: true,
            temperature: o.temperature
          }),
          signal: o.signal
        },
        this.baseUrl
      );
      for await (const line of readLines(response)) {
        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          return;
        }
        if (!data) {
          continue;
        }
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          o.onToken(token);
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
    const response = await request(this.url('/models'), { signal }, this.baseUrl);
    const json = (await response.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id);
  }
}

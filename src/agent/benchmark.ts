import * as vscode from 'vscode';
import { LlmProvider, ChatMessage } from '../llm/types';

export interface BenchmarkReport {
  timestamp: number;
  modelName: string;
  endpoint: string;
  ttftMs: number;
  tokensPerSec: number;
  totalTokens: number;
  toolScore: number; // 0 - 100
  reasoningScore: number; // 0 - 100
  overallGrade: 'S' | 'A' | 'B' | 'C' | 'D';
  recommendations: {
    temperature: number;
    contextSize: number;
    summary: string;
  };
}

export class HardwareBenchmark {
  constructor(private readonly getProvider: () => LlmProvider, private readonly getModelName: () => string) {}

  async runBenchmark(onProgress?: (step: string) => void): Promise<BenchmarkReport> {
    const provider = this.getProvider();
    const model = this.getModelName();

    onProgress?.('⚡ Step 1/3: Testing raw generation speed and latency (TTFT)...');
    const speedRes = await this.testSpeed(provider, model);

    onProgress?.('🛠️ Step 2/3: Testing XML tool-calling adherence...');
    const toolRes = await this.testToolCalling(provider, model);

    onProgress?.('🧠 Step 3/3: Testing reasoning and logic compliance...');
    const reasoningRes = await this.testReasoning(provider, model);

    // Calculate score & grade
    let score = (speedRes.tokPerSec >= 30 ? 30 : (speedRes.tokPerSec / 30) * 30) +
                (toolRes.pass ? 45 : 10) +
                (reasoningRes.pass ? 25 : 5);

    let overallGrade: 'S' | 'A' | 'B' | 'C' | 'D' = 'C';
    if (score >= 90) overallGrade = 'S';
    else if (score >= 75) overallGrade = 'A';
    else if (score >= 60) overallGrade = 'B';
    else if (score >= 40) overallGrade = 'C';
    else overallGrade = 'D';

    const recTemp = toolRes.pass ? 0.15 : 0.05;
    const recContext = speedRes.tokPerSec > 25 ? 16384 : 8192;
    const recSummary = overallGrade === 'S' || overallGrade === 'A'
      ? `Model '${model}' performs excellently on this hardware (${speedRes.tokPerSec.toFixed(1)} tok/s). Ready for complex multi-step autonomous agent tasks.`
      : `Model '${model}' works adequately (${speedRes.tokPerSec.toFixed(1)} tok/s). Recommended lower temperature (${recTemp}) and concise tool templates for optimal accuracy.`;

    return {
      timestamp: Date.now(),
      modelName: model,
      endpoint: 'Local LLM Endpoint',
      ttftMs: speedRes.ttftMs,
      tokensPerSec: speedRes.tokPerSec,
      totalTokens: speedRes.tokens,
      toolScore: toolRes.pass ? 100 : 30,
      reasoningScore: reasoningRes.pass ? 100 : 25,
      overallGrade,
      recommendations: {
        temperature: recTemp,
        contextSize: recContext,
        summary: recSummary
      }
    };
  }

  private async testSpeed(provider: LlmProvider, model: string): Promise<{ ttftMs: number; tokPerSec: number; tokens: number }> {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Generate a short 4-line Fibonacci function in JavaScript.' }
    ];

    const start = Date.now();
    let ttft = 0;
    let tokenCount = 0;
    const abort = new AbortController();

    try {
      await provider.chat(messages, {
        model,
        temperature: 0.1,
        contextLength: 2048,
        signal: abort.signal,
        onToken: (chunk) => {
          if (!ttft) {
            ttft = Date.now() - start;
          }
          tokenCount += Math.max(1, Math.round(chunk.length / 3.8));
          if (tokenCount >= 60) {
            abort.abort();
          }
        }
      });
      const totalTimeSec = (Date.now() - start) / 1000;
      const tokPerSec = totalTimeSec > 0 ? tokenCount / totalTimeSec : 0;
      return { ttftMs: ttft || 200, tokPerSec, tokens: tokenCount };
    } catch {
      return { ttftMs: 1000, tokPerSec: 10, tokens: 20 };
    }
  }

  private async testToolCalling(provider: LlmProvider, model: string): Promise<{ pass: boolean; raw: string }> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are an agent. When the user asks to list files, you MUST respond with: <list_files><path>.</path></list_files>. Output nothing else.'
      },
      { role: 'user', content: 'List files in current directory.' }
    ];

    let reply = '';
    const abort = new AbortController();
    try {
      await provider.chat(messages, {
        model,
        temperature: 0.0,
        contextLength: 2048,
        signal: abort.signal,
        onToken: (chunk) => {
          reply += chunk;
        }
      });
      const pass = reply.includes('<list_files>') && reply.includes('</list_files>');
      return { pass, raw: reply.trim() };
    } catch {
      return { pass: false, raw: '' };
    }
  }

  private async testReasoning(provider: LlmProvider, model: string): Promise<{ pass: boolean }> {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is 15 * 4 + 7? Reply only with the number.' }
    ];

    let reply = '';
    const abort = new AbortController();
    try {
      await provider.chat(messages, {
        model,
        temperature: 0.0,
        contextLength: 2048,
        signal: abort.signal,
        onToken: (chunk) => {
          reply += chunk;
        }
      });
      return { pass: reply.includes('67') };
    } catch {
      return { pass: false };
    }
  }

  /**
   * Applies the benchmark's recommended configuration into user's VS Code settings.
   */
  async applyOptimization(report: BenchmarkReport): Promise<void> {
    const config = vscode.workspace.getConfiguration('sovereignAgent');
    await config.update('temperature', report.recommendations.temperature, vscode.ConfigurationTarget.Global);
    await config.update('contextLength', report.recommendations.contextSize, vscode.ConfigurationTarget.Global);
  }
}

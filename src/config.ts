import * as vscode from 'vscode';
import { resolveLocale } from './i18n';

export type ProviderKind =
  | 'ollama'
  | 'lm-studio'
  | 'llama-cpp'
  | 'localai'
  | 'vllm'
  | 'jan'
  | 'gpt4all'
  | 'openai-compatible';

export interface AgentConfig {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  compareModel: string;
  asrBaseUrl: string;
  asrModel: string;
  language: string;
  temperature: number;
  contextLength: number;
  maxIterations: number;
  requireWriteApproval: boolean;
  requireCommandApproval: boolean;
  allowLanHosts: boolean;
  mcpServers: string;
}

export const DEFAULT_URLS: Record<ProviderKind, string> = {
  ollama: 'http://localhost:11434',
  'lm-studio': 'http://localhost:1234/v1',
  'llama-cpp': 'http://localhost:8080/v1',
  localai: 'http://localhost:8080/v1',
  vllm: 'http://localhost:8000/v1',
  jan: 'http://localhost:1337/v1',
  gpt4all: 'http://localhost:4891/v1',
  'openai-compatible': 'http://localhost:1234/v1'
};

export function getConfig(): AgentConfig {
  const c = vscode.workspace.getConfiguration('sovereignAgent');
  const provider = c.get<ProviderKind>('provider', 'openai-compatible');
  const baseUrl = c.get<string>('baseUrl', '').trim();
  return {
    provider,
    baseUrl: baseUrl || DEFAULT_URLS[provider],
    model: c.get<string>('model', '').trim(),
    compareModel: c.get<string>('compareModel', '').trim(),
    asrBaseUrl: c.get<string>('asrBaseUrl', 'http://localhost:8000/v1').trim(),
    asrModel: c.get<string>('asrModel', 'nemotron-3.5-asr').trim(),
    language: c.get<string>('language', 'auto'),
    temperature: c.get<number>('temperature', 0.2),
    contextLength: c.get<number>('contextLength', 8192),
    maxIterations: c.get<number>('maxIterations', 20),
    requireWriteApproval: c.get<boolean>('requireWriteApproval', true),
    requireCommandApproval: c.get<boolean>('requireCommandApproval', true),
    allowLanHosts: c.get<boolean>('allowLanHosts', false)
    ,mcpServers: c.get<string>('mcpServers', '{}')
  };
}

/** The locale the UI should use right now ("auto" follows VS Code's display language). */
export function activeLocale(cfg: AgentConfig): string {
  return resolveLocale(cfg.language === 'auto' ? vscode.env.language : cfg.language);
}

import { checkLocalUrl } from '../localGuard';
import { t } from '../i18n';
import type { ProviderKind } from '../config';
import { LlmProvider } from './types';
import { OllamaProvider } from './ollama';
import { OpenAiCompatibleProvider } from './openaiCompatible';

export interface ProviderSettings {
  provider: ProviderKind;
  baseUrl: string;
  allowLanHosts: boolean;
}

export interface DiscoveredServer {
  provider: ProviderKind;
  baseUrl: string;
  models: string[];
}

const LOCAL_PROBES: ReadonlyArray<{ provider: ProviderKind; baseUrl: string }> = [
  { provider: 'ollama', baseUrl: 'http://localhost:11434' },
  { provider: 'lm-studio', baseUrl: 'http://localhost:1234/v1' },
  { provider: 'llama-cpp', baseUrl: 'http://localhost:8080/v1' },
  { provider: 'vllm', baseUrl: 'http://localhost:8000/v1' },
  { provider: 'jan', baseUrl: 'http://localhost:1337/v1' },
  { provider: 'gpt4all', baseUrl: 'http://localhost:4891/v1' }
];

/** Throws a localized error if the address is not local. */
export function createProvider(s: ProviderSettings): LlmProvider {
  const check = checkLocalUrl(s.baseUrl, s.allowLanHosts);
  if (!check.ok) {
    throw new Error(
      check.reason === 'invalid'
        ? t('error.invalidUrl', { url: s.baseUrl })
        : t('error.notLocal', { url: s.baseUrl })
    );
  }
  return s.provider === 'ollama' ? new OllamaProvider(s.baseUrl) : new OpenAiCompatibleProvider(s.baseUrl);
}

/**
 * Probes standard local loopback LLM ports (Ollama, LM Studio, llama.cpp, vLLM, Jan, GPT4All)
 * and returns the first active server that exposes at least one model.
 */
export async function discoverLocalServer(timeoutMs = 1500): Promise<DiscoveredServer | undefined> {
  for (const probe of LOCAL_PROBES) {
    try {
      const provider = createProvider({ ...probe, allowLanHosts: false });
      const models = await Promise.race<string[]>([
        provider.listModels(),
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ]);
      if (Array.isArray(models) && models.length > 0) {
        return { provider: probe.provider, baseUrl: probe.baseUrl, models };
      }
    } catch {
      // Try next local endpoint
    }
  }
  return undefined;
}

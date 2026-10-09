import { checkLocalUrl } from '../localGuard';
import { t } from '../i18n';
import { LlmProvider } from './types';
import { OllamaProvider } from './ollama';
import { OpenAiCompatibleProvider } from './openaiCompatible';

export interface ProviderSettings {
  provider: 'ollama' | 'openai-compatible';
  baseUrl: string;
  allowLanHosts: boolean;
}

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

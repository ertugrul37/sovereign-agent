import { checkLocalUrl } from '../localGuard';
import { t } from '../i18n';

export interface AsrSettings {
  baseUrl: string;
  model: string;
  allowLanHosts: boolean;
}

function transcriptionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
}

/** Sends recorded audio to a local OpenAI-compatible transcription endpoint. */
export async function transcribeAudio(
  audio: Uint8Array,
  mimeType: string,
  settings: AsrSettings,
  signal?: AbortSignal
): Promise<string> {
  const check = checkLocalUrl(settings.baseUrl, settings.allowLanHosts);
  if (!check.ok) {
    throw new Error(
      check.reason === 'invalid'
        ? t('error.invalidUrl', { url: settings.baseUrl })
        : t('error.notLocal', { url: settings.baseUrl })
    );
  }
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), 'recording.webm');
  form.append('model', settings.model);
  const response = await fetch(transcriptionsUrl(settings.baseUrl), {
    method: 'POST',
    body: form,
    signal
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(t('error.http', { status: response.status, detail }));
  }
  const result = (await response.json()) as { text?: unknown };
  if (typeof result.text !== 'string' || !result.text.trim()) {
    throw new Error(t('error.emptyTranscription'));
  }
  return result.text.trim();
}

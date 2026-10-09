import { en, MessageKey } from './locales/en';
import { tr } from './locales/tr';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';

export type { MessageKey };

const catalogs: Record<string, Record<MessageKey, string>> = { en, tr, de, es, fr };

/** Native names, also used to tell the model which language to reply in. */
export const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  tr: 'Türkçe (Turkish)',
  de: 'Deutsch (German)',
  es: 'Español (Spanish)',
  fr: 'Français (French)'
};

export const SUPPORTED_LOCALES = Object.keys(catalogs);

let current = 'en';

/** Maps a tag like "tr", "tr-TR" or "pt_BR" to a supported locale, falling back to English. */
export function resolveLocale(tag: string | undefined): string {
  if (!tag) {
    return 'en';
  }
  const lower = tag.toLowerCase().replace('_', '-');
  if (catalogs[lower]) {
    return lower;
  }
  const base = lower.split('-')[0];
  return catalogs[base] ? base : 'en';
}

export function setLocale(tag: string | undefined): string {
  current = resolveLocale(tag);
  return current;
}

export function getLocale(): string {
  return current;
}

export function localeName(locale: string = current): string {
  return LOCALE_NAMES[locale] ?? LOCALE_NAMES.en;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = catalogs[current][key] ?? en[key];
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/** Strings the webview needs, keyed by message key. */
export function uiStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(en) as MessageKey[]) {
    if (key.startsWith('ui.')) {
      out[key] = t(key);
    }
  }
  return out;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, setLocale, t, uiStrings, SUPPORTED_LOCALES } from '../i18n';

test('resolves language tags', () => {
  assert.equal(resolveLocale('tr'), 'tr');
  assert.equal(resolveLocale('tr-TR'), 'tr');
  assert.equal(resolveLocale('de_DE'), 'de');
  assert.equal(resolveLocale('ja'), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('translates and interpolates', () => {
  setLocale('tr');
  assert.equal(t('model.set', { model: 'x' }), 'Model x olarak ayarlandı.');
  setLocale('en');
  assert.equal(t('model.set', { model: 'x' }), 'Model set to x.');
});

test('every locale exposes the same webview strings', () => {
  setLocale('en');
  const keys = Object.keys(uiStrings()).sort();
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.deepEqual(Object.keys(uiStrings()).sort(), keys);
    assert.ok(Object.values(uiStrings()).every((v) => v.length > 0));
  }
});

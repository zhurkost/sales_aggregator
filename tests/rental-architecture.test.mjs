import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { generated } from '../scripts/rental-card-fields.mjs';

const read = name => readFileSync(new URL('../frontend/src/app/rental/' + name, import.meta.url), 'utf8');

test('rental presentation and projections do not own persistence or AI requests', () => {
  for (const name of ['rental-editor.component.ts', 'rental-fields.component.ts',
    'rental-saved-list.component.ts', 'rental-ai-review.component.ts', 'rental-view.model.ts']) {
    const source = read(name);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bapi\.request\s*(?:<[^>]*>)?\s*\(|HttpClient|localStorage|sessionStorage/, name);
  }
  for (const name of ['rental-draft.store.ts', 'rental-ai.assistant.ts']) {
    assert.doesNotMatch(read(name), /\bdocument\.|\bwindow\.|@Component|\.component["']/, name);
  }
  assert.doesNotMatch(read('rental-ai.assistant.ts'), /rental-view\.model/, 'AI depends on the model, not presentation');
  assert.doesNotMatch(read('rental-models.ts'), /fetch\(|from ["']@angular|rental-api/, 'data contracts are independent');
});

test('rental asks for the extension version that the download link ships', () => {
  const required = read('rental-publication.component.ts').match(/export const REQUIRED_EXTENSION_VERSION = "([\d.]+)"/)?.[1];
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(required, manifest.version);
  for (const name of ['rental-publication.component.ts', 'rental-publication.component.html'])
    assert.doesNotMatch(read(name).replace(/REQUIRED_EXTENSION_VERSION = "[\d.]+"/, ''), /\b\d+\.\d+\.\d+\b/, name);
});

test('the card field IDs the editor reads come from the server model', () => {
  // card-fields.generated.ts is written from rental/model/CardFields.java.
  assert.equal(read('card-fields.generated.ts'), generated());
  for (const name of readdirSync(new URL('../frontend/src/app/rental/', import.meta.url))) {
    if (!/\.(ts|html)$/.test(name) || /\.spec\.ts$|generated/.test(name)) continue;
    const source = read(name);
    // No card field or group spelled out, no unit or style guessed from an id.
    assert.doesNotMatch(source, /["'](?:listing|location|rental|building)\.[a-z_]+["']|group\.(?:main|address_projection)/, name);
    assert.doesNotMatch(source, /id\.includes\(/, name);
  }
});

test('rental requests go through HttpClient with the workspace interceptor', () => {
  for (const name of readdirSync(new URL('../frontend/src/app/rental/', import.meta.url)))
    if (/\.ts$/.test(name) && !/\.spec\.ts$/.test(name)) assert.doesNotMatch(read(name), /\bfetch\s*\(/, name);
  const main = readFileSync(new URL('../frontend/src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /provideHttpClient\(withFetch\(\), withInterceptors\(\[rentalInterceptor\]\)\)/);
});

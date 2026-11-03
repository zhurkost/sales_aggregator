import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../frontend/src/app/rental/' + name, import.meta.url), 'utf8');

test('rental presentation and projections do not own persistence or AI requests', () => {
  for (const name of ['rental-editor.component.ts', 'rental-fields.component.ts',
    'rental-saved-list.component.ts', 'rental-ai-review.component.ts', 'rental-view.model.ts']) {
    const source = read(name);
    assert.doesNotMatch(source, /\bfetch\s*\(|\brentalApi\s*(?:<[^>]*>)?\s*\(|localStorage|sessionStorage/, name);
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

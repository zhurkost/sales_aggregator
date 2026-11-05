import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../frontend/src/app/rental/' + name, import.meta.url), 'utf8');

test('rental presentation and projections do not own persistence or AI requests', () => {
  for (const name of ['rental-editor.component.ts', 'rental-fields.component.ts',
    'rental-saved-list.component.ts', 'rental-ai-review.component.ts', 'rental-view.model.ts',
    'address-input.component.ts', 'rental-publication.component.ts']) {
    const source = read(name);
    assert.doesNotMatch(source, /\bfetch\s*\(|\brentalApi\s*(?:<[^>]*>)?\s*\(|localStorage|sessionStorage/, name);
  }
  for (const name of ['rental-draft.store.ts', 'rental-ai.assistant.ts', 'rental-draft.editor.ts']) {
    assert.doesNotMatch(read(name), /\bdocument\.|\bwindow\.|@Component|\.component["']/, name);
  }
  assert.doesNotMatch(read('rental-ai.assistant.ts'), /rental-view\.model/, 'AI depends on the model, not presentation');
  assert.doesNotMatch(read('rental-models.ts'), /fetch\(|from ["']@angular|rental-api/, 'data contracts are independent');
});

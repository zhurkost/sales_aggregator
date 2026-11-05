import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const root = fileURLToPath(new URL('../frontend/src/app/', import.meta.url));
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const file = path.join(dir, item.name);
    return item.isDirectory() ? sources(file) : file.endsWith('.ts') && !file.endsWith('.spec.ts') ? [file] : [];
  });
}
const files = sources(root);
const imports = new Map(files.map(file => {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  return [file, ast.statements.filter(node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    .filter(node => node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
    .map(node => ({ module: node.moduleSpecifier.text, node }))];
}));

test('all components use gateways instead of importing transport or persistence functions', () => {
  for (const file of files.filter(file => file.endsWith('.component.ts'))) {
    const label = path.relative(root, file);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(fetch|XMLHttpRequest|indexedDB|localStorage|sessionStorage)\b/, label);
    for (const { module, node } of imports.get(file)) {
      assert.doesNotMatch(module, /rental-api$|rental-photos$|@angular\/common\/http/, label);
      if (module.endsWith('/lib/workspace') && ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        assert.ok(bindings && ts.isNamedImports(bindings), label);
        for (const binding of bindings.elements)
          assert.ok(!['api', 'extension', 'setWorkspaceContext', 'optimizePhoto'].includes((binding.propertyName || binding.name).text), label);
      }
    }
  }
});

test('gateways do not depend on UI components or editor state', () => {
  for (const file of files.filter(file => file.endsWith('.gateway.ts') || file.endsWith('-api.ts'))) {
    for (const { module } of imports.get(file))
      assert.doesNotMatch(module, /\.component$|\.store$|\.assistant$|\.model$|\.editor$/, path.relative(root, file));
  }
});

test('frontend imports have no dependency cycles', () => {
  const completed = new Set();
  const stack = [];
  function visit(file) {
    assert.ok(!stack.includes(file), 'Dependency cycle: ' + [...stack, file].map(f => path.relative(root, f)).join(' -> '));
    if (completed.has(file)) return;
    stack.push(file);
    for (const { module } of imports.get(file)) {
      const next = path.resolve(path.dirname(file), module + '.ts');
      if (module.startsWith('.') && imports.has(next)) visit(next);
    }
    stack.pop();
    completed.add(file);
  }
  for (const file of files) visit(file);
});

test('web editor does not execute or import marketplace preparation rules', () => {
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const {module} of imports.get(file))
      assert.doesNotMatch(module, /(?:^|\/)(?:backend|data\/rental|conditions|field-rules|attributes|taxonomy|extension-config)(?:\/|$)/, file);
    assert.doesNotMatch(source, /common_option_id|platform_option_id|\.conversion\b|\.bindings\b|\buiWhen\b|\bfill_rule\b/, file);
  }
});

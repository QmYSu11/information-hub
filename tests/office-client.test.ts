import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficeEnvironment } from '../src/lib/office-client';

test('local model-config import reads only the three explicitly supported keys without evaluating other shell content', () => {
  const found = parseOfficeEnvironment('OTHER_PRIVATE_SETTING=ignore-this\nexport OPENAI_API_KEY="test-openai-value"\nDEEPSEEK_API_KEY=test-deepseek-value # local comment\nGEMINI_API_KEY=\'test-gemini-value\'\nUNRELATED=$(do-not-run)');
  assert.deepEqual(found, { openai: 'test-openai-value', deepseek: 'test-deepseek-value', gemini: 'test-gemini-value' });
  assert.equal(Object.keys(found).length, 3);
});

test('ambiguous assignments, substitutions, malformed values and oversized files are rejected without putting key contents in errors', () => {
  assert.throws(() => parseOfficeEnvironment('OPENAI_API_KEY=test-first-value\nOPENAI_API_KEY=test-second-value'), /多个/);
  assert.throws(() => parseOfficeEnvironment('OPENAI_API_KEY=$(read-secret-from-elsewhere)'), /格式/);
  assert.throws(() => parseOfficeEnvironment('OPENAI_API_KEY="test-key with spaces"'), /格式/);
  assert.throws(() => parseOfficeEnvironment('x'.repeat(25_001)), /太大/);
  try { parseOfficeEnvironment('OPENAI_API_KEY="test-key with spaces"'); } catch (error) { assert.ok(!(error as Error).message.includes('test-key')); }
  assert.deepEqual(parseOfficeEnvironment('UNRELATED=value\n# OPENAI_API_KEY=not-read'), {});
});

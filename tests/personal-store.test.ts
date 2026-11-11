import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canApplyRemoteRead, chooseReconciledGameSave } from '../src/lib/personal-store';

test('cross-tab read may replace only an untouched saved snapshot', () => {
  assert.equal(canApplyRemoteRead(4, 4, 'saved', 12, 11), true);
  // A keystroke happened after the async IndexedDB read started.
  assert.equal(canApplyRemoteRead(4, 5, 'saving', 12, 11), false);
  // Even if that keystroke was saved quickly, an older in-flight read must not replace it.
  assert.equal(canApplyRemoteRead(4, 5, 'saved', 12, 11), false);
  // Unsaved error-state drafts must remain exportable and untouched.
  assert.equal(canApplyRemoteRead(4, 4, 'error', 12, 11), false);
  // A second read completing late cannot roll back a more recent remote version.
  assert.equal(canApplyRemoteRead(4, 4, 'saved', 10, 11), false);
  assert.equal(canApplyRemoteRead(4, 4, 'saved', 11, 11), false);
});
test('a queued game checkpoint cannot overwrite a concurrently imported save', () => {
  const ancestor = { savedAt: 100, crystals: 5 };
  const checkpoint = { savedAt: 120, crystals: 6 };
  const imported = { savedAt: 90, crystals: 30 };
  // Import time need not be newer than the simulation clock.
  assert.deepEqual(chooseReconciledGameSave(checkpoint, imported, ancestor), { value: imported, conflict: true });
  assert.deepEqual(chooseReconciledGameSave(checkpoint, ancestor, ancestor), { value: checkpoint, conflict: false });
  assert.deepEqual(chooseReconciledGameSave(ancestor, imported, ancestor), { value: imported, conflict: false });
  assert.deepEqual(chooseReconciledGameSave(checkpoint, structuredClone(checkpoint), ancestor), { value: checkpoint, conflict: false });
  assert.deepEqual(chooseReconciledGameSave(null, imported, ancestor), { value: imported, conflict: true });
});

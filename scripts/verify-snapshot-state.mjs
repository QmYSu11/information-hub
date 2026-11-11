import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Creates isolated temporary Git repositories, never changes the app repository.
const directory = mkdtempSync(join(tmpdir(), 'information-hub-snapshot-test-'));
const remote = join(directory, 'remote.git');
const work = join(directory, 'work');
const stateScript = fileURLToPath(new URL('./snapshot-state.mjs', import.meta.url));
const run = (command, args, cwd = directory, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
try {
  run('git', ['init', '--bare', remote]);
  mkdirSync(work);
  run('git', ['init'], work);
  run('git', ['remote', 'add', 'origin', remote], work);
  mkdirSync(join(work, 'public/data'), { recursive: true });
  const snapshot = { schemaVersion: 1, generationId: 'test-run', generatedAt: '2026-11-11T09:00:00.000Z', sources: [], items: [], quotes: [] };
  writeFileSync(join(work, 'public/data/snapshot.json'), JSON.stringify(snapshot));
  const env = { ...process.env, GITHUB_ACTIONS: 'true' };
  run(process.execPath, [stateScript, 'persist'], work, env);
  writeFileSync(join(work, 'public/data/snapshot.json'), '{}');
  run(process.execPath, [stateScript, 'restore'], work, env);
  assert.deepEqual(JSON.parse(readFileSync(join(work, 'public/data/snapshot.json'), 'utf8')), snapshot);
  assert.match(run('git', ['ls-remote', '--heads', 'origin', 'data'], work), /refs\/heads\/data/);
  console.log('PASS: public data branch persisted and restored through an isolated local Git remote');
} finally {
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && basename(absolute).startsWith('information-hub-snapshot-test-'));
  rmSync(absolute, { recursive: true, force: true });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, safeUrl, sourceState } from '../src/lib/feed';
test('browser snapshot rejects unsupported versions and filters unsafe URLs and duplicate IDs', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.throws(() => parseSnapshot({ schemaVersion: 2 }));
  const source = { id: 's', label: 'Source', homepage: 'https://example.com', status: 'ok', lastSuccessAt: null, category: 'news' };
  const item = { id: 'a', title: 'Valid', sourceId: 's', url: 'https://example.com/article', fetchedAt: '2026-11-11T00:00:00Z', kind: 'article', channel: '国内' };
  const result = parseSnapshot({ schemaVersion: 1, generationId: 'g', sources: [source], quotes: [], items: [item, item, { ...item, id: 'unsafe', url: 'data:text/html,bad' }] });
  assert.equal(result.items.length, 1);
});
test('successfully fetched old snapshots are still marked as delayed or historical', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const source = { id: 's', label: 's', category: 'news' as const, homepage: 'https://example.com', status: 'ok' as const, lastSuccessAt: '2026-11-11T08:00:00Z' };
  assert.equal(sourceState(source, now).label, '更新延迟');
  assert.equal(sourceState({ ...source, lastSuccessAt: '2026-11-09T08:00:00Z' }, now).label, '历史缓存');
  assert.equal(sourceState({ ...source, lastSuccessAt: null }, now).label, '暂未接通');
});

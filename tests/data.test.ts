import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node data scripts are intentionally plain ESM.
import { normalizeUrl, parseRSS, parseBilibili, preserveFailedSource, assertPublicSnapshot, safeUrl } from '../scripts/data-utils.mjs';
// @ts-expect-error Node data scripts are intentionally plain ESM.
import { parseTencent, zonedTimeToISO } from '../scripts/quotes.mjs';

const now = '2026-11-11T09:00:00.000Z';
test('canonical link ignores tracking but preserves meaningful query parameters', () => {
  assert.equal(normalizeUrl('http://example.com/a?id=7&utm_source=rss&from=test#section'), 'https://example.com/a?id=7');
  assert.notEqual(normalizeUrl('https://example.com/a?id=7'), normalizeUrl('https://example.com/a?id=8'));
  assert.equal(safeUrl('javascript:alert(1)'), undefined);
  assert.equal(safeUrl('https://private:secret@example.com'), undefined);
});
test('RSS strips executable content, deduplicates and does not fabricate publish times', () => {
  const raw = '<rss><channel><item><title>One</title><link>https://example.com/a?utm_source=x</link><description><![CDATA[<script>bad()</script><b>Only text</b>]]></description></item><item><title>Duplicate</title><link>https://example.com/a</link></item><item><title>Bad URL</title><link>javascript:evil</link></item></channel></rss>';
  const items = parseRSS(raw, { id: 'test', channel: '国内' }, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].description, 'Only text');
  assert.equal(items[0].publishedAt, undefined);
  assert.equal(items[0].fetchedAt, now);
  assert.equal(items[0].bodyAllowed, false);
});
test('one source failing retains its original fetch and success timestamps', () => {
  const oldTime = '2026-11-10T09:00:00.000Z';
  const old = { sources: [{ id: 'a', lastSuccessAt: oldTime }], items: [{ id: 'a1', sourceId: 'a', fetchedAt: oldTime }, { id: 'b1', sourceId: 'b' }] };
  const result = preserveFailedSource({ id: 'a' }, old, now, 'timeout');
  assert.equal(result.source.status, 'cached');
  assert.equal(result.source.lastSuccessAt, oldTime);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fetchedAt, oldTime);
  assert.equal(result.source.lastAttemptAt, now);
});
test('Bilibili requires valid identifiers and keeps real ranking', () => {
  const result = parseBilibili({ code: 0, data: { list: [{ bvid: 'BV1B7411m7LV', title: 'Video', pubdate: 1794178689, stat: { view: 10000 } }, { bvid: 'bad', title: 'bad' }] } }, 'bilibili-rank', now);
  assert.equal(result.length, 1);
  assert.equal(result[0].rank, 1);
  assert.equal(result[0].kind, 'video');
  assert.match(result[0].url, /^https:\/\/www.bilibili.com\/video\/BV/);
});
test('public snapshot rejects unexpected personal records and unapproved full bodies', () => {
  const snapshot = { schemaVersion: 1, sources: [{ id: 'a' }], items: [], quotes: [] };
  assert.throws(() => assertPublicSnapshot({ ...snapshot, notes: [] }));
  assert.throws(() => assertPublicSnapshot({ ...snapshot, items: [{ id: '1', sourceId: 'a', url: 'https://example.com', title: 'A', body: 'Full article' }] }));
});
test('market timestamp respects New York summer and winter offsets', () => {
  assert.equal(zonedTimeToISO('2026-07-10 16:00:02', 'America/New_York'), '2026-07-10T20:00:02.000Z');
  assert.equal(zonedTimeToISO('2026-11-10 16:00:02', 'America/New_York'), '2026-11-10T21:00:02.000Z');
  assert.equal(zonedTimeToISO('20261111161427', 'Asia/Shanghai'), '2026-11-11T08:14:27.000Z');
});
test('invalid or unavailable quotes stay null rather than looking like zero prices', () => {
  const quotes = parseTencent('v_sh000001="1~指数~000001~0";', now);
  assert.equal(quotes.find((q: { id: string }) => q.id === 'sh000001').value, null);
  assert.equal(quotes.find((q: { id: string }) => q.id === 'usAAPL').value, null);
});


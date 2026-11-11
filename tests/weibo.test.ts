import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Shared Node ESM collector module has no TS declaration.
import { collectWeibo, parseOfficialWeibo, parseUapiWeibo, WEIBO_ENDPOINTS, WEIBO_SOURCE } from '../scripts/weibo.mjs';

const now = '2026-11-11T14:00:00.000Z';
// Local fixtures verify normalization only, not current real-world topics.
const list = {
  type: 'weibo', update_time: '2026-11-11T13:55:00.000Z',
  list: [
    { index: 2, title: '本地测试话题', url: 'https://s.weibo.com/weibo?q=%23测试一%23', hot_value: '12345' },
    { index: 5, title: '本地测试二', url: 'https://s.weibo.com/weibo?q=%23测试二%23', hot_value: '8.5万' },
  ],
};
const empty = { sources: [], items: [] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('official Weibo normalization retains rank gaps after filtering advertisements, without fabricated dates', () => {
  const result = parseOfficialWeibo({ data: { realtime: [
    { word: '测试广告', realpos: 0, is_ad: 1 },
    { word: '<b>本地测试</b>', realpos: 2, rank: 1, num: 12345 },
    { word: '本地测试', realpos: 3, rank: 2 },
  ] } }, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].rank, 2);
  assert.equal(result[0].title, '本地测试');
  assert.equal(result[0].publishedAt, undefined);
  assert.equal(result[0].fetchedAt, now);
  assert.equal(result[0].bodyAllowed, false);
  assert.match(result[0].url, /^https:\/\/s\.weibo\.com\/weibo\?q=/);
});

test('official realpos is used as a positive position, with zero-based rank and list-order fallbacks', () => {
  for (const [positions, expected] of [
    [{ realpos: 1, rank: 0 }, 1],
    [{ realpos: 9, rank: 3 }, 9],
    [{ realpos: 0, rank: 5 }, 6],
    [{ realpos: -1, rank: 0 }, 1],
    [{}, 1],
  ] as const) {
    const result = parseOfficialWeibo({ data: { realtime: [{ word: '本地测试', ...positions }] } }, now);
    assert.equal(result[0].rank, expected);
  }
});

test('UAPI current Weibo list preserves provided ranks, heat and actual upstream timestamp', () => {
  const result = parseUapiWeibo(list, now);
  assert.deepEqual(result.items.map((item: { rank: number }) => item.rank), [2, 5]);
  assert.equal(result.updatedAt, list.update_time);
  assert.equal(result.items[0].heat, '12345 热度');
  assert.equal(result.items[0].publishedAt, undefined);
  assert.equal(result.items[0].sourceId, 'weibo-hot');
});

test('untrusted links, duplicate topics and unsupported ranking values never enter the public Weibo list', () => {
  const result = parseUapiWeibo({ ...list, list: [
    ...list.list,
    { ...list.list[0], index: 9 },
    { ...list.list[0], index: 0 },
    { ...list.list[0], index: 12, url: 'javascript:alert(1)' },
    { ...list.list[0], index: 13, url: 'https://s.weibo.com.evil.test/weibo?q=bad' },
    { ...list.list[0], index: 14, url: 'https://user:password@s.weibo.com/weibo?q=bad' },
    { ...list.list[0], index: 15, url: 'https://s.weibo.com/login?redirect=bad' },
  ] }, now);
  assert.equal(result.items.length, 2);
  assert.throws(() => parseUapiWeibo({ ...list, type: 'xiaohongshu' }, now));
  assert.throws(() => parseUapiWeibo({ ...list, list: undefined, results: list.list }, now));
});

test('missing, future or stale upstream time is rejected rather than announcing a fresh hotboard', () => {
  for (const update_time of [undefined, 'not-a-date', '2026-11-11 13:55', '2026-11-11T15:00:00Z', '2026-10-27T13:55:00Z']) {
    assert.throws(() => parseUapiWeibo({ ...list, update_time }, now));
  }
});

test('a healthy official source avoids third-party calls and does not request authentication', async () => {
  const calls: string[] = [];
  const result = await collectWeibo({ now, previous: empty, fetchImpl: async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal((init.headers as Record<string, string>).Authorization, undefined);
    assert.equal((init.headers as Record<string, string>).Cookie, undefined);
    return response({ data: { realtime: [{ word: '本地测试话题', realpos: 0 }] } });
  } });
  assert.deepEqual(calls, [WEIBO_ENDPOINTS.official]);
  assert.equal(result.source.status, 'ok');
  assert.equal(result.source.attribution, WEIBO_SOURCE.attribution);
});

test('official access failure falls back exactly once to the documented no-key public service', async () => {
  const calls: string[] = [];
  const result = await collectWeibo({ now, previous: empty, fetchImpl: async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal((init.headers as Record<string, string>).Authorization, undefined);
    assert.equal((init.headers as Record<string, string>).Cookie, undefined);
    return calls.length === 1 ? response({ error: 'Forbidden' }, 403) : response(list);
  } });
  assert.deepEqual(calls, [WEIBO_ENDPOINTS.official, WEIBO_ENDPOINTS.uapi]);
  assert.equal(result.source.status, 'ok');
  assert.equal(result.items.length, 2);
  assert.match(result.source.attribution, /UAPI/);
  assert.match(result.source.message, /21:55 北京时间/);
  assert.equal(result.source.upstreamUpdatedAt, list.update_time);
  assert.equal(result.source.lastSuccessAt, now);
});

test('failure of both sources retains the original cache and successful-fetch time without raw errors', async () => {
  const priorTime = '2026-11-11T10:00:00.000Z';
  const priorItems = parseUapiWeibo({ ...list, update_time: priorTime }, priorTime).items;
  const upstreamTime = '2026-11-11T09:55:00.000Z';
  const previous = { sources: [{ ...WEIBO_SOURCE, status: 'ok', attribution: '微博 · UAPI', lastSuccessAt: priorTime, upstreamUpdatedAt: upstreamTime }], items: priorItems };
  const result = await collectWeibo({ now, previous, fetchImpl: async () => { throw new Error('secret_value_should_not_leak'); } });
  assert.equal(result.source.status, 'cached');
  assert.equal(result.source.lastSuccessAt, priorTime);
  assert.equal(result.source.lastAttemptAt, now);
  assert.equal(result.source.attribution, '微博 · UAPI');
  assert.equal(result.source.upstreamUpdatedAt, upstreamTime);
  assert.deepEqual(result.items, priorItems);
  assert.equal(result.items[0].fetchedAt, priorTime);
  assert.ok(!JSON.stringify(result).includes('secret_value_should_not_leak'));
});

test('a stale fallback is reported unavailable and never published as a new successful live list', async () => {
  let count = 0;
  const result = await collectWeibo({ now, previous: empty, fetchImpl: async () => ++count === 1
    ? response({}, 403) : response({ ...list, update_time: '2026-10-27T07:16:45.661Z' }) });
  assert.equal(result.source.status, 'unavailable');
  assert.equal(result.source.lastSuccessAt, null);
  assert.deepEqual(result.items, []);
  assert.match(result.source.message, /更新已延迟/);
});

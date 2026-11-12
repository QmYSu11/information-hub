import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Public collector modules are plain Node ESM.
import { collectSocialTrends, collectTieba, collectTwitter, parseTiebaOfficial, parseTwitterTrends, parseUapiSocial, SOCIAL_ENDPOINTS } from '../scripts/social-trends.mjs';

const now = '2026-11-12T03:30:00.000Z';
const empty = { sources: [], items: [] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
// These local fixtures contain no current-world topics or service credentials.
const tieba = { errno: 0, data: { bang_topic: { topic_list: [
  { topic_id: 12345, topic_name: '<b>本地贴吧测试</b>', idx_num: 2, topic_url: 'https://tieba.baidu.com/hottopic/browse/hottopic?topic_id=12345&amp;topic_name=测试', discuss_num: 1234, topic_desc: '公开短摘要', topic_pic: 'https://tiebapic.baidu.com/forum/test.jpg', create_time: 1 },
  { topic_id: 45678, topic_name: '本地第二话题', idx_num: 5, topic_url: 'javascript:alert(1)' },
] } } };
const zhihu = { type: 'zhihu', update_time: '2026-11-12T03:25:00.000Z', list: [
  { index: 3, title: '<b>本地知乎问题</b>', url: 'https://www.zhihu.com/question/123456', hot_value: '599 万热度', extra: { desc: '本地测试摘要', image: 'media/relative-not-an-image-url.jpg' } },
  { index: 8, title: '本地另一问题', url: 'https://www.zhihu.com/question/7890', hot_value: '155 万热度' },
] };
const twitter = { status: 'completed', outputs: [{ data: { trends: [
  { name: '#LocalTest', context: 'Technology · Trending', description: null },
  { name: 'A local sample', context: 'Trending', description: 'Service-provided description' },
] } }] };

test('Tieba official data retains ranks and counts, decodes its original link and does not invent board or publication time', () => {
  const result = parseTiebaOfficial(tieba, now);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((x: { rank: number }) => x.rank), [2, 5]);
  assert.equal(result[0].title, '本地贴吧测试');
  assert.equal(new URL(result[0].url).searchParams.get('topic_name'), '测试');
  assert.equal(new URL(result[0].url).searchParams.get('amp;topic_name'), null);
  assert.equal(result[0].heat, '1,234 讨论');
  assert.equal(result[0].publishedAt, undefined);
  assert.equal(result[0].fetchedAt, now);
  assert.equal(result[0].image, 'https://tiebapic.baidu.com/forum/test.jpg');
  assert.match(result[1].url, /^https:\/\/tieba\.baidu\.com\/hottopic\/browse\/hottopic\?/);
  assert.ok(!result[1].url.includes('javascript'));
});

test('Tieba invalid ids, advertisements and duplicate official ranks do not enter the public feed', () => {
  const result = parseTiebaOfficial({ errno: 0, data: { bang_topic: { topic_list: [
    ...tieba.data.bang_topic.topic_list,
    { ...tieba.data.bang_topic.topic_list[0], topic_id: 'not-an-id' },
    { ...tieba.data.bang_topic.topic_list[0], topic_id: 999, is_ad: true },
    { ...tieba.data.bang_topic.topic_list[0], topic_id: 888 },
  ] } } }, now);
  assert.equal(result.length, 2);
  assert.throws(() => parseTiebaOfficial({ errno: 1, data: tieba.data }, now));
  assert.throws(() => parseTiebaOfficial({ errno: 0, data: { topic_list: [] } }, now));
});

test('Zhihu aggregation preserves source ranks, heat and update time without accepting relative cover paths', () => {
  const result = parseUapiSocial(zhihu, 'zhihu', now);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((x: { rank: number }) => x.rank), [3, 8]);
  assert.equal(result.items[0].title, '本地知乎问题');
  assert.equal(result.items[0].heat, '599 万热度');
  assert.equal(result.items[0].image, undefined);
  assert.equal(result.items[0].publishedAt, undefined);
  assert.equal(result.updatedAt, zhihu.update_time);
});

test('wrong platform, history envelopes, stale/future times and hostile links are not current social hotboards', () => {
  for (const update_time of [undefined, 'invalid', '2026-11-12 03:25', '2026-11-12T05:00:00Z', '2026-11-11T23:05:00Z']) {
    assert.throws(() => parseUapiSocial({ ...zhihu, update_time }, 'zhihu', now));
  }
  assert.throws(() => parseUapiSocial({ ...zhihu, type: 'tieba' }, 'zhihu', now));
  assert.throws(() => parseUapiSocial({ ...zhihu, list: undefined, results: zhihu.list }, 'zhihu', now));
  const hostile = parseUapiSocial({ ...zhihu, list: [...zhihu.list,
    { ...zhihu.list[0], index: 9, url: 'https://www.zhihu.com.evil.test/question/123' },
    { ...zhihu.list[0], index: 10, url: 'https://user:password@www.zhihu.com/question/123' },
    { ...zhihu.list[0], index: 11, url: 'https://www.zhihu.com/login?redirect=123' },
  ] }, 'zhihu', now);
  assert.equal(hostile.items.length, 2);
});

test('Twitter keeps the service order and category without fabricating ranks, tweet volumes or post dates', () => {
  const result = parseTwitterTrends(twitter, now);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, '#LocalTest');
  assert.equal(new URL(result[0].url).hostname, 'x.com');
  assert.equal(new URL(result[0].url).searchParams.get('q'), '#LocalTest');
  assert.equal(result[0].description, 'Technology · Trending');
  assert.equal(result[0].rank, undefined);
  assert.equal(result[0].heat, undefined);
  assert.equal(result[0].publishedAt, undefined);
  assert.equal(result[0].fetchedAt, now);
  assert.throws(() => parseTwitterTrends({ ...twitter, status: 'running' }, now));
  assert.throws(() => parseTwitterTrends({ ...twitter, status: 'failed' }, now));
  assert.throws(() => parseTwitterTrends({ status: 'completed', outputs: [{ data: { trends: [] } }] }, now));
});

test('Twitter uses the configured country and server Bearer key but never stores the key or raw response', async () => {
  const key = 'fake-local-test-service-key';
  let calls = 0;
  const result = await collectTwitter({ now, previous: empty, env: { SANDBASE_API_KEY: key, TWITTER_TRENDS_COUNTRY: 'Japan' }, fetchImpl: async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url, SOCIAL_ENDPOINTS.twitter);
    assert.equal(options.method, 'POST');
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer ' + key);
    assert.deepEqual(JSON.parse(options.body as string), { country: 'Japan' });
    return json(twitter);
  } });
  assert.equal(calls, 1);
  assert.equal(result.source.status, 'ok');
  assert.equal(result.source.region, 'Japan');
  assert.match(result.source.message, /日本地区/);
  assert.match(result.source.message, /不代表全球/);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(!JSON.stringify(result).includes('outputs'));
});

test('Twitter never calls without a key and rejects unsupported region configuration', async () => {
  const fetchImpl = () => { throw new Error('must not call'); };
  const initial = await collectTwitter({ now, previous: empty, env: {}, fetchImpl });
  assert.equal(initial.source.status, 'external');
  assert.equal(initial.source.region, 'UnitedStates');
  assert.deepEqual(initial.items, []);
  const invalid = await collectTwitter({ now, previous: empty, env: { SANDBASE_API_KEY: 'fake-key', TWITTER_TRENDS_COUNTRY: 'Worldwide' }, fetchImpl });
  assert.equal(invalid.source.status, 'unavailable');
  assert.match(invalid.source.message, /地区配置无效/);
});

test('Twitter success and failure both enforce hourly caching, and changing region cannot leak the old region board', async () => {
  const previousTime = '2026-11-12T03:00:00Z';
  const oldItems = parseTwitterTrends(twitter, previousTime);
  for (const status of ['ok', 'unavailable']) {
    const previous = { sources: [{ id: 'twitter-trends', region: 'UnitedStates', status, lastSuccessAt: previousTime, lastAttemptAt: previousTime, message: 'Previous status' }], items: oldItems };
    const cached = await collectTwitter({ now, previous, env: { SANDBASE_API_KEY: 'fake-key' }, fetchImpl: () => { throw new Error('must not fetch'); } });
    assert.equal(cached.source.status, status);
    assert.equal(cached.source.lastSuccessAt, previousTime);
    assert.equal(cached.items[0].fetchedAt, previousTime);
    const changed = await collectTwitter({ now, previous, env: { TWITTER_TRENDS_COUNTRY: 'Japan' }, fetchImpl: () => { throw new Error('must not fetch'); } });
    assert.equal(changed.source.status, 'external');
    assert.equal(changed.source.lastSuccessAt, null);
    assert.deepEqual(changed.items, []);
  }
});

test('failed social sources retain their original cache and timestamps without copying private error messages', async () => {
  const oldTime = '2026-11-12T00:00:00Z';
  const oldItems = parseTwitterTrends(twitter, oldTime);
  const result = await collectTwitter({ now, previous: { sources: [{ id: 'twitter-trends', region: 'UnitedStates', status: 'ok', lastSuccessAt: oldTime, lastAttemptAt: oldTime }], items: oldItems }, env: { SANDBASE_API_KEY: 'fake-key' }, fetchImpl: async () => { throw new Error('private-key-never-copy'); } });
  assert.equal(result.source.status, 'cached');
  assert.equal(result.source.lastSuccessAt, oldTime);
  assert.equal(result.items[0].fetchedAt, oldTime);
  assert.ok(!JSON.stringify(result).includes('private-key-never-copy'));
});

test('Tieba prefers its public origin and makes only one documented fallback call when the origin fails', async () => {
  const directCalls: string[] = [];
  const direct = await collectTieba({ now, previous: empty, fetchImpl: async (url: string) => { directCalls.push(url); return json(tieba); } });
  assert.deepEqual(directCalls, [SOCIAL_ENDPOINTS.tieba]);
  assert.equal(direct.source.status, 'ok');
  assert.equal(direct.source.upstreamUpdatedAt, undefined);
  const fallbackCalls: string[] = [];
  const fallback = await collectTieba({ now, previous: empty, fetchImpl: async (url: string) => {
    fallbackCalls.push(url);
    return fallbackCalls.length === 1 ? json({}, 403) : json({ type: 'tieba', update_time: zhihu.update_time, list: [{ index: 4, title: '本地备用', url: 'https://tieba.baidu.com/hottopic/browse/hottopic?topic_id=1234', hot_value: '10.5W讨论' }] });
  } });
  assert.deepEqual(fallbackCalls, [SOCIAL_ENDPOINTS.tieba, SOCIAL_ENDPOINTS.tiebaFallback]);
  assert.equal(fallback.source.status, 'ok');
  assert.match(fallback.source.attribution, /UAPI/);
  assert.equal(fallback.source.upstreamUpdatedAt, zhihu.update_time);
});

test('one new board failing does not prevent other platforms from returning real items', async () => {
  const result = await collectSocialTrends({ now, previous: empty, env: {}, fetchImpl: async (url: string) => {
    if (url === SOCIAL_ENDPOINTS.tieba) return json(tieba);
    if (url === SOCIAL_ENDPOINTS.zhihu) return json(zhihu);
    throw new Error('unexpected endpoint');
  } });
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((x: { source: { status: string } }) => x.source.status), ['ok', 'ok', 'external']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Collector adapters are plain ESM.
import { collectXiaohongshu, parseXiaohongshuRecommendations, XIAOHONGSHU_SOURCE } from '../scripts/xiaohongshu.mjs';

const now = '2026-11-11T12:00:00.000Z';
const noteId = '6ad817e6000000002403ce45';
const response = {
  code: 0, data: { items: [{
    id: noteId, model_type: 'note', xsec_token: 'not a valid public access parameter',
    note_card: {
      display_title: '<b>A real title in a test fixture</b>', type: 'video',
      user: { nick_name: 'Author', user_id: 'not-collected', xsec_token: 'private-user-token' },
      cover: { url_default: 'http://sns-web-i10.rednotecdn.com/example/cover.webp' },
      interact_info: { liked_count: '4442' },
    },
  }] },
};
const empty = { sources: [], items: [], quotes: [] };

test('recommendations normalize documented feed cards without inventing ranks, dates or bodies', () => {
  const items = parseXiaohongshuRecommendations(response, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'post');
  assert.equal(items[0].mediaType, 'video');
  assert.equal(items[0].title, 'A real title in a test fixture');
  assert.equal(items[0].author, 'Author');
  assert.equal(items[0].heat, '4442 赞');
  assert.equal(items[0].url, 'https://www.xiaohongshu.com/explore/' + noteId);
  assert.equal(items[0].image, 'https://sns-web-i10.rednotecdn.com/example/cover.webp');
  assert.equal(items[0].rank, undefined);
  assert.equal(items[0].publishedAt, undefined);
  assert.equal(items[0].body, undefined);
  assert.equal(items[0].fetchedAt, now);
  assert.ok(!JSON.stringify(items).includes('private-user-token'));
  assert.ok(!JSON.stringify(items).includes('not a valid public access parameter'));
});

test('nested provider envelopes deduplicate notes independently of ephemeral public link parameters', () => {
  const first = {
    ...structuredClone(response.data.items[0]),
    note_card: { ...structuredClone(response.data.items[0].note_card), note_url: 'https://www.xiaohongshu.com/explore/' + noteId + '?xsec_token=public-share&secret=never-persist&xsec_source=pc_feed' },
  };
  const duplicate = structuredClone(first);
  duplicate.note_card.note_url = 'https://www.xiaohongshu.com/explore/' + noteId + '?xsec_token=different-share';
  const result = parseXiaohongshuRecommendations({ code: 200, data: { data: { items: [first, duplicate, { model_type: 'search_hint', title: 'Ignore' }] } } }, now);
  assert.equal(result.length, 1);
  assert.ok(result[0].url.includes('xsec_token=public-share'));
  assert.ok(!result[0].url.includes('secret='));
});

test('the observed SandBase gateway outputs envelope yields real note cards rather than the wrapper record', () => {
  const envelope = { id: 'test-request-id', status: 'completed', model: 'xiaohongshu/web-v3/homefeed', outputs: [{ data: { ...response, success: true, ok: true } }] };
  const result = parseXiaohongshuRecommendations(envelope, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'A real title in a test fixture');
  assert.equal(result[0].author, 'Author');
  assert.equal(result[0].mediaType, 'video');
  assert.ok(!JSON.stringify(result).includes('test-request-id'));
  assert.throws(() => parseXiaohongshuRecommendations({ ...envelope, status: 'failed' }, now));
  assert.throws(() => parseXiaohongshuRecommendations({ ...envelope, status: 'running' }, now));
  assert.throws(() => parseXiaohongshuRecommendations({ ...envelope, outputs: [{ data: { ...response, success: false } }] }, now));
});

test('the documented note access parameter is retained in its note link while author and session credentials are excluded', () => {
  const card = structuredClone(response.data.items[0]);
  card.xsec_token = 'public-note-access-parameter-for-local-test';
  const [item] = parseXiaohongshuRecommendations({ data: { items: [card] } }, now);
  assert.equal(new URL(item.url).searchParams.get('xsec_token'), card.xsec_token);
  assert.ok(!JSON.stringify(item).includes('private-user-token'));
  card.note_card.note_url = 'https://www.xiaohongshu.com/explore/' + noteId + '?xsec_token=existing-public-link';
  const [existing] = parseXiaohongshuRecommendations({ data: { items: [card] } }, now);
  assert.equal(new URL(existing.url).searchParams.get('xsec_token'), 'existing-public-link');
  assert.equal(existing.id, item.id);
  const authorOnly = structuredClone(response.data.items[0]);
  delete (authorOnly as { xsec_token?: string }).xsec_token;
  const [withoutNoteToken] = parseXiaohongshuRecommendations({ data: { items: [authorOnly] } }, now);
  assert.equal(new URL(withoutNoteToken.url).searchParams.get('xsec_token'), null);
});

test('invalid URLs, unsafe covers and ambiguous dates do not become publicly displayed metadata', () => {
  const card = { ...structuredClone(response.data.items[0]), note_card: { ...structuredClone(response.data.items[0].note_card), publish_time: '11月11日' } };
  card.note_card.cover.url_default = 'https://evil.example.com/fake-image.png';
  card.note_card.user.nick_name = '<script>attack()</script>Valid author';
  const result = parseXiaohongshuRecommendations({ data: { items: [card] } }, now);
  assert.equal(result[0].image, undefined);
  assert.equal(result[0].publishedAt, undefined);
  assert.equal(result[0].author, 'Valid author');
  assert.throws(() => parseXiaohongshuRecommendations({ code: 401, data: response.data }, now));
  assert.throws(() => parseXiaohongshuRecommendations({ code: 0, data: { items: [] } }, now));
});

test('without a configured key the collector does not call a service or pretend a feed is connected', async () => {
  const result = await collectXiaohongshu({
    now, previous: empty, env: {},
    fetchImpl: () => { throw new Error('must not fetch'); },
  });
  assert.equal(result.source.category, 'recommendations');
  assert.equal(result.source.status, 'external');
  assert.equal(result.source.lastSuccessAt, null);
  assert.deepEqual(result.items, []);
});

test('SandBase is preferred and the Bearer key stays in the request, never in the public snapshot', async () => {
  const secret = 'a-test-secret-not-a-real-account-key';
  let calls = 0;
  const result = await collectXiaohongshu({
    now, previous: empty, env: { SANDBASE_API_KEY: secret, TIKHUB_API_KEY: 'unused' },
    fetchImpl: async (url: string, init: RequestInit) => {
      calls++;
      assert.equal(url, 'https://api.sandbase.ai/v1/api/xiaohongshu/web-v3/homefeed');
      assert.equal(init.method, 'POST');
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer ' + secret);
      assert.equal(JSON.parse(init.body as string).num, 20);
      return new Response(JSON.stringify(response), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.source.status, 'ok');
  assert.equal(result.source.lastSuccessAt, now);
  assert.equal(result.items.length, 1);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('a healthy hourly cache keeps its original fetch time and avoids another quota-consuming call', async () => {
  const oldTime = '2026-11-11T11:30:00.000Z';
  const oldItems = parseXiaohongshuRecommendations(response, oldTime);
  const result = await collectXiaohongshu({
    now, env: { SANDBASE_API_KEY: 'test-key' },
    previous: { sources: [{ ...XIAOHONGSHU_SOURCE, attribution: XIAOHONGSHU_SOURCE.attribution + ' · SandBase', status: 'ok', lastSuccessAt: oldTime, lastAttemptAt: oldTime }], items: oldItems },
    fetchImpl: () => { throw new Error('must not fetch'); },
  });
  assert.equal(result.items[0].fetchedAt, oldTime);
  assert.equal(result.source.lastSuccessAt, oldTime);
});

test('a failed request is also rate-limited for one hour rather than consuming quota every scheduled run', async () => {
  const oldTime = '2026-11-11T11:30:00.000Z';
  const result = await collectXiaohongshu({
    now, env: { SANDBASE_API_KEY: 'test-key' },
    previous: { sources: [{ ...XIAOHONGSHU_SOURCE, attribution: XIAOHONGSHU_SOURCE.attribution + ' · SandBase', status: 'unavailable', lastSuccessAt: null, lastAttemptAt: oldTime, message: '推荐服务密钥未生效，请检查配置' }], items: [] },
    fetchImpl: () => { throw new Error('must not fetch'); },
  });
  assert.equal(result.source.status, 'unavailable');
  assert.equal(result.source.lastAttemptAt, oldTime);
  assert.equal(result.source.lastSuccessAt, null);
  assert.deepEqual(result.items, []);
});

test('an hour-old failed attempt may retry while external unconfigured state never delays the first real connection', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify(response), { status: 200 }); };
  const failed = { ...XIAOHONGSHU_SOURCE, attribution: XIAOHONGSHU_SOURCE.attribution + ' · SandBase', status: 'unavailable', lastSuccessAt: null, lastAttemptAt: '2026-11-11T11:00:00.000Z' };
  const retry = await collectXiaohongshu({ now, env: { SANDBASE_API_KEY: 'test-key' }, previous: { sources: [failed], items: [] }, fetchImpl });
  assert.equal(retry.source.status, 'ok');
  assert.equal(calls, 1);
  const initial = { ...XIAOHONGSHU_SOURCE, status: 'external', lastSuccessAt: null, lastAttemptAt: now };
  const connected = await collectXiaohongshu({ now, env: { SANDBASE_API_KEY: 'test-key' }, previous: { sources: [initial], items: [] }, fetchImpl });
  assert.equal(connected.source.status, 'ok');
  assert.equal(calls, 2);
});

test('an explicit configuration refresh bypasses the cooldown once without adding retries or bypassing credentials', async () => {
  let calls = 0;
  const previous = { sources: [{ ...XIAOHONGSHU_SOURCE, attribution: XIAOHONGSHU_SOURCE.attribution + ' · SandBase', status: 'unavailable', lastSuccessAt: null, lastAttemptAt: now }], items: [] };
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ outputs: [{ data: response }] }), { status: 200 }); };
  const result = await collectXiaohongshu({ now, previous, env: { SANDBASE_API_KEY: 'test-key' }, forceRefresh: true, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(result.source.status, 'ok');
  const unconfigured = await collectXiaohongshu({ now, previous, env: {}, forceRefresh: true, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(unconfigured.source.status, 'external');
});

test('switching to another explicitly configured provider does not reuse a failure cooldown', async () => {
  let calls = 0;
  const previous = { sources: [{ ...XIAOHONGSHU_SOURCE, attribution: XIAOHONGSHU_SOURCE.attribution + ' · TikHub', status: 'unavailable', lastSuccessAt: null, lastAttemptAt: now }], items: [] };
  const result = await collectXiaohongshu({
    now, env: { SANDBASE_API_KEY: 'test-key' }, previous,
    fetchImpl: async () => { calls++; return new Response(JSON.stringify(response), { status: 200 }); },
  });
  assert.equal(calls, 1);
  assert.equal(result.source.status, 'ok');
});

test('failed credentials or exhausted budget preserves the old feed and never leaks provider errors or retries', async () => {
  const oldTime = '2026-11-11T09:00:00.000Z';
  const oldItems = parseXiaohongshuRecommendations(response, oldTime);
  let calls = 0;
  const result = await collectXiaohongshu({
    now, env: { SANDBASE_API_KEY: 'test-secret' },
    previous: { sources: [{ ...XIAOHONGSHU_SOURCE, status: 'ok', lastSuccessAt: oldTime }], items: oldItems },
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'test-secret / private response details' }), { status: 402 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.source.status, 'cached');
  assert.equal(result.source.lastSuccessAt, oldTime);
  assert.equal(result.items[0].fetchedAt, oldTime);
  assert.match(result.source.message, /额度|预算/);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('TikHub fallback uses documented GET parameters without exposing the key in the URL', async () => {
  const result = await collectXiaohongshu({
    now, previous: empty, env: { TIKHUB_API_KEY: 'test-tikhub-key' },
    fetchImpl: async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'api.tikhub.io');
      assert.equal(parsed.searchParams.get('num'), '20');
      assert.equal(init.method, 'GET');
      assert.ok(!url.includes('test-tikhub-key'));
      return new Response(JSON.stringify({ code: 200, data: response }), { status: 200 });
    },
  });
  assert.equal(result.source.status, 'ok');
});

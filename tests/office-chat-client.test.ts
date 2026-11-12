import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseChatMaterials, createChatSendInput, OfficeChatError, parseChatConversation, referencesForChatMessage, sendChatMessage } from '../src/lib/office-chat-client';
import type { ChatMaterial, ChatSendInput } from '../src/lib/office-chat-client';
import type { ContentItem, Source } from '../src/types';

const conversationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const time = '2026-11-12T10:00:00.000Z';
const attachment: ChatMaterial = { id: 'news-1', title: '一则真实来源的测试标题', url: 'https://example.com/news', fetchedAt: time, channel: '趣事', kind: 'post', source: '来源甲' };
const input: ChatSendInput = { provider: 'deepseek', message: '继续说说', requestId, intent: 'general' };
function conversation(overrides: Record<string, unknown> = {}) {
  return { id: conversationId, title: '继续聊', provider: 'deepseek', updatedAt: time, contextMessageCount: 1, contextLimited: false, pending: false, usedCalls: 1, dailyLimit: 30,
    messages: [{ id: 'user-1', role: 'user', text: '继续说说', createdAt: time, deliveryStatus: 'completed', intent: 'curation', materials: [attachment], watchSymbols: ['NASDAQ:AAPL'] }, { id: 'assistant-1', role: 'assistant', text: '看看这一条。[来源:news-1]', createdAt: time, deliveryStatus: 'completed', references: [attachment], model: 'deepseek-chat', usage: { input: 40, output: 20 } }], ...overrides };
}
async function mockFetch(implementation: typeof fetch, run: () => Promise<void>) { const original = globalThis.fetch; globalThis.fetch = implementation; try { await run(); } finally { globalThis.fetch = original; } }

test('chat parsing retains pending locks, actual context count and persistent source attachments', () => {
  const parsed = parseChatConversation(conversation({ pending: true, contextLimited: true }));
  assert.equal(parsed.pending, true);
  assert.equal(parsed.contextMessageCount, 1);
  assert.equal(parsed.contextLimited, true);
  assert.equal(parsed.messages[0].intent, 'curation');
  assert.deepEqual(parsed.messages[0].watchSymbols, ['NASDAQ:AAPL']);
  assert.deepEqual(parsed.messages[0].materials, [attachment]);
  assert.deepEqual(referencesForChatMessage(parsed.messages[1]), [attachment]);
});

test('malformed histories and duplicate messages are rejected instead of shown as a successful reply', () => {
  assert.throws(() => parseChatConversation(conversation({ provider: 'unknown' })), /格式/);
  const value = conversation();
  assert.throws(() => parseChatConversation({ ...value, messages: [value.messages[0], value.messages[0]] }), /重复/);
  assert.throws(() => parseChatConversation({ ...value, messages: [{ ...value.messages[0], role: 'system' }] }), /完整/);
});

test('ordinary chat sends no news or watchlist unless the user explicitly opts in', () => {
  const ordinary = createChatSendInput({ ...input, intent: 'market', materials: [attachment], watchSymbols: ['NASDAQ:AAPL'] });
  assert.deepEqual(ordinary, input);
  const optedIn = createChatSendInput({ ...input, intent: 'market', includeMaterials: true, materials: [attachment], includeWatchSymbols: true, watchSymbols: ['NASDAQ:AAPL', 'NASDAQ:AAPL', 'bad symbol'] });
  assert.equal(optedIn.intent, 'market');
  assert.deepEqual(optedIn.materials, [attachment]);
  assert.deepEqual(optedIn.watchSymbols, ['NASDAQ:AAPL']);
  assert.throws(() => createChatSendInput({ ...input, includeMaterials: true, materials: [] }), /还没有/);
  assert.throws(() => createChatSendInput({ ...input, message: 'x'.repeat(6001) }), /6000/);
});

test('news attachments are capped and unsafe links cannot become citations', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ ...attachment, id: 'news-' + index }));
  const selected = createChatSendInput({ ...input, includeMaterials: true, materials: many });
  assert.equal(selected.materials?.length, 20);
  const parsed = parseChatConversation(conversation({ messages: [{ id: 'assistant-1', role: 'assistant', text: '[来源:news-1] [来源:unsafe] [来源:credentials]', createdAt: time, references: [attachment, { ...attachment, id: 'uncited' }, { ...attachment, id: 'unsafe', url: 'javascript:alert(1)' }, { ...attachment, id: 'credentials', url: 'https://user:pass@example.com' }] }] }));
  assert.deepEqual(referencesForChatMessage(parsed.messages[0]), [attachment]);
  assert.deepEqual(referencesForChatMessage({ ...parsed.messages[0], role: 'user' }), []);
});

test('video selection uses real video items and retains source URLs and times', () => {
  const source: Source = { id: 'bili', label: '视频来源', category: 'trends', platform: 'bilibili', homepage: 'https://example.com', status: 'ok', lastSuccessAt: time };
  const items: ContentItem[] = [
    { id: 'video-1', sourceId: 'bili', title: '有趣的视频', url: 'https://example.com/video', fetchedAt: time, channel: '趣事', kind: 'video' },
    { id: 'post-1', sourceId: 'bili', title: '普通帖子', url: 'https://example.com/post', fetchedAt: time, channel: '趣事', kind: 'post' },
  ];
  const chosen = chooseChatMaterials(items, [source], 'videos');
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].id, 'video-1');
  assert.equal(chosen[0].url, items[0].url);
  assert.equal(chosen[0].fetchedAt, time);
});

test('a send uses same-origin authentication and one explicit request, with no browser API key header', async () => {
  let calls = 0;
  await mockFetch(async (url, init) => {
    calls++;
    assert.equal(url, '/api/chat/send');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json(conversation());
  }, async () => { assert.equal((await sendChatMessage(input)).id, conversationId); });
  assert.equal(calls, 1);
});

test('network interruption and malformed successful responses remain unknown and never automatically retry', async () => {
  for (const result of ['network', 'malformed']) {
    let calls = 0;
    await mockFetch(async () => { calls++; if (result === 'network') throw new TypeError('network failure'); return Response.json({ id: conversationId, provider: 'deepseek', messages: 'broken' }); }, async () => {
      await assert.rejects(sendChatMessage(input), error => error instanceof OfficeChatError && error.deliveryUnknown === true && (result === 'network' || error.conversationId === conversationId));
    });
    assert.equal(calls, 1);
  }
});

test('failed attempts return the recoverable conversation and a manual replay preserves the request UUID', async () => {
  const bodies: unknown[] = [];
  await mockFetch(async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ error: '这次没有完成，可以继续。', conversationId }, { status: 502 }); }, async () => {
    for (let count = 0; count < 2; count++) await assert.rejects(sendChatMessage(input), error => error instanceof OfficeChatError && error.conversationId === conversationId && error.deliveryUnknown === false && error.status === 502);
  });
  assert.deepEqual(bodies, [input, input]);
});

test('a reply from another provider cannot silently replace the active conversation', async () => {
  await mockFetch(async () => Response.json(conversation({ provider: 'openai' })), async () => {
    await assert.rejects(sendChatMessage({ ...input, conversationId }), error => error instanceof OfficeChatError && error.deliveryUnknown === true && error.conversationId === conversationId);
  });
});

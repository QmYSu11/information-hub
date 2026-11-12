import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createOfficeWorker, normalizeContext, normalizePlan, safeCitations } from '../worker.mjs';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_office.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_provider_keys.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { return { bind(...values) { return { async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; } }; } }; } };
  return { DB, OFFICE_SESSION_SECRET: 'test-session-signing-key-not-a-real-secret-long-enough', DEEPSEEK_API_KEY: 'test-deepseek-key', OFFICE_DAILY_CALL_LIMIT: '20' };
}
const request = (path, body, origin = 'https://private.example') => new Request('https://private.example' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'oai-authenticated-user-id': 'test-owner-id' }, body: JSON.stringify(body) });
const read = async response => ({ status: response.status, body: await response.json() });

test('private note snippets require explicit opt-in, and plans cannot impersonate unconfigured providers or exceed the call cap', () => {
  const env = environment();
  const context = normalizeContext({ task: '帮我准备一个学习计划', noteText: 'private notes', members: ['deepseek', 'openai'], maxCalls: 3 }, env);
  assert.equal(context.noteText, '');
  assert.deepEqual(context.members, ['deepseek']);
  assert.equal(normalizeContext({ task: '整理笔记', includeNotes: true, noteText: 'selected note only' }, env).noteText, 'selected note only');
  assert.throws(() => normalizePlan({ assignments: [{ provider: 'openai', instruction: 'fake a reply' }] }, context));
  assert.throws(() => normalizePlan({ assignments: [{ provider: 'deepseek', instruction: 'work' }], reviewer: 'deepseek', summarizer: 'deepseek' }, context));
  assert.throws(() => normalizePlan({ assignments: [{ provider: 'deepseek', instruction: 'work' }], summarizer: 'gemini' }, context));
  assert.throws(() => normalizeContext({ task: '一个新任务', members: ['deepseek'], convener: 'gemini' }, env));
  assert.equal(safeCitations('有据[来源:one] 无据[来源:invented]', [{ id: 'one' }]), '有据[来源:one] 无据[未匹配来源]');
});

test('the same configured brand can receive any dynamically planned role, without fixed brand-to-job rules', () => {
  const context = { members: ['deepseek', 'openai', 'gemini'], convener: 'deepseek', maxCalls: 6 };
  const plan = normalizePlan({ title: '动态协作', assignments: [{ provider: 'gemini', title: '写作', instruction: '写一段开场' }, { provider: 'deepseek', title: '反向检查', instruction: '检查开场中的假设' }], reviewer: 'openai', summarizer: 'gemini' }, context);
  assert.equal(plan.assignments[0].provider, 'gemini');
  assert.equal(plan.assignments[1].provider, 'deepseek');
  assert.equal(plan.reviewer, 'openai');
  assert.equal(plan.summarizer, 'gemini');
});

test('a real three-call single-member plan is reviewed by the user before work, with one-use reservations and recoverable state', async () => {
  const env = environment(); let calls = 0;
  const worker = createOfficeWorker(async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer test-deepseek-key');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.max_tokens, 1500);
    assert.equal(body.thinking.type, 'disabled');
    assert.ok(body.messages[0].content.includes('不可信'));
    const content = calls === 1 ? JSON.stringify({ title: '准备学习', assignments: [{ provider: 'deepseek', title: '拆解问题', instruction: '列出练习顺序' }], reviewer: null, summarizer: 'deepseek' }) : '交付[来源:one]，不能确认[来源:invented]';
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
  });
  const planned = await read(await worker.fetch(request('/api/office/plan', { task: '安排学习计划', maxCalls: 3, materials: [{ id: 'one', title: '本地测试材料' }] }), env));
  assert.equal(planned.status, 200); assert.equal(planned.body.status, 'draft'); assert.equal(calls, 1);
  const beforeApproval = await worker.fetch(request('/api/office/run', { ticket: planned.body.ticket }), env);
  assert.equal(beforeApproval.status, 409); assert.equal(calls, 1);
  let session = (await read(await worker.fetch(request('/api/office/approve', { ticket: planned.body.ticket, plan: planned.body.plan }), env))).body;
  assert.equal(session.status, 'ready');
  const oldTicket = session.ticket;
  session = (await read(await worker.fetch(request('/api/office/run', { ticket: session.ticket }), env))).body;
  assert.equal(session.results.length, 1); assert.equal(calls, 2);
  assert.equal((await worker.fetch(request('/api/office/run', { ticket: oldTicket }), env)).status, 409);
  assert.equal(calls, 2);
  const recovered = (await read(await worker.fetch(request('/api/office/resume', { ticket: planned.body.ticket }), env))).body;
  assert.equal(recovered.ticket, session.ticket);
  session = (await read(await worker.fetch(request('/api/office/run', { ticket: session.ticket }), env))).body;
  assert.equal(session.status, 'completed'); assert.equal(session.usedCalls, 3); assert.equal(calls, 3);
  assert.match(session.results[1].text, /未匹配来源/);
  assert.ok(!JSON.stringify(session).includes('test-deepseek-key'));
  assert.equal((await worker.fetch(request('/api/office/run', { ticket: session.ticket }), env)).status, 409);
  assert.equal(calls, 3);
});

test('cross-site submission, tampered tickets, exhausted daily quota and missing storage never trigger model calls', async () => {
  const env = environment(); env.OFFICE_DAILY_CALL_LIMIT = '1'; let calls = 0;
  const worker = createOfficeWorker(async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ assignments: [{ provider: 'deepseek', instruction: '处理' }], summarizer: 'deepseek' }) }, finish_reason: 'stop' }] })); });
  assert.equal((await worker.fetch(request('/api/office/plan', { task: '一项任务' }, 'https://evil.example'), env)).status, 403);
  assert.equal(calls, 0);
  const planned = (await read(await worker.fetch(request('/api/office/plan', { task: '一项任务', maxCalls: 3 }), env))).body;
  assert.equal(calls, 1);
  const approved = (await read(await worker.fetch(request('/api/office/approve', { ticket: planned.ticket, plan: planned.plan }), env))).body;
  assert.equal((await worker.fetch(request('/api/office/run', { ticket: approved.ticket + 'tampered' }), env)).status, 401);
  assert.equal((await worker.fetch(request('/api/office/run', { ticket: approved.ticket }), env)).status, 429);
  assert.equal(calls, 1);
  assert.equal((await worker.fetch(request('/api/office/plan', { task: '新任务' }), { ...env, DB: undefined })).status, 503);
});

test('OpenAI and Gemini use their official endpoints, secret headers and bounded response extraction', async () => {
  for (const provider of ['openai', 'gemini']) {
    const env = environment(); delete env.DEEPSEEK_API_KEY;
    env[provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'] = 'test-provider-secret';
    const worker = createOfficeWorker(async (url, init) => {
      const payload = JSON.parse(init.body);
      const plan = JSON.stringify({ assignments: [{ provider, instruction: '处理任务' }], summarizer: provider });
      if (provider === 'openai') {
        assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.headers.Authorization, 'Bearer test-provider-secret'); assert.equal(payload.store, false); assert.equal(payload.max_output_tokens, 1500);
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: plan }] }], usage: { input_tokens: 20, output_tokens: 10 } }));
      }
      assert.ok(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')); assert.equal(init.headers['x-goog-api-key'], 'test-provider-secret'); assert.ok(!url.includes('test-provider-secret')); assert.equal(payload.generationConfig.maxOutputTokens, 1500);
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: plan }] } }] }));
    });
    const result = await read(await worker.fetch(request('/api/office/plan', { task: '一个通用任务', maxCalls: 3 }), env));
    assert.equal(result.status, 200); assert.equal(result.body.plan.assignments[0].provider, provider);
    const status = await read(await worker.fetch(new Request('https://private.example/api/status', { headers: { 'oai-authenticated-user-id': 'test-owner-id' } }), env));
    assert.ok(!JSON.stringify(status).includes('test-provider-secret'));
  }
});

test('anonymous API calls and another authenticated account cannot read or execute user-owned tasks', async () => {
  const env = environment(); let calls = 0;
  const worker = createOfficeWorker(async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ assignments: [{ provider: 'deepseek', instruction: '处理问题' }], summarizer: 'deepseek' }) }, finish_reason: 'stop' }] })); });
  assert.equal((await worker.fetch(new Request('https://private.example/api/status'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://private.example/api/office/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: '匿名任务' }) }), env)).status, 401);
  assert.equal(calls, 0);
  const planned = (await read(await worker.fetch(request('/api/office/plan', { task: '拥有者的任务', maxCalls: 3 }), env))).body;
  const other = request('/api/office/resume', { ticket: planned.ticket }); other.headers.set('oai-authenticated-user-id', 'another-test-account');
  assert.equal((await worker.fetch(other, env)).status, 403);
  assert.equal(calls, 1);
});

test('a provider error stops the task without retries, substituting another brand, or returning raw provider errors', async () => {
  const env = environment(); let calls = 0;
  const worker = createOfficeWorker(async () => { calls++; return new Response(JSON.stringify({ error: { message: 'test-deepseek-key secret upstream detail' } }), { status: 401 }); });
  const result = await read(await worker.fetch(request('/api/office/plan', { task: '处理一个问题' }), env));
  assert.equal(result.status, 502); assert.equal(calls, 1); assert.match(result.body.error, /权限|密钥/);
  assert.ok(!JSON.stringify(result).includes('test-deepseek-key'));
  assert.ok(!JSON.stringify(result).includes('secret upstream detail'));
});

test('cancelling during a provider response preserves the delivered work but never schedules the next model', async () => {
  const env = environment(); let calls = 0; let finish;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const worker = createOfficeWorker(async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ assignments: [{ provider: 'deepseek', instruction: '处理问题' }], summarizer: 'deepseek' }) } }] }));
    signalStarted();
    return new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '已经发送的回复可能仍会交付。' } }] }))); });
  });
  const planned = (await read(await worker.fetch(request('/api/office/plan', { task: '一个可停止的任务', maxCalls: 3 }), env))).body;
  const approved = (await read(await worker.fetch(request('/api/office/approve', { ticket: planned.ticket, plan: planned.plan }), env))).body;
  const running = worker.fetch(request('/api/office/run', { ticket: approved.ticket }), env);
  await started;
  assert.equal((await read(await worker.fetch(request('/api/office/cancel', { ticket: approved.ticket }), env))).body.status, 'cancelled');
  finish();
  const cancelled = (await read(await running)).body;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.results.length, 1);
  assert.equal((await worker.fetch(request('/api/office/run', { ticket: cancelled.ticket }), env)).status, 409);
  assert.equal(calls, 2);
});

test('resuming a draft preserves its consented members even when other providers are configured later', async () => {
  const env = environment(); env.OPENAI_API_KEY = 'test-other-configured-key';
  const worker = createOfficeWorker(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ assignments: [{ provider: 'deepseek', instruction: '完成任务' }], summarizer: 'deepseek' }) } }] })));
  const planned = (await read(await worker.fetch(request('/api/office/plan', { task: '只邀请一个模型', maxCalls: 3, members: ['deepseek'], convener: 'deepseek' }), env))).body;
  assert.deepEqual(planned.members, ['deepseek']); assert.equal(planned.convener, 'deepseek');
  const recovered = (await read(await worker.fetch(request('/api/office/resume', { ticket: planned.ticket }), env))).body;
  assert.deepEqual(recovered.members, ['deepseek']); assert.equal(recovered.convener, 'deepseek');
  const expanded = { ...recovered.plan, assignments: [{ provider: 'openai', instruction: '未同意的成员不能加入旧任务' }], summarizer: 'deepseek' };
  assert.equal((await worker.fetch(request('/api/office/approve', { ticket: recovered.ticket, plan: expanded }), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/office/approve', { ticket: recovered.ticket, plan: recovered.plan }), env)).status, 200);
});

test('explicit provider configuration is encrypted at rest, owner-scoped, single-use, and never returned in status', async () => {
  const env = environment(); let calls = 0;
  const worker = createOfficeWorker(async (url, init) => {
    calls++; assert.equal(init.headers.Authorization, 'Bearer owner-specific-test-key');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ assignments: [{ provider: 'deepseek', instruction: '完成任务' }], summarizer: 'deepseek' }) } }] }));
  });
  const intent = (await read(await worker.fetch(request('/api/providers/configure-intent', { provider: 'deepseek' }), env))).body;
  const payload = { provider: 'deepseek', key: 'owner-specific-test-key', configurationToken: intent.configurationToken };
  const saved = await read(await worker.fetch(request('/api/providers/configure', payload), env));
  assert.equal(saved.status, 200); assert.equal(calls, 0);
  assert.ok(!JSON.stringify(saved).includes(payload.key));
  const stored = await env.DB.prepare('SELECT * FROM office_provider_keys WHERE owner_id = ?').bind('test-owner-id').first();
  assert.ok(!stored.encrypted_key.includes(payload.key));
  assert.ok(JSON.parse(stored.encrypted_key).ciphertext.length > payload.key.length);
  assert.equal((await worker.fetch(request('/api/providers/configure', payload), env)).status, 409);
  const status = await read(await worker.fetch(new Request('https://private.example/api/status', { headers: { 'oai-authenticated-user-id': 'test-owner-id' } }), env));
  assert.ok(!JSON.stringify(status).includes(payload.key));
  assert.ok(!JSON.stringify(status).includes('encrypted_key'));
  assert.equal((await worker.fetch(request('/api/office/plan', { task: '一个真实请求', maxCalls: 3 }), env)).status, 200);
  assert.equal(calls, 1);
  const different = request('/api/providers/configure-intent', { provider: 'deepseek' }); different.headers.set('oai-authenticated-user-id', 'different-owner');
  const anotherIntent = (await read(await worker.fetch(different, env))).body;
  const wrongOwner = request('/api/providers/configure', { ...payload, configurationToken: anotherIntent.configurationToken });
  assert.equal((await worker.fetch(wrongOwner, env)).status, 403);
  const otherStatus = await read(await worker.fetch(new Request('https://private.example/api/status', { headers: { 'oai-authenticated-user-id': 'different-owner' } }), { ...env, DEEPSEEK_API_KEY: undefined }));
  assert.equal(otherStatus.body.providers.find(row => row.id === 'deepseek').configured, false);
});

test('configuration rejects anonymous, cross-site, mismatched provider and header-injection keys before saving', async () => {
  const env = environment(); const worker = createOfficeWorker(() => { throw new Error('must not call provider'); });
  const anonymous = request('/api/providers/configure-intent', { provider: 'deepseek' }); anonymous.headers.delete('oai-authenticated-user-id');
  assert.equal((await worker.fetch(anonymous, env)).status, 401);
  assert.equal((await worker.fetch(request('/api/providers/configure-intent', { provider: 'deepseek' }, 'https://evil.example'), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/providers/configure-intent', { provider: 'unknown' }), env)).status, 400);
  const intent = (await read(await worker.fetch(request('/api/providers/configure-intent', { provider: 'deepseek' }), env))).body;
  assert.equal((await worker.fetch(request('/api/providers/configure', { provider: 'gemini', key: 'a-test-provider-secret', configurationToken: intent.configurationToken }), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/providers/configure', { provider: 'deepseek', key: 'a-test-key\r\nInjected: evil', configurationToken: intent.configurationToken }), env)).status, 400);
  assert.equal((await env.DB.prepare('SELECT count(*) AS count FROM office_provider_keys WHERE owner_id = ?').bind('test-owner-id').first()).count, 0);
});

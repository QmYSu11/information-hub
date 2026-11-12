import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createOfficeWorker, normalizeContext, normalizePlan, safeCitations, selectChatContext } from '../worker.mjs';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_office.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_provider_keys.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_chat.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { return { bind(...values) { return { _sql: sql, _values: values, async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; } }; } }; }, async batch(statements) { sqlite.exec('BEGIN'); try { const result = statements.map(statement => ({ meta: { changes: Number(sqlite.prepare(statement._sql).run(...statement._values).changes) } })); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
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
        assert.equal(payload.text.format.type, 'json_object'); assert.match(payload.input, /JSON/); assert.match(payload.input, /一个通用任务/);
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

test('provider HTTP failures expose only allowlisted diagnostics and distinguish exhausted quota from ordinary rate limiting', async () => {
  const cases = [
    { status: 401, error: { code: 'invalid_api_key', type: 'invalid_request_error' }, category: 'authentication', code: 'invalid_api_key', param: null },
    { status: 429, error: { code: 'insufficient_quota', type: 'insufficient_quota' }, category: 'insufficient_quota', code: 'insufficient_quota', param: null },
    { status: 429, error: { code: 'rate_limit_exceeded', type: 'tokens' }, category: 'rate_limit', code: 'rate_limit_exceeded', param: null },
    { status: 404, error: { code: 'model_not_found', param: 'model' }, category: 'model_access', code: 'model_not_found', param: 'model' },
    { status: 400, error: { code: 'unsupported_parameter', type: 'invalid_request_error', param: 'text.format' }, category: 'invalid_request', code: 'unsupported_parameter', param: 'text.format' },
    { status: 403, error: { code: 'unsupported_country_region_territory' }, category: 'region_access', code: 'unsupported_country_region_territory', param: null },
    { status: 503, error: { code: 'service_unavailable', type: 'server_error' }, category: 'service', code: 'service_unavailable', param: null },
    { status: 429, error: { code: 'never-echo-provider-secret', type: 'never-echo-provider-secret', param: 'never-echo-provider-secret' }, category: 'quota_or_rate_limit', code: null, param: null },
    { status: 429, error: { status: 'RESOURCE_EXHAUSTED', details: [{ reason: 'QUOTA_EXCEEDED', metadata: { key: 'never-echo-provider-secret' } }] }, category: 'quota_or_rate_limit', code: 'QUOTA_EXCEEDED', param: null },
    { status: 429, error: { status: 'RESOURCE_EXHAUSTED', details: [{ reason: 'RATE_LIMIT_EXCEEDED' }] }, category: 'rate_limit', code: 'RATE_LIMIT_EXCEEDED', param: null },
    { status: 429, error: { type: 'invalid_request_error' }, category: 'quota_or_rate_limit', code: null, param: null },
    { status: 404, error: { type: 'invalid_request_error' }, category: 'not_found', code: null, param: null },
    { status: 503, error: { type: 'invalid_request_error' }, category: 'service', code: null, param: null },
  ];
  for (const fixture of cases) {
    const env = environment(); delete env.DEEPSEEK_API_KEY; env.OPENAI_API_KEY = 'test-openai-secret';
    let calls = 0; const logs = [];
    const worker = createOfficeWorker(async () => { calls++; return new Response(JSON.stringify({ error: { ...fixture.error, message: 'never-echo-provider-secret', request: { authorization: 'never-echo-provider-secret' } } }), { status: fixture.status, headers: { 'x-debug-private': 'never-echo-provider-secret' } }); }, value => logs.push(value));
    const result = await read(await worker.fetch(request('/api/office/plan', { task: '诊断测试', maxCalls: 3 }), env));
    assert.equal(calls, 1); assert.equal(result.status, 502);
    assert.equal(result.body.diagnostic.httpStatus, fixture.status);
    assert.equal(result.body.diagnostic.category, fixture.category);
    assert.equal(result.body.diagnostic.code, fixture.code);
    assert.equal(result.body.diagnostic.param, fixture.param);
    assert.match(result.body.error, new RegExp('HTTP ' + fixture.status));
    assert.deepEqual(logs, [result.body.diagnostic]);
    assert.ok(!JSON.stringify({ result, logs }).includes('never-echo-provider-secret'));
    assert.ok(!JSON.stringify({ result, logs }).includes('test-openai-secret'));
    assert.deepEqual(Object.keys(logs[0]).sort(), ['provider', 'httpStatus', 'category', 'code', 'type', 'param'].sort());
  }
});

test('non-JSON errors and transport failures remain diagnosable without reading them as authentication or echoing content', async () => {
  const env = environment();
  for (const fixture of [
    { fetch: async () => new Response('<html>never-echo-provider-secret</html>', { status: 403 }), category: 'permission', httpStatus: 403 },
    { fetch: async () => new Response('{"error":', { status: 400 }), category: 'invalid_request', httpStatus: 400 },
    { fetch: async () => { throw new TypeError('never-echo-provider-secret'); }, category: 'transport', httpStatus: null },
  ]) {
    const logs = [];
    const worker = createOfficeWorker(fixture.fetch, value => logs.push(value));
    const result = await read(await worker.fetch(request('/api/office/plan', { task: '网络诊断测试' }), env));
    assert.equal(result.status, 502); assert.equal(result.body.diagnostic.category, fixture.category); assert.equal(result.body.diagnostic.httpStatus, fixture.httpStatus);
    assert.ok(!JSON.stringify({ result, logs }).includes('never-echo-provider-secret'));
    assert.equal(logs.length, 1);
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

const chatRequest = body => request('/api/chat/send', { requestId: crypto.randomUUID(), provider: 'deepseek', ...body });
const chatGet = (path, owner = 'test-owner-id') => new Request('https://private.example' + path, { headers: { 'oai-authenticated-user-id': owner } });
function modelReply(provider, text) {
  if (provider === 'openai') return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 5, output_tokens: 3 } }));
  if (provider === 'gemini') return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } }));
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
}

test('continuous chat carries real user/assistant history in each provider protocol and survives refresh without extra calls', async () => {
  for (const provider of ['deepseek', 'openai', 'gemini']) {
    const env = environment(); env.OPENAI_API_KEY = 'test-openai-key'; env.GEMINI_API_KEY = 'test-gemini-key';
    let calls = 0;
    const worker = createOfficeWorker(async (url, init) => {
      calls++; assert.ok(!url.includes('snapshot'));
      const payload = JSON.parse(init.body);
      const history = provider === 'deepseek' ? payload.messages.slice(1) : provider === 'openai' ? payload.input : payload.contents;
      assert.equal(history.length, calls === 1 ? 1 : 3);
      assert.equal(history[0].role, 'user');
      if (calls === 2) {
        assert.equal(history[1].role, provider === 'gemini' ? 'model' : 'assistant');
        assert.match(JSON.stringify(history[0]), /我的名字是小林/);
        assert.match(JSON.stringify(history[1]), /第一轮已记住/);
        assert.match(JSON.stringify(history[2]), /我叫什么/);
      }
      return modelReply(provider, calls === 1 ? '第一轮已记住。' : '你叫小林。');
    });
    const first = await read(await worker.fetch(chatRequest({ provider, message: '我的名字是小林' }), env));
    assert.equal(first.status, 200); assert.equal(first.body.messages.length, 2); assert.equal(first.body.contextMessageCount, 1);
    assert.deepEqual(first.body.messages[0].materials, []); assert.deepEqual(first.body.messages[0].watchSymbols, []);
    const second = await read(await worker.fetch(chatRequest({ provider, message: '我叫什么？', conversationId: first.body.id }), env));
    assert.equal(second.status, 200); assert.equal(second.body.messages.length, 4); assert.equal(second.body.contextMessageCount, 3); assert.equal(second.body.usedCalls, 2);
    const refreshed = await read(await worker.fetch(chatGet('/api/chat/conversations/' + first.body.id), env));
    assert.equal(refreshed.body.messages[3].text, '你叫小林。'); assert.equal(refreshed.body.contextMessageCount, 3); assert.equal(calls, 2);
    assert.ok(Number.isFinite(Date.parse(refreshed.body.updatedAt))); assert.ok(Number.isFinite(Date.parse(refreshed.body.messages[0].createdAt)));
    const listed = await read(await worker.fetch(chatGet('/api/chat/conversations'), env));
    assert.equal(listed.body.conversations.length, 1); assert.equal(listed.body.conversations[0].provider, provider);
  }
});

test('chat request IDs are idempotent, content-bound, owner-scoped and never transfer old history to another provider', async () => {
  const env = environment(); env.OPENAI_API_KEY = 'test-openai-key'; let calls = 0;
  const worker = createOfficeWorker(async () => { calls++; return modelReply('deepseek', '已收到。'); });
  const requestId = crypto.randomUUID(); const body = { provider: 'deepseek', requestId, message: '一条明确消息' };
  const first = (await read(await worker.fetch(request('/api/chat/send', body), env))).body;
  const replay = await read(await worker.fetch(request('/api/chat/send', body), env));
  assert.equal(replay.status, 200); assert.equal(replay.body.id, first.id); assert.equal(calls, 1); assert.equal(replay.body.usedCalls, 1);
  assert.equal((await worker.fetch(request('/api/chat/send', { ...body, requestId: requestId.toUpperCase() }), env)).status, 200); assert.equal(calls, 1);
  assert.equal((await worker.fetch(request('/api/chat/send', { ...body, message: '改写同一编号的消息' }), env)).status, 409);
  assert.equal((await worker.fetch(chatRequest({ conversationId: first.id, provider: 'openai', message: '把旧历史转给另一个品牌' }), env)).status, 409);
  assert.equal((await worker.fetch(chatGet('/api/chat/conversations/' + first.id, 'another-owner'), env)).status, 404);
  const wrongOwner = chatRequest({ conversationId: first.id, message: '不能访问' }); wrongOwner.headers.set('oai-authenticated-user-id', 'another-owner');
  assert.equal((await worker.fetch(wrongOwner, env)).status, 404);
  assert.equal((await worker.fetch(request('/api/chat/send', { ...body, requestId: 'not-a-uuid' }), env)).status, 400);
  const crossSite = chatRequest({ message: '跨站消息' }); crossSite.headers.set('Origin', 'https://evil.example');
  assert.equal((await worker.fetch(crossSite, env)).status, 403); assert.equal(calls, 1);
});

test('a failed chat returns its conversation ID, never retries the same request, and allows a new message without failed history', async () => {
  const env = environment(); let calls = 0;
  const worker = createOfficeWorker(async (url, init) => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'never-echo-secret' } }), { status: 429 });
    const history = JSON.parse(init.body).messages.slice(1);
    assert.equal(history.length, 1); assert.match(history[0].content, /换个问题/); assert.ok(!history[0].content.includes('失败尝试'));
    return modelReply('deepseek', '新的问题可以继续。');
  }, () => {});
  const body = { provider: 'deepseek', requestId: crypto.randomUUID(), message: '失败尝试' };
  const failed = await read(await worker.fetch(request('/api/chat/send', body), env));
  assert.equal(failed.status, 502); assert.ok(failed.body.conversationId); assert.ok(!JSON.stringify(failed).includes('never-echo-secret'));
  const replay = await read(await worker.fetch(request('/api/chat/send', body), env));
  assert.equal(replay.status, 502); assert.equal(replay.body.conversationId, failed.body.conversationId); assert.equal(calls, 1);
  const next = await read(await worker.fetch(chatRequest({ conversationId: failed.body.conversationId, message: '换个问题' }), env));
  assert.equal(next.status, 200); assert.equal(calls, 2); assert.equal(next.body.messages.length, 3); assert.equal(next.body.messages[0].deliveryStatus, 'failed'); assert.equal(next.body.pending, false);
});

test('a conversation has one atomic active request, and a late expired response cannot overwrite a newer turn or lock', async () => {
  const env = environment(); let calls = 0; let finishFirst; let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const worker = createOfficeWorker(async () => {
    calls++;
    if (calls === 1) { started(); return new Promise(resolve => { finishFirst = () => resolve(modelReply('deepseek', '迟到的旧回复')); }); }
    return modelReply('deepseek', '新一轮正常回复');
  });
  const firstRequest = chatRequest({ message: '第一条正在等待' });
  const firstRun = worker.fetch(firstRequest, env); await waiting;
  const listed = (await read(await worker.fetch(chatGet('/api/chat/conversations'), env))).body;
  const id = listed.conversations[0].id;
  const pending = await read(await worker.fetch(chatGet('/api/chat/conversations/' + id), env));
  assert.equal(pending.body.pending, true);
  const busy = await read(await worker.fetch(chatRequest({ conversationId: id, message: '不能并发发送' }), env));
  assert.equal(busy.status, 409); assert.equal(busy.body.conversationId, id); assert.equal(calls, 1);
  await env.DB.prepare('UPDATE office_chat_conversations SET lock_until = ? WHERE id = ?').bind(Date.now() - 100, id).run();
  const newer = await read(await worker.fetch(chatRequest({ conversationId: id, message: '过期后继续的新一轮' }), env));
  assert.equal(newer.status, 200); assert.equal(calls, 2);
  finishFirst();
  assert.equal((await firstRun).status, 409);
  const final = (await read(await worker.fetch(chatGet('/api/chat/conversations/' + id), env))).body;
  assert.equal(final.messages.at(-1).text, '新一轮正常回复'); assert.equal(final.pending, false);
  assert.ok(!JSON.stringify(final).includes('迟到的旧回复'));
});

test('news attachments are mapped from the real snapshot by ID, persisted, and cited from actual historical context', async () => {
  const env = environment(); let modelCalls = 0; let feedCalls = 0;
  const feed = { sources: [{ id: 'source', label: '测试真实来源' }], items: [{ id: 'news-one', sourceId: 'source', title: '真实来源标题', description: '短摘要', url: 'https://example.com/original', fetchedAt: '2026-11-12T00:00:00Z', channel: '科技', kind: 'article' }] };
  const worker = createOfficeWorker(async (url, init) => {
    if (url.includes('snapshot.json')) { feedCalls++; return new Response(JSON.stringify(feed)); }
    modelCalls++;
    const history = JSON.parse(init.body).messages.slice(1);
    assert.match(JSON.stringify(history), /真实来源标题/); assert.ok(!JSON.stringify(history).includes('evil.example')); assert.ok(!JSON.stringify(history).includes('https://example.com/original'));
    return modelReply('deepseek', '这条值得看[来源:news-one]，未知来源不引用[来源:invented]');
  });
  const first = (await read(await worker.fetch(chatRequest({ message: '挑一条有趣内容', intent: 'curation', materials: [{ id: 'news-one', title: '伪造客户端标题', url: 'https://evil.example' }] }), env))).body;
  assert.equal(first.messages[0].materials[0].title, '真实来源标题'); assert.equal(first.messages[1].references[0].url, 'https://example.com/original'); assert.match(first.messages[1].text, /未匹配来源/);
  const follow = (await read(await worker.fetch(chatRequest({ conversationId: first.id, message: '再解释一下它为什么有趣' }), env))).body;
  assert.equal(feedCalls, 1); assert.equal(modelCalls, 2); assert.equal(follow.messages.at(-1).references[0].id, 'news-one');
  const missing = await read(await worker.fetch(chatRequest({ conversationId: first.id, message: '不存在的材料', materials: [{ id: 'missing', url: 'https://evil.example' }] }), env));
  assert.equal(missing.status, 409); assert.equal(missing.body.conversationId, first.id); assert.equal(modelCalls, 2);
});

test('chat context limits count attached data while archive and daily limits reject instead of deleting history or calling again', async () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: 'x'.repeat(1800), materials: [], watchSymbols: [], intent: 'general' }));
  rows.push({ role: 'user', text: '最新问题', intent: 'curation', materials: [{ id: 'item', title: '附料'.repeat(900) }] });
  const context = selectChatContext(rows);
  assert.ok(context.history.length <= 20); assert.ok(context.history.reduce((sum, row) => sum + row.content.length, 0) <= 24_000); assert.equal(context.history[0].role, 'user'); assert.equal(context.limited, true);
  const env = environment(); env.OFFICE_DAILY_CALL_LIMIT = '1'; let calls = 0;
  const worker = createOfficeWorker(async () => { calls++; return modelReply('deepseek', '已回复。'); });
  const first = (await read(await worker.fetch(chatRequest({ message: '正常第一条' }), env))).body;
  const denied = await read(await worker.fetch(chatRequest({ conversationId: first.id, message: '日预算不足时不调用模型' }), env));
  assert.equal(denied.status, 429); assert.equal(denied.body.conversationId, first.id); assert.equal(calls, 1);
  const saved = (await read(await worker.fetch(chatGet('/api/chat/conversations/' + first.id), env))).body;
  assert.equal(saved.messages.length, 3); assert.equal(saved.messages[2].deliveryStatus, 'failed');
  await env.DB.prepare('UPDATE office_chat_messages SET text = ? WHERE id = ?').bind('x'.repeat(239_000), saved.messages[0].id).run();
  const tooLarge = await read(await worker.fetch(chatRequest({ conversationId: first.id, message: '不能静默删除旧记录' }), env));
  assert.equal(tooLarge.status, 413); assert.equal(calls, 1);
  assert.equal((await env.DB.prepare('SELECT length(text) AS length FROM office_chat_messages WHERE id = ?').bind(saved.messages[0].id).first()).length, 239_000);
  await env.DB.prepare('UPDATE office_chat_conversations SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, first.id).run();
  assert.equal((await worker.fetch(chatGet('/api/chat/conversations/' + first.id), env)).status, 404);
});

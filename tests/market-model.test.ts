import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol, resolveInstrument, searchInstruments, migrateWatchlist, parseInstrument } from '../src/lib/market-model';
import { emptyPersonal, mergeBackup, parseBackup } from '../src/lib/personal-model';

test('qualified codes and explicit Chinese exchange notation normalize without guessing an exchange', () => {
  assert.equal(normalizeSymbol(' nasdaq:aapl '), 'NASDAQ:AAPL');
  assert.equal(normalizeSymbol('AAPL'), 'NASDAQ:AAPL');
  assert.equal(normalizeSymbol('sh600519'), 'SSE:600519');
  assert.equal(normalizeSymbol('600519.SH'), 'SSE:600519');
  assert.equal(normalizeSymbol('300750.SZ'), 'SZSE:300750');
  assert.equal(normalizeSymbol('bj830799'), null);
  assert.equal(normalizeSymbol('920002.BJ'), null);
  assert.equal(normalizeSymbol('600519'), 'SSE:600519');
  assert.equal(normalizeSymbol('000001'), null);
  assert.equal(normalizeSymbol('002999'), null);
  assert.equal(normalizeSymbol('.SH'), null);
});
test('code normalization rejects script payloads, URLs and malformed market identifiers', () => {
  for (const code of ['javascript:alert(1)', 'JAVASCRIPT:ALERT', 'https://evil.example/x', 'NASDAQ:AAPL<script>', 'NYSE:AAPL" onclick="bad', 'SSE:12345', 'NASDAQ:' + 'A'.repeat(80)])
    assert.equal(normalizeSymbol(code), null, code);
});
test('local catalog searches Chinese names, aliases and tickers while ambiguity remains visible', () => {
  assert.equal(searchInstruments('英伟达')[0].symbol, 'NASDAQ:NVDA');
  assert.equal(searchInstruments('nvidia')[0].symbol, 'NASDAQ:NVDA');
  assert.equal(searchInstruments('600519')[0].name, '贵州茅台');
  assert.deepEqual(new Set(searchInstruments('000001').map(x => x.symbol)), new Set(['SSE:000001', 'SZSE:000001']));
  assert.equal(resolveInstrument('000001'), null);
});
test('valid custom codes remain explicitly unverified and preserve their selected market', () => {
  const candidate = resolveInstrument('NYSE:ABCD')!;
  assert.equal(candidate.market, '美股');
  assert.equal(candidate.name, 'NYSE:ABCD');
  assert.match(candidate.description!, /尚未核实/);
  const custom = parseInstrument({ ...candidate, name: '我的关注', aliases: ['自定义', '自定义'] });
  assert.equal(resolveInstrument('我的关注', [custom])?.symbol, candidate.symbol);
  assert.equal(searchInstruments('自定义', [custom])[0].id, candidate.id);
  assert.deepEqual(custom.aliases, ['自定义']);
  assert.equal(resolveInstrument('HKEX:700')?.kind, 'stock');
  assert.equal(resolveInstrument('BSE:500325')?.market, '其他');
  assert.equal(resolveInstrument('BSE:500325')?.currency, 'INR');
  assert.equal(resolveInstrument('UNKNOWN:FOO')?.kind, 'other');
});
test('legacy watchlists migrate without dropping unknown IDs or duplicating the same symbol', () => {
  assert.deepEqual(migrateWatchlist(['usAAPL', 'NASDAQ:AAPL', 'sh000001', 'us.INX', 'hf_XAU', 'my-old-adapter-id']),
    ['NASDAQ:AAPL', 'SSE:000001', 'FOREXCOM:SPXUSD', 'OANDA:XAUUSD', 'my-old-adapter-id']);
});
test('old backups remain readable and new instrument and chart preferences survive full backup roundtrip', () => {
  const old = emptyPersonal();
  old.preferences.watchlist = ['usAAPL', 'unrecognized-old-id'];
  const restoredOld = parseBackup(JSON.stringify(old));
  assert.deepEqual(restoredOld.preferences.watchlist, old.preferences.watchlist);
  const custom = parseInstrument({ ...resolveInstrument('NYSE:ABCD')!, name: '我的标的', kind: 'fund' });
  old.preferences.customSymbols = [custom];
  old.preferences.activeSymbol = custom.symbol;
  old.preferences.chartInterval = '15';
  old.preferences.chartStyle = 'line';
  const restored = parseBackup(JSON.stringify({ format: 'information-study-backup', data: old }));
  assert.deepEqual(restored.preferences.customSymbols, [custom]);
  assert.equal(restored.preferences.activeSymbol, custom.symbol);
  assert.equal(restored.preferences.chartInterval, '15');
  assert.equal(restored.preferences.chartStyle, 'line');
});
test('invalid custom instrument or chart preferences reject the whole backup before changing current records', () => {
  const data = emptyPersonal(); const before = JSON.stringify(data);
  const custom = resolveInstrument('NASDAQ:NVDA')!;
  for (const p of [
    { customSymbols: [{ ...custom, symbol: 'javascript:alert(1)' }] },
    { customSymbols: [{ ...custom, exchange: 'NYSE' }] },
    { customSymbols: [{ ...custom, kind: 'imaginary' }] },
    { activeSymbol: '<script>' }, { chartInterval: 'invalid' }, { chartStyle: 'html' },
  ]) assert.throws(() => parseBackup(JSON.stringify({ ...data, preferences: { ...data.preferences, ...p } })));
  assert.equal(JSON.stringify(data), before);
});
test('backup merge preserves current custom instruments and chart preferences when importing an older backup', () => {
  const current = emptyPersonal(); const incoming = emptyPersonal();
  const custom = { ...resolveInstrument('NYSE:ABCD')!, name: '本机基金', kind: 'fund' as const };
  current.preferences.customSymbols = [custom];
  current.preferences.activeSymbol = custom.symbol;
  current.preferences.chartInterval = '5'; current.preferences.chartStyle = 'line';
  current.preferences.watchlist = ['usAAPL', custom.symbol, 'unknown-old'];
  incoming.preferences.watchlist = ['NASDAQ:AAPL', 'sh000001'];
  const merged = mergeBackup(current, incoming);
  assert.deepEqual(merged.preferences.customSymbols, [custom]);
  assert.equal(merged.preferences.activeSymbol, custom.symbol);
  assert.equal(merged.preferences.chartInterval, '5');
  assert.equal(merged.preferences.chartStyle, 'line');
  assert.deepEqual(merged.preferences.watchlist, ['NASDAQ:AAPL', custom.symbol, 'unknown-old', 'SSE:000001']);
  assert.deepEqual(current.preferences.watchlist, ['usAAPL', custom.symbol, 'unknown-old']);
});
test('custom instrument merge deduplicates canonical IDs and keeps both distinct instruments', () => {
  const current = emptyPersonal(); const incoming = emptyPersonal();
  current.preferences.customSymbols = [{ ...resolveInstrument('NYSE:ABCD')!, name: '旧名称' }];
  incoming.preferences.customSymbols = [{ ...resolveInstrument('NYSE:ABCD')!, name: '新名称' }, resolveInstrument('NASDAQ:ZZZZ')!];
  const merged = mergeBackup(current, incoming);
  assert.equal(merged.preferences.customSymbols?.length, 2);
  assert.equal(merged.preferences.customSymbols?.[0].name, '新名称');
});

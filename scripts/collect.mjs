import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertPublicSnapshot, parseRSS, parseBilibili, parseWeibo, preserveFailedSource } from './data-utils.mjs';
import { collectOptionalQuotes, emptyQuotes } from './quotes.mjs';
import { collectXiaohongshu } from './xiaohongshu.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(project, 'public/data/snapshot.json');
const now = new Date().toISOString();
const feeds = [
  { id: 'cns-china', label: '中新网 · 国内', channel: '国内', homepage: 'https://www.chinanews.com.cn/china/', endpoint: 'https://www.chinanews.com.cn/rss/china.xml' },
  { id: 'cns-world', label: '中新网 · 国际', channel: '国际', homepage: 'https://www.chinanews.com.cn/world/', endpoint: 'https://www.chinanews.com.cn/rss/world.xml' },
  { id: 'cns-finance', label: '中新网 · 财经', channel: '财经', homepage: 'https://www.chinanews.com.cn/finance/', endpoint: 'https://www.chinanews.com.cn/rss/finance.xml' },
  { id: 'cns-society', label: '中新网 · 社会', channel: '趣事', homepage: 'https://www.chinanews.com.cn/society/', endpoint: 'https://www.chinanews.com.cn/rss/society.xml' },
  { id: 'npr-world', label: 'NPR · World', channel: '国际', homepage: 'https://www.npr.org/sections/world/', endpoint: 'https://feeds.npr.org/1004/rss.xml' },
  { id: 'ithome-tech', label: 'IT之家 · 科技', channel: '科技', homepage: 'https://www.ithome.com/', endpoint: 'https://www.ithome.com/rss/' },
].map(s => ({ ...s, category: 'news', attribution: s.label + ' · 标题、短摘要，全文请访问原站' }));

const trends = [
  { id: 'bilibili-rank', label: 'B 站 · 综合排行榜', category: 'trends', platform: 'bilibili', homepage: 'https://www.bilibili.com/v/popular/rank/all', endpoint: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', parser: parseBilibili, attribution: '哔哩哔哩 · 原榜单顺序，热度为原平台播放数' },
  { id: 'weibo-hot', label: '微博 · 热搜', category: 'trends', platform: 'weibo', homepage: 'https://s.weibo.com/top/summary', endpoint: 'https://weibo.com/ajax/side/hotSearch', parser: parseWeibo, attribution: '微博 · 原平台热搜' },
];

let previous = { sources: [], items: [], quotes: [] };
try { previous = assertPublicSnapshot(JSON.parse(await readFile(output, 'utf8'))); } catch { /* First run: no successful cache. */ }

export async function fetchPublic(url, { json = false, encoding = 'utf-8' } = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(18000),
    headers: { 'User-Agent': 'InformationStudy/1.0 (personal news reader)', Accept: json ? 'application/json' : 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
  });
  if (!response.ok) throw new Error('来源返回 HTTP ' + response.status);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 3_000_000) throw new Error('来源响应过大');
  const text = new TextDecoder(encoding).decode(buffer);
  return json ? JSON.parse(text) : text;
}

const results = await Promise.all([...feeds, ...trends].map(async (definition) => {
  const { endpoint, parser, ...source } = definition;
  try {
    const raw = await fetchPublic(endpoint, { json: Boolean(parser) });
    const items = parser ? parser(raw, source.id, now) : parseRSS(raw, source, now);
    if (!items.length) throw new Error('来源没有可用条目');
    console.log('OK', source.id, items.length + ' 条');
    return { source: { ...source, status: 'ok', lastSuccessAt: now, lastAttemptAt: now }, items };
  } catch (error) {
    const message = error.name === 'TimeoutError' ? '来源连接超时；可打开原站查看' : error.message === 'fetch failed' ? '当前采集环境无法连接来源；可打开原站查看' : error.message;
    console.log('UNAVAILABLE', source.id, message);
    return preserveFailedSource(source, previous, now, message);
  }
}));

const quoteResult = await collectOptionalQuotes({ now, previous, fetchPublic });
const xiaohongshuResult = await collectXiaohongshu({ now, previous });
const snapshot = assertPublicSnapshot({
  schemaVersion: 1,
  generationId: randomUUID(),
  generatedAt: now,
  sources: [
    ...results.map(r => r.source),
    xiaohongshuResult.source,
    ...quoteResult.sources,
  ],
  items: [...results.flatMap(r => r.items), ...xiaohongshuResult.items],
  quotes: quoteResult.quotes.length ? quoteResult.quotes : emptyQuotes(now),
});

await mkdir(dirname(output), { recursive: true });
await writeFile(output + '.tmp', JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
await rename(output + '.tmp', output);
console.log('Saved', snapshot.items.length + ' 条内容，' + snapshot.sources.filter(s => s.status === 'ok').length + ' 个来源成功；未成功来源保持缓存时间。');
if (!results.some(r => r.source.status === 'ok')) process.exitCode = 2;

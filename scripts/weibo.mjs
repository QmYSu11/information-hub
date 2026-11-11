import { formatCount, normalizeUrl, preserveFailedSource, safeUrl, stableId, textOnly } from './data-utils.mjs';

export const WEIBO_SOURCE = Object.freeze({
  id: 'weibo-hot', label: '微博 · 热搜', category: 'trends', platform: 'weibo',
  homepage: 'https://s.weibo.com/top/summary', attribution: '微博 · 原平台热搜',
});
export const WEIBO_ENDPOINTS = Object.freeze({
  official: 'https://weibo.com/ajax/side/hotSearch',
  uapi: 'https://uapis.cn/api/v1/misc/hotboard?type=weibo',
});

function topic(title, rank, url, heat, now) {
  return {
    id: stableId(WEIBO_SOURCE.id, url), sourceId: WEIBO_SOURCE.id,
    title, url, rank, channel: '趣事', kind: 'topic', fetchedAt: now, bodyAllowed: false,
    ...(heat ? { heat } : {}),
  };
}

export function parseOfficialWeibo(data, now) {
  if (data?.ok === 0 || !Array.isArray(data?.data?.realtime)) throw new Error('微博官方热搜暂不可用');
  const seen = new Set();
  const items = [];
  for (const [index, entry] of data.data.realtime.entries()) {
    if (!entry || entry.is_ad || entry.isAd) continue;
    const title = textOnly(entry.word, 180);
    if (!title || seen.has(title)) continue;
    const rank = Number.isInteger(entry.realpos) && entry.realpos >= 1 ? entry.realpos
      : Number.isInteger(entry.rank) && entry.rank >= 0 ? entry.rank + 1 : index + 1;
    const url = 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + title + '#') + '&t=31';
    const heat = Number.isFinite(entry.num) && entry.num >= 0 ? formatCount(entry.num) + ' 热度' : undefined;
    items.push(topic(title, rank, url, heat, now));
    seen.add(title);
    if (items.length >= 50) break;
  }
  if (!items.length) throw new Error('微博官方热搜没有可用条目');
  return items;
}

/** Only the documented current Weibo list is accepted; history/search envelopes are not current news. */
export function parseUapiWeibo(data, now) {
  if (data?.type !== 'weibo' || !Array.isArray(data.list)) throw new Error('免费备用热搜结构暂不兼容');
  const timestamp = typeof data.update_time === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(data.update_time)
    ? Date.parse(data.update_time) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2000, 0, 1) || timestamp > Date.parse(now) + 300_000)
    throw new Error('免费备用榜单未提供有效更新时间');
  if (Date.parse(now) - timestamp > 2 * 60 * 60_000) throw new Error('免费备用榜单更新已延迟');
  const seen = new Set();
  const ranks = new Set();
  const items = [];
  for (const entry of data.list) {
    if (!entry || !Number.isInteger(entry.index) || entry.index < 1 || entry.index > 1000 || ranks.has(entry.index)) continue;
    const title = textOnly(entry.title, 180);
    const candidate = safeUrl(entry.url);
    if (!title || !candidate) continue;
    const parsed = new URL(candidate);
    if (parsed.hostname !== 's.weibo.com' || parsed.pathname !== '/weibo' || !parsed.searchParams.get('q')) continue;
    const url = normalizeUrl(candidate);
    if (!url || seen.has(url)) continue;
    const rawHeat = typeof entry.hot_value === 'number' && Number.isFinite(entry.hot_value) && entry.hot_value >= 0
      ? String(entry.hot_value) : textOnly(entry.hot_value, 32);
    const heat = /^\d[\d.,万千亿kKmMwW+\s]*$/.test(rawHeat) ? rawHeat + ' 热度' : undefined;
    items.push(topic(title, entry.index, url, heat, now));
    seen.add(url); ranks.add(entry.index);
    if (items.length >= 50) break;
  }
  if (!items.length) throw new Error('免费备用热搜没有可用条目');
  return { items, updatedAt: new Date(timestamp).toISOString() };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(18000),
    headers: { 'User-Agent': 'InformationStudy/1.0 (personal news reader)', Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('来源暂不可用');
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > 3_000_000) throw new Error('来源响应超过大小限制');
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 3_000_000) throw new Error('来源响应超过大小限制');
  return JSON.parse(text);
}

export async function collectWeibo({ now, previous, fetchImpl = globalThis.fetch }) {
  try {
    const items = parseOfficialWeibo(await fetchJson(fetchImpl, WEIBO_ENDPOINTS.official), now);
    return { source: { ...WEIBO_SOURCE, status: 'ok', lastSuccessAt: now, lastAttemptAt: now, message: '微博官方公开热搜；完整讨论请访问原站。' }, items };
  } catch { /* Try only the documented public no-key fallback; do not copy login cookies. */ }
  let fallbackMessage;
  try {
    const { items, updatedAt } = parseUapiWeibo(await fetchJson(fetchImpl, WEIBO_ENDPOINTS.uapi), now);
    const displayTime = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(updatedAt));
    return {
      source: {
        ...WEIBO_SOURCE, attribution: '微博热搜 · UAPI 免费公开聚合，非微博官方接口',
        status: 'ok', lastSuccessAt: now, lastAttemptAt: now,
        upstreamUpdatedAt: updatedAt,
        message: '官方接口暂不可用，当前通过 UAPI 免费公开榜单更新；榜单时间 ' + displayTime + ' 北京时间。',
      }, items,
    };
  } catch (error) {
    fallbackMessage = error?.message === '免费备用榜单更新已延迟'
      ? '免费备用榜单更新已延迟，未将旧榜作为实时热搜发布。' : '微博官方及免费备用来源暂不可用。';
  }
  const oldSource = previous.sources?.find(source => source.id === WEIBO_SOURCE.id);
  return preserveFailedSource({
    ...WEIBO_SOURCE, attribution: oldSource?.attribution || WEIBO_SOURCE.attribution,
    ...(typeof oldSource?.upstreamUpdatedAt === 'string' && Number.isFinite(Date.parse(oldSource.upstreamUpdatedAt))
      ? { upstreamUpdatedAt: oldSource.upstreamUpdatedAt } : {}),
  }, previous, now,
    fallbackMessage + '保留最近成功内容；可前往原站查看。');
}

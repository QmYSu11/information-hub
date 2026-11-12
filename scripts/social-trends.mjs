import { normalizeUrl, preserveFailedSource, safeUrl, stableId, textOnly } from './data-utils.mjs';

export const SOCIAL_SOURCES = Object.freeze({
  tieba: { id: 'tieba-hot', label: '贴吧 · 热议', category: 'trends', platform: 'tieba', homepage: 'https://tieba.baidu.com/', attribution: '百度贴吧 · 当前热议话题' },
  zhihu: { id: 'zhihu-hot', label: '知乎 · 热榜', category: 'trends', platform: 'zhihu', homepage: 'https://www.zhihu.com/hot', attribution: '知乎热榜 · UAPI 免费公开聚合，非知乎官方接口' },
});
export const SOCIAL_ENDPOINTS = Object.freeze({
  tieba: 'https://tieba.baidu.com/hottopic/browse/topicList',
  tiebaFallback: 'https://uapis.cn/api/v1/misc/hotboard?type=tieba',
  zhihu: 'https://uapis.cn/api/v1/misc/hotboard?type=zhihu',
  twitter: 'https://api.sandbase.ai/v1/api/twitter/web/trending',
});
const countries = Object.freeze({
  UnitedStates: '美国', Japan: '日本', UnitedKingdom: '英国', India: '印度', China: '中国',
  SouthKorea: '韩国', Germany: '德国', France: '法国', Canada: '加拿大', Australia: '澳大利亚', Brazil: '巴西',
});
const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
function boardTime(value, now) {
  const ms = timestamp(value);
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.parse(now) + 300_000) throw new Error('榜单未提供有效更新时间');
  if (Date.parse(now) - ms > 2 * 60 * 60_000) throw new Error('榜单更新已延迟');
  return new Date(ms).toISOString();
}
function displayTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) + ' 北京时间';
}
function topic(source, title, url, now, extra = {}) {
  return { id: stableId(source.id, url), sourceId: source.id, title, url, channel: '趣事', kind: 'topic', fetchedAt: now, bodyAllowed: false, ...extra };
}
function approvedTopicUrl(value, platform) {
  const safe = safeUrl(textOnly(value, 4000));
  if (!safe) return undefined;
  const url = new URL(safe);
  if (platform === 'zhihu' && ['www.zhihu.com', 'zhihu.com'].includes(url.hostname) && /^\/question\/\d+(?:\/answer\/\d+)?\/?$/.test(url.pathname)) return normalizeUrl(safe);
  if (platform === 'tieba' && url.hostname === 'tieba.baidu.com' && url.pathname === '/hottopic/browse/hottopic' && /^\d+$/.test(url.searchParams.get('topic_id') || '')) return normalizeUrl(safe);
  return undefined;
}
function approvedCover(value, platform) {
  const safe = safeUrl(value);
  if (!safe) return undefined;
  const host = new URL(safe).hostname;
  const bases = platform === 'tieba' ? ['baidu.com', 'bdstatic.com'] : ['zhimg.com'];
  return bases.some(base => host === base || host.endsWith('.' + base)) ? safe : undefined;
}
function publicHeat(value) {
  const raw = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : textOnly(value, 40);
  return /^\d[\d.,万千亿kKmMwW+\s]*(?:热度|讨论|浏览|阅读)?$/.test(raw) ? raw : undefined;
}

export function parseUapiSocial(data, platform, now) {
  const source = SOCIAL_SOURCES[platform];
  if (!source || data?.type !== platform || !Array.isArray(data.list)) throw new Error('榜单响应结构暂不兼容');
  const updatedAt = boardTime(data.update_time, now);
  const seen = new Set(), ranks = new Set(), items = [];
  for (const entry of data.list) {
    if (!entry || !Number.isInteger(entry.index) || entry.index < 1 || entry.index > 1000 || ranks.has(entry.index)) continue;
    const title = textOnly(entry.title, 180), url = approvedTopicUrl(entry.url, platform);
    if (!title || !url || seen.has(url)) continue;
    const heat = publicHeat(entry.hot_value);
    const description = textOnly(entry.extra?.desc, 180);
    const image = approvedCover(entry.cover || entry.extra?.cover, platform);
    items.push(topic(source, title, url, now, { rank: entry.index, ...(heat ? { heat } : {}), ...(description ? { description } : {}), ...(image ? { image } : {}) }));
    seen.add(url); ranks.add(entry.index);
    if (items.length >= 50) break;
  }
  if (!items.length) throw new Error('榜单没有可用条目');
  return { items, updatedAt };
}

export function parseTiebaOfficial(data, now) {
  const entries = data?.data?.bang_topic?.topic_list;
  if (Number(data?.errno) !== 0 || !Array.isArray(entries)) throw new Error('贴吧原站榜单暂不可用');
  const source = SOCIAL_SOURCES.tieba, seen = new Set(), ranks = new Set(), items = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || entry.is_ad || !/^\d{1,20}$/.test(String(entry.topic_id || ''))) continue;
    const title = textOnly(entry.topic_name, 180);
    if (!title) continue;
    let url = approvedTopicUrl(entry.topic_url, 'tieba');
    if (!url || new URL(url).searchParams.get('topic_id') !== String(entry.topic_id)) {
      url = 'https://tieba.baidu.com/hottopic/browse/hottopic?topic_id=' + entry.topic_id + '&topic_name=' + encodeURIComponent(title);
    }
    const rank = Number.isInteger(entry.idx_num) && entry.idx_num >= 1 ? entry.idx_num : index + 1;
    if (seen.has(url) || ranks.has(rank)) continue;
    const description = textOnly(entry.topic_desc || entry.abstract, 180);
    const image = approvedCover(entry.topic_pic, 'tieba');
    const heat = Number.isFinite(entry.discuss_num) && entry.discuss_num >= 0 ? entry.discuss_num.toLocaleString('zh-CN') + ' 讨论' : undefined;
    items.push(topic(source, title, url, now, { rank, ...(description ? { description } : {}), ...(image ? { image } : {}), ...(heat ? { heat } : {}) }));
    seen.add(url); ranks.add(rank);
    if (items.length >= 50) break;
  }
  if (!items.length) throw new Error('贴吧原站没有可用条目');
  return items;
}

export function parseTwitterTrends(data, now) {
  if (data?.status && data.status !== 'completed') throw new Error('X 趋势服务未返回成功结果');
  const payload = Array.isArray(data?.outputs) ? data.outputs[0]?.data : data;
  if (!Array.isArray(payload?.trends)) throw new Error('X 趋势响应结构暂不兼容');
  const seen = new Set(), items = [];
  for (const entry of payload.trends) {
    const title = textOnly(entry?.name, 180);
    if (!title || seen.has(title.toLocaleLowerCase())) continue;
    const url = 'https://x.com/search?q=' + encodeURIComponent(title);
    const description = textOnly(entry.description || entry.context, 180);
    // The provider does not return official ranks, tweet counts or a board timestamp.
    items.push(topic({ id: 'twitter-trends' }, title, url, now, description ? { description } : {}));
    seen.add(title.toLocaleLowerCase());
    if (items.length >= 50) break;
  }
  if (!items.length) throw new Error('X 趋势没有可用条目');
  return items;
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(18000), headers: { 'User-Agent': 'InformationStudy/1.0 (personal news reader)', Accept: 'application/json' }, ...options });
  if (!response.ok) throw new Error('来源暂不可用');
  const size = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(size) && size > 3_000_000) throw new Error('来源响应超过大小限制');
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 3_000_000) throw new Error('来源响应超过大小限制');
  return JSON.parse(text);
}
function preserve(source, previous, now, message) {
  const old = previous.sources?.find(s => s.id === source.id);
  return preserveFailedSource({ ...source, attribution: old?.attribution || source.attribution, ...(Number.isFinite(timestamp(old?.upstreamUpdatedAt)) ? { upstreamUpdatedAt: old.upstreamUpdatedAt } : {}) }, previous, now, message);
}

async function collectUapi(platform, now, previous, fetchImpl) {
  const source = SOCIAL_SOURCES[platform];
  try {
    const { items, updatedAt } = parseUapiSocial(await fetchJson(fetchImpl, SOCIAL_ENDPOINTS[platform === 'tieba' ? 'tiebaFallback' : platform]), platform, now);
    return { source: { ...source, attribution: source.label + ' · UAPI 免费公开聚合，非平台官方接口', status: 'ok', lastSuccessAt: now, lastAttemptAt: now, upstreamUpdatedAt: updatedAt, message: '通过 UAPI 免费公开榜单更新；榜单时间 ' + displayTime(updatedAt) + '。' }, items };
  } catch (error) {
    return preserve(source, previous, now, (error?.message === '榜单更新已延迟' ? '来源榜单更新已延迟。' : '来源暂时无法更新。') + '保留最近成功内容与时间；可前往原站查看。');
  }
}
export async function collectTieba({ now, previous, fetchImpl = globalThis.fetch }) {
  try {
    const items = parseTiebaOfficial(await fetchJson(fetchImpl, SOCIAL_ENDPOINTS.tieba), now);
    return { source: { ...SOCIAL_SOURCES.tieba, status: 'ok', lastSuccessAt: now, lastAttemptAt: now, message: '贴吧原站当前热议话题；原站未提供榜单更新时间，本站单独显示获取时间。' }, items };
  } catch { return collectUapi('tieba', now, previous, fetchImpl); }
}

export async function collectTwitter({ now, previous, env = process.env, fetchImpl = globalThis.fetch, forceRefresh = false }) {
  const country = env.TWITTER_TRENDS_COUNTRY || 'UnitedStates';
  const region = countries[country];
  const source = { id: 'twitter-trends', label: 'X / Twitter · ' + (region || '地区待配置') + '趋势', category: 'trends', platform: 'twitter', homepage: 'https://x.com/explore/tabs/trending', region: country, attribution: 'X / Twitter 公开趋势 · SandBase 第三方服务，非 X 官方接口' };
  const oldSource = previous.sources?.find(s => s.id === source.id);
  const sameRegion = oldSource?.region === country;
  const eligiblePrevious = !oldSource || sameRegion ? previous : { ...previous, sources: previous.sources.filter(s => s.id !== source.id), items: (previous.items || []).filter(i => i.sourceId !== source.id) };
  if (!region) return preserve(source, eligiblePrevious, now, 'X 趋势地区配置无效；请使用已支持的国家名称。');
  if (!env.SANDBASE_API_KEY) {
    const oldItems = (eligiblePrevious.items || []).filter(i => i.sourceId === source.id);
    return { source: { ...source, status: oldItems.length ? 'cached' : 'external', lastSuccessAt: sameRegion ? oldSource?.lastSuccessAt || null : null, lastAttemptAt: now, message: 'X 趋势需要已接入的 SandBase 服务密钥；当前地区为' + region + '，不是全球榜。' }, items: oldItems };
  }
  const age = Date.parse(now) - Date.parse(oldSource?.lastAttemptAt || '');
  if (forceRefresh !== true && sameRegion && oldSource.status !== 'external' && age >= 0 && age < 60 * 60_000) {
    return { source: { ...oldSource, ...source }, items: (previous.items || []).filter(i => i.sourceId === source.id) };
  }
  try {
    const data = await fetchJson(fetchImpl, SOCIAL_ENDPOINTS.twitter, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SANDBASE_API_KEY }, body: JSON.stringify({ country }) });
    const items = parseTwitterTrends(data, now);
    return { source: { ...source, status: 'ok', lastSuccessAt: now, lastAttemptAt: now, message: region + '地区趋势，按服务返回顺序展示；来源不提供官方位次、推文量或榜单更新时间，不代表全球榜。每小时最多请求一次。' }, items };
  } catch {
    return preserve(source, eligiblePrevious, now, 'X 趋势服务暂时无法更新（地区：' + region + '）。保留最近成功内容与时间；可前往原站查看。');
  }
}
export async function collectSocialTrends({ now, previous, env = process.env, fetchImpl = globalThis.fetch }) {
  return Promise.all([collectTieba({ now, previous, fetchImpl }), collectUapi('zhihu', now, previous, fetchImpl), collectTwitter({ now, previous, env, fetchImpl, forceRefresh: env.FORCE_TWITTER_REFRESH === 'true' })]);
}

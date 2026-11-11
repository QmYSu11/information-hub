import { safeUrl, stableId, textOnly, preserveFailedSource } from './data-utils.mjs';

export const XIAOHONGSHU_SOURCE = Object.freeze({
  id: 'xiaohongshu-recommendations',
  label: '小红书 · 推荐',
  category: 'recommendations',
  platform: 'xiaohongshu',
  homepage: 'https://www.xiaohongshu.com/explore',
  attribution: '小红书公开笔记元数据 · 第三方推荐接口；完整内容与互动请访问原站',
});
export const XIAOHONGSHU_PROVIDERS = Object.freeze({
  sandbase: {
    keyName: 'SANDBASE_API_KEY',
    name: 'SandBase',
    url: 'https://api.sandbase.ai/v1/api/xiaohongshu/web-v3/homefeed',
    method: 'POST',
    docs: 'https://www.sandbase.ai/apis/xiaohongshu/web-v3/homefeed',
  },
  tikhub: {
    keyName: 'TIKHUB_API_KEY',
    name: 'TikHub',
    url: 'https://api.tikhub.io/api/v1/xiaohongshu/web_v3/fetch_homefeed',
    method: 'GET',
    docs: 'https://docs.tikhub.io/438852175e0',
  },
});

const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const noteIdPattern = /^[0-9a-f]{24}$/i;
const postHost = host => ['www.xiaohongshu.com', 'xiaohongshu.com', 'www.rednote.com', 'rednote.com'].includes(host.toLowerCase());
const coverHost = host => ['xhscdn.com', 'rednotecdn.com', 'xiaohongshu.com'].some(base => host === base || host.endsWith('.' + base));

function publicPostUrl(candidate, noteId) {
  const value = safeUrl(candidate);
  if (value) {
    const url = new URL(value);
    if (postHost(url.hostname) && /^\/(?:explore|discovery\/item)\/[a-f0-9]{24}\/?$/i.test(url.pathname)) {
      // Keep only public link parameters already supplied by the provider.
      // Do not collect user/session tokens or synthesize platform signatures.
      for (const key of [...url.searchParams.keys()]) {
        if (!['xsec_token', 'xsec_source'].includes(key)) url.searchParams.delete(key);
      }
      url.hash = '';
      return url.href;
    }
  }
  return noteIdPattern.test(noteId || '') ? 'https://www.xiaohongshu.com/explore/' + noteId.toLowerCase() : undefined;
}
function coverUrl(card) {
  const cover = record(card.cover) ? card.cover : {};
  const image = Array.isArray(card.image_list) ? card.image_list[0] : Array.isArray(card.images) ? card.images[0] : undefined;
  const choices = [
    cover.url_default, cover.url_pre, cover.url,
    ...(Array.isArray(cover.info_list) ? cover.info_list.map(info => info?.url) : []),
    typeof image === 'string' ? image : image?.url_default || image?.url,
  ];
  for (const candidate of choices) {
    const url = safeUrl(candidate);
    if (url && coverHost(new URL(url).hostname)) return url;
  }
  return undefined;
}
function publishedTime(value, now) {
  let ms;
  if (typeof value === 'number' && Number.isFinite(value)) {
    ms = value >= 1_000_000_000_000 ? value : value >= 1_000_000_000 ? value * 1000 : NaN;
  } else if (typeof value === 'string' && /^\d{10}(?:\d{3})?$/.test(value)) {
    ms = value.length === 13 ? Number(value) : Number(value) * 1000;
  } else if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    ms = Date.parse(value);
  }
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.parse(now) + 86_400_000) return undefined;
  return new Date(ms).toISOString();
}
function likesText(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value.toLocaleString('zh-CN') + ' 赞' : undefined;
  const raw = textOnly(value, 24);
  return raw && /^[\d.,万千亿kKmMwW+\s]+$/.test(raw) ? raw + ' 赞' : undefined;
}

/** Read only documented response envelopes, never execute the upstream response. */
function findFeedEntries(response, depth = 0) {
  if (depth > 6) return undefined;
  if (Array.isArray(response)) return response;
  if (!record(response)) return undefined;
  if (response.success === false || response.ok === false) throw new Error('推荐服务没有返回成功结果');
  if (response.code !== undefined && ![0, 200, '0', '200'].includes(response.code)) throw new Error('推荐服务返回了错误状态');
  for (const name of ['items', 'notes', 'feeds', 'note_list', 'noteList', 'list']) {
    if (Array.isArray(response[name])) return response[name];
  }
  for (const name of ['data', 'result', 'response', 'payload']) {
    const value = findFeedEntries(response[name], depth + 1);
    if (value) return value;
  }
  return undefined;
}

export function parseXiaohongshuRecommendations(response, now) {
  const entries = findFeedEntries(response);
  if (!entries) throw new Error('推荐响应结构暂不兼容');
  const seen = new Set();
  const items = [];
  for (const entry of entries) {
    if (!record(entry)) continue;
    // Feed may contain search prompts, channel cards or advertisements rather than notes.
    if (entry.model_type && entry.model_type !== 'note') continue;
    const card = record(entry.note_card) ? entry.note_card : record(entry.noteCard) ? entry.noteCard : entry;
    if (card.type && !['normal', 'image', 'video', 'note'].includes(card.type)) continue;
    const candidateUrl = card.note_url || card.noteUrl || card.share_url || entry.note_url || entry.share_url || entry.url;
    const id = String(entry.note_id || entry.noteId || card.note_id || card.noteId || entry.id || card.id || '');
    const url = publicPostUrl(candidateUrl, id);
    if (!url) continue;
    const urlNoteId = new URL(url).pathname.split('/').filter(Boolean).at(-1)?.toLowerCase();
    if (!urlNoteId || seen.has(urlNoteId)) continue;
    const title = textOnly(card.display_title || card.title || entry.title || card.desc || card.description, 180);
    if (!title) continue;
    const user = record(card.user) ? card.user : record(entry.user) ? entry.user : {};
    const author = textOnly(user.nickname || user.nick_name || user.name || card.author || entry.author, 80);
    const image = coverUrl(card);
    const description = textOnly(card.desc || card.description || entry.description, 180);
    const interact = card.interact_info || card.interactInfo || entry.interact_info || {};
    const heat = likesText(interact.liked_count ?? interact.likedCount ?? card.liked_count ?? entry.liked_count);
    const publishedAt = publishedTime(card.publish_time ?? card.publishTime ?? card.time ?? entry.publish_time ?? entry.published_at, now);
    const mediaType = card.type === 'video' ? 'video' : ['normal', 'image'].includes(card.type) || image ? 'image' : undefined;
    items.push({
      id: stableId(XIAOHONGSHU_SOURCE.id, 'https://www.xiaohongshu.com/explore/' + urlNoteId),
      sourceId: XIAOHONGSHU_SOURCE.id,
      title, url, channel: '趣事', kind: 'post', fetchedAt: now, bodyAllowed: false,
      ...(description && description !== title ? { description } : {}),
      ...(author ? { author } : {}), ...(image ? { image } : {}),
      ...(heat ? { heat } : {}), ...(publishedAt ? { publishedAt } : {}),
      ...(mediaType ? { mediaType } : {}),
    });
    seen.add(urlNoteId);
    if (items.length >= 20) break;
  }
  if (!items.length) throw new Error('推荐服务没有返回可展示的真实笔记');
  return items;
}

async function readResponse(response) {
  if (!response.ok) {
    const messages = {
      401: '推荐服务密钥未生效，请检查配置',
      402: '推荐服务免费额度或账户预算已用尽',
      403: '推荐服务暂未允许本次访问',
      429: '推荐服务请求过于频繁，稍后自动重试',
    };
    throw new Error(messages[response.status] || '推荐服务暂时无法连接（HTTP ' + response.status + '）');
  }
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > 2_000_000) throw new Error('推荐响应超过大小限制');
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 2_000_000) throw new Error('推荐响应超过大小限制');
  try { return JSON.parse(text); }
  catch { throw new Error('推荐服务没有返回可读取的数据'); }
}

export async function collectXiaohongshu({ now, previous, env = process.env, fetchImpl = globalThis.fetch }) {
  const providerId = env.SANDBASE_API_KEY ? 'sandbase' : env.TIKHUB_API_KEY ? 'tikhub' : undefined;
  const oldSource = previous.sources?.find(source => source.id === XIAOHONGSHU_SOURCE.id);
  if (!providerId) {
    const oldItems = (previous.items || []).filter(item => item.sourceId === XIAOHONGSHU_SOURCE.id);
    return {
      source: {
        ...XIAOHONGSHU_SOURCE, status: oldItems.length ? 'cached' : 'external',
        lastSuccessAt: oldSource?.lastSuccessAt || null, lastAttemptAt: now,
        message: oldItems.length ? '推荐连接尚未配置，当前显示上次获取的帖子' : '推荐接口已准备，需要连接数据服务后显示真实帖子',
      },
      items: oldItems,
    };
  }
  const provider = XIAOHONGSHU_PROVIDERS[providerId];
  const source = { ...XIAOHONGSHU_SOURCE, attribution: XIAOHONGSHU_SOURCE.attribution + ' · ' + provider.name };
  const attemptAge = Date.parse(now) - Date.parse(oldSource?.lastAttemptAt || oldSource?.lastSuccessAt || '');
  const oldItems = (previous.items || []).filter(item => item.sourceId === source.id);
  // One 20-note page per hour, at most 24 scheduled calls/day. No hidden retries/pagination.
  if (oldSource && oldSource.status !== 'external' && oldSource.attribution === source.attribution && attemptAge >= 0 && attemptAge < 60 * 60_000) {
    return { source: { ...source, status: oldSource.status, lastSuccessAt: oldSource.lastSuccessAt || null, lastAttemptAt: oldSource.lastAttemptAt || oldSource.lastSuccessAt, message: oldSource.status === 'ok' ? '每小时更新的推荐快照，不是个人账号的推荐流' : oldSource.message || '推荐服务等待下次更新，保留最近可用内容' }, items: oldItems };
  }
  try {
    const parameters = { num: 20, category: 'homefeed_recommend', need_filter_image: false };
    const url = new URL(provider.url);
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + env[provider.keyName], 'User-Agent': 'InformationStudy/1.0 (personal reader)' };
    const init = { method: provider.method, headers, signal: AbortSignal.timeout(18000) };
    if (provider.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(parameters);
    } else {
      Object.entries(parameters).forEach(([name, value]) => url.searchParams.set(name, String(value)));
    }
    const response = await fetchImpl(url.href, init);
    const items = parseXiaohongshuRecommendations(await readResponse(response), now);
    return { source: { ...source, status: 'ok', lastSuccessAt: now, lastAttemptAt: now, message: '每小时更新的推荐快照，不是个人账号的推荐流' }, items };
  } catch (error) {
    // Never put raw provider response, request headers or credentials into the public snapshot.
    const known = [
      '推荐服务密钥未生效，请检查配置', '推荐服务免费额度或账户预算已用尽',
      '推荐服务暂未允许本次访问', '推荐服务请求过于频繁，稍后自动重试',
      '推荐响应超过大小限制', '推荐服务没有返回可读取的数据',
      '推荐响应结构暂不兼容', '推荐服务返回了错误状态', '推荐服务没有返回成功结果',
      '推荐服务没有返回可展示的真实笔记',
    ];
    const message = known.includes(error?.message) || /^推荐服务暂时无法连接（HTTP \d+）$/.test(error?.message || '')
      ? error.message : error?.name === 'TimeoutError' ? '推荐服务连接超时，保留最近可用内容' : '推荐服务暂时无法连接，保留最近可用内容';
    return preserveFailedSource(source, previous, now, message);
  }
}

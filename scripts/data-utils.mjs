import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

export function safeUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const u = new URL(value.trim(), base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return undefined;
    if (u.protocol === 'http:') u.protocol = 'https:';
    return u.href;
  } catch { return undefined; }
}

export function normalizeUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return undefined;
  const u = new URL(safe);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_.+|spm_id_from|spm|from|source|ref|share_source|share_medium)$/i.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  return u.href;
}

export function textOnly(value, max = 240) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_, hex, dec) => {
      const code = Number.parseInt(hex || dec, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()])
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function stableId(sourceId, url) {
  return sourceId + '-' + createHash('sha256').update(normalizeUrl(url) || url).digest('hex').slice(0, 16);
}

export function validISO(value) {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export function parseRSS(raw, source, now) {
  const parsed = xml.parse(raw);
  const channel = parsed?.rss?.channel;
  const feed = parsed?.feed;
  if (!channel && !feed) throw new Error('响应不是有效 RSS/Atom');
  const rawItems = channel?.item ?? feed?.entry ?? [];
  const list = Array.isArray(rawItems) ? rawItems : [rawItems];
  const result = [];
  const seen = new Set();
  for (const item of list) {
    const links = Array.isArray(item.link) ? item.link : [item.link];
    const link = links.find(x => typeof x === 'string' || !x?.['@_rel'] || x['@_rel'] === 'alternate');
    const url = normalizeUrl(typeof link === 'string' ? link : link?.['@_href'] || link?.['#text']);
    const title = textOnly(typeof item.title === 'object' ? item.title?.['#text'] : item.title, 180);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const desc = typeof item.description === 'string' ? item.description : typeof item.summary === 'string' ? item.summary : item.summary?.['#text'];
    const description = textOnly(desc, 180);
    const media = item['media:thumbnail'] || item['media:content'];
    const thumb = Array.isArray(media) ? media[0] : media;
    const image = safeUrl(thumb?.['@_url'] || (item.enclosure?.['@_type']?.startsWith('image/') ? item.enclosure['@_url'] : undefined));
    result.push({
      id: stableId(source.id, url), sourceId: source.id,
      title, url, channel: source.channel, kind: 'article',
      ...(description ? { description } : {}), ...(image ? { image } : {}),
      ...(validISO(item.pubDate || item.published || item.updated || item['dc:date']) ? { publishedAt: validISO(item.pubDate || item.published || item.updated || item['dc:date']) } : {}),
      fetchedAt: now, bodyAllowed: false,
    });
    if (result.length >= 28) break;
  }
  if (!result.length) throw new Error('订阅没有可用条目');
  return result;
}

export function parseBilibili(data, sourceId, now) {
  if (data.code !== 0 || !Array.isArray(data.data?.list)) throw new Error('B 站排行榜暂不可用');
  const seen = new Set();
  return data.data.list.slice(0, 40).flatMap((entry, index) => {
    if (!/^BV[A-Za-z0-9]{10}$/.test(entry.bvid) || seen.has(entry.bvid)) return [];
    seen.add(entry.bvid);
    const url = 'https://www.bilibili.com/video/' + entry.bvid;
    return [{
      id: stableId(sourceId, url), sourceId, title: textOnly(entry.title, 180),
      url, channel: '趣事', kind: 'video', bvid: entry.bvid,
      image: safeUrl(entry.pic), author: textOnly(entry.owner?.name, 60),
      description: textOnly(entry.desc, 180),
      rank: index + 1,
      ...(Number.isFinite(entry.stat?.view) ? { heat: formatCount(entry.stat.view) + ' 播放' } : {}),
      ...(Number.isFinite(entry.pubdate) ? { publishedAt: validISO(entry.pubdate * 1000) } : {}),
      fetchedAt: now,
    }];
  });
}

export function parseWeibo(data, sourceId, now) {
  if (!Array.isArray(data.data?.realtime)) throw new Error('微博热搜需要可用访问权限');
  return data.data.realtime.slice(0, 40).flatMap((entry, index) => {
    const title = textOnly(entry.word, 180);
    if (!title) return [];
    const url = 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + title + '#') + '&t=31';
    return [{
      id: stableId(sourceId, url), sourceId, title, url,
      channel: '趣事', kind: 'topic', rank: index + 1,
      ...(Number.isFinite(entry.num) ? { heat: formatCount(entry.num) + ' 热度' } : {}),
      fetchedAt: now,
    }];
  });
}

export function formatCount(count) {
  return count >= 10000 ? (count / 10000).toFixed(count >= 1000000 ? 0 : 1) + '万' : String(count);
}

export function preserveFailedSource(source, oldSnapshot, now, message) {
  const oldSource = oldSnapshot.sources?.find(s => s.id === source.id);
  const oldItems = (oldSnapshot.items || []).filter(item => item.sourceId === source.id);
  return {
    source: {
      ...source, status: oldItems.length ? 'cached' : 'unavailable',
      lastSuccessAt: oldSource?.lastSuccessAt || null,
      lastAttemptAt: now, message,
    },
    items: oldItems,
  };
}

export function assertPublicSnapshot(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.items) || !Array.isArray(value.quotes)) throw new Error('快照结构无效');
  const allowed = new Set(['schemaVersion', 'generationId', 'generatedAt', 'sources', 'items', 'quotes']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('公开快照含有未允许字段');
  const ids = new Set();
  for (const item of value.items) {
    if (!safeUrl(item.url) || !item.id || ids.has(item.id) || !item.title || !value.sources.some(s => s.id === item.sourceId)) throw new Error('内容条目无效或重复');
    if (item.body || item.bodyAllowed) throw new Error('默认采集不允许发布正文');
    ids.add(item.id);
  }
  return value;
}

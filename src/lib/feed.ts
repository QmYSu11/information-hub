import type { ContentItem, Quote, Snapshot, Source } from '../types';

export function safeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}
export function plain(value: string = ''): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('数据格式暂时无法读取');
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || typeof v.generationId !== 'string' || !Array.isArray(v.items) || !Array.isArray(v.sources) || !Array.isArray(v.quotes))
    throw new Error('数据版本不兼容，请稍后再试');
  const sources = v.sources.filter((x): x is Source => !!x && typeof x.id === 'string' && typeof x.label === 'string' && !!safeUrl(x.homepage));
  const ids = new Set(sources.map(s => s.id));
  const seen = new Set<string>();
  const items = v.items.filter((x): x is ContentItem => {
    if (!x || typeof x.id !== 'string' || seen.has(x.id) || typeof x.title !== 'string' || !x.title.trim() || !safeUrl(x.url) || !ids.has(x.sourceId)) return false;
    seen.add(x.id); return true;
  }).map(x => ({ ...x, title: plain(x.title), description: plain(x.description), image: safeUrl(x.image) || undefined }));
  const quotes = v.quotes.filter((x): x is Quote => !!x && typeof x.id === 'string' && typeof x.name === 'string' && !!safeUrl(x.url) && (x.value === null || (typeof x.value === 'number' && Number.isFinite(x.value))));
  return { schemaVersion: 1, generationId: v.generationId, generatedAt: typeof v.generatedAt === 'string' ? v.generatedAt : '', sources, items, quotes };
}
export function relativeTime(date: string | undefined, now = Date.now()): string {
  if (!date || !Number.isFinite(Date.parse(date))) return '时间未提供';
  const elapsed = Math.max(0, now - Date.parse(date));
  if (elapsed < 60000) return '刚刚';
  if (elapsed < 3600000) return Math.floor(elapsed / 60000) + ' 分钟前';
  if (elapsed < 86400000) return Math.floor(elapsed / 3600000) + ' 小时前';
  if (elapsed < 86400000 * 7) return Math.floor(elapsed / 86400000) + ' 天前';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' }).format(new Date(date));
}
export function fullTime(date: string | undefined | null): string {
  if (!date || !Number.isFinite(Date.parse(date))) return '尚未成功获取';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date)) + ' 北京时间';
}
export function sourceState(source: Source, now = Date.now()): { label: string; tone: string } {
  if (source.status === 'external') return { label: '原站查看', tone: 'neutral' };
  if (!source.lastSuccessAt) return { label: '暂未接通', tone: 'warning' };
  const age = now - Date.parse(source.lastSuccessAt);
  if (!Number.isFinite(age)) return { label: '时间未知', tone: 'warning' };
  if (age > 86400000) return { label: '历史缓存', tone: 'warning' };
  if (age > 7200000 || source.status !== 'ok') return { label: '更新延迟', tone: 'warning' };
  return { label: '已更新', tone: 'success' };
}
export function canonicalUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|spm|from$)/i.test(key)) url.searchParams.delete(key);
  url.hash = ''; return url.href;
}

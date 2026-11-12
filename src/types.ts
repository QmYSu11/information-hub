export type Channel = '国内' | '国际' | '科技' | '趣事' | '财经';
export type Platform = 'bilibili' | 'weibo' | 'xiaohongshu' | 'twitter' | 'tieba' | 'zhihu';
export interface ContentItem {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  channel: Channel;
  kind: 'article' | 'video' | 'topic' | 'post';
  mediaType?: 'image' | 'video';
  description?: string;
  image?: string;
  publishedAt?: string;
  fetchedAt: string;
  author?: string;
  rank?: number;
  heat?: string;
  bvid?: string;
  body?: string;
  bodyAllowed?: boolean;
}
export interface Source {
  id: string;
  label: string;
  category: 'news' | 'trends' | 'markets' | 'recommendations';
  channel?: Channel;
  platform?: Platform;
  homepage: string;
  status: 'ok' | 'cached' | 'unavailable' | 'external';
  lastSuccessAt: string | null;
  lastAttemptAt?: string;
  upstreamUpdatedAt?: string;
  region?: string;
  message?: string;
  attribution?: string;
}
export interface Quote {
  id: string;
  name: string;
  symbol: string;
  market: 'A股' | '美股' | '大宗商品';
  value: number | null;
  changePercent?: number;
  currency: string;
  unit?: string;
  asOf?: string;
  fetchedAt: string;
  source: string;
  url: string;
  delayLabel: string;
  history?: number[];
}
export interface Snapshot {
  schemaVersion: 1;
  generationId: string;
  generatedAt: string;
  sources: Source[];
  items: ContentItem[];
  quotes: Quote[];
}

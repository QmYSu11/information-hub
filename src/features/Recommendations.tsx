import { useMemo, useState } from 'react';
import { ArrowUpRight, Bookmark, Heart, Image, Search, Sparkles } from 'lucide-react';
import type { ContentItem, Source } from '../types';
import { fullTime, safeUrl, sourceState } from '../lib/feed';
import './recommendations.css';

type Props = {
  sources: Source[];
  items: ContentItem[];
  onOpen: (item: ContentItem) => void;
  onSave: (item: ContentItem) => void;
  isSaved: (id: string) => boolean;
};
export default function Recommendations({ sources, items, onOpen, onSave, isSaved }: Props) {
  const source = sources.find(s => s.platform === 'xiaohongshu' && s.category === 'recommendations') || sources.find(s => s.platform === 'xiaohongshu');
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(24);
  const [onlyVideo, setOnlyVideo] = useState(false);
  const matching = useMemo(() => items.filter(item =>
    (!query.trim() || (item.title + ' ' + (item.description || '') + ' ' + (item.author || '')).toLowerCase().includes(query.toLowerCase().trim())) &&
    (!onlyVideo || item.kind === 'video' || item.mediaType === 'video')), [items, query, onlyVideo]);
  const state = source?.status === 'external' && !source.lastSuccessAt ? { label: '待连接推荐流', tone: 'warning' } : source ? sourceState(source) : { label: '待连接推荐流', tone: 'warning' };
  return <section className="recommendation-panel">
    <header className="recommendation-heading"><div><div className="recommendation-kicker"><Sparkles size={14} /> RED NOTE · DISCOVER</div><h2>推荐给此刻的你</h2><p>好看的日常、有趣的想法，留一点时间去发现。</p></div><span className={'status-pill ' + state.tone}>{state.label}</span></header>
    {items.length > 0 && source?.status !== 'ok' && source?.message && <p className="recommendation-source-message" role="status">{source.message} 当前展示最近一次成功获取的帖子。</p>}
    <div className="recommendation-toolbar"><div className="recommendation-filters"><button className={!onlyVideo ? 'selected' : ''} onClick={() => setOnlyVideo(false)}>全部帖子</button><button className={onlyVideo ? 'selected' : ''} onClick={() => setOnlyVideo(true)}>视频帖子</button></div><label className="recommendation-search"><Search size={14} /><input aria-label="搜索推荐帖子" value={query} onChange={e => { setQuery(e.target.value); setCount(24); }} placeholder="搜索帖子、作者" /></label></div>
    {matching.length > 0 ? <div className="recommendation-masonry">{matching.slice(0, count).map((item, index) => <article className="recommendation-card" key={item.id}>
      <button className="recommendation-cover" onClick={() => onOpen(item)} aria-label={'打开帖子：' + item.title}>{item.image ? <img src={safeUrl(item.image)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <span className="recommendation-cover-empty"><Image size={26} /><span>查看原帖</span></span>}<span className="recommendation-open"><ArrowUpRight size={16} /></span>{(item.kind === 'video' || item.mediaType === 'video') && <span className="recommendation-type">视频</span>}</button>
      <div className="recommendation-copy"><button className="recommendation-title" onClick={() => onOpen(item)}><h3>{item.title}</h3></button>{item.description && <p>{item.description}</p>}<div className="recommendation-meta"><span className={'recommendation-avatar avatar-' + index % 4}>{(item.author || '红').slice(0, 1)}</span><span className="recommendation-author">{item.author || source?.label || '小红书'}</span>{item.heat && <span className="recommendation-heat"><Heart size={12} />{item.heat}</span>}<button className={'icon-button ' + (isSaved(item.id) ? 'active' : '')} aria-label={isSaved(item.id) ? '取消收藏帖子' : '收藏帖子'} aria-pressed={isSaved(item.id)} onClick={() => onSave(item)}><Bookmark size={15} /></button></div></div>
    </article>)}</div> : <div className="recommendation-empty"><span><Sparkles size={28} /></span><h3>{query || onlyVideo ? '还没有匹配的帖子' : '推荐流还在等待连接'}</h3><p>{query || onlyVideo ? '试试其他关键词，或返回全部帖子。' : (source?.message || '正在寻找可用于本站的推荐帖子数据源。连接成功后，这里会展示真实封面、作者和帖子内容。')}</p><a className="button" href={safeUrl(source?.homepage) || 'https://www.xiaohongshu.com/explore'} target="_blank" rel="noopener noreferrer">在小红书继续发现 <ArrowUpRight size={15} /></a>{items.length === 0 && <><small>需要先配置推荐数据服务，才能开始获取帖子。</small><a className="text-button" href="https://github.com/QmYSu11/information-hub/blob/main/docs/xiaohongshu.md" target="_blank" rel="noopener noreferrer">查看免费接入步骤 <ArrowUpRight size={13} /></a></>}</div>}
    {matching.length > count && <button className="button load-more" onClick={() => setCount(n => n + 24)}>继续发现</button>}
    <footer className="recommendation-foot"><span>{source?.lastSuccessAt ? '最近获取：' + fullTime(source.lastSuccessAt) : '推荐数据尚无成功获取记录'}</span><span>公开发现流 · 不是登录账号的个性化推荐 · 原帖内容以小红书为准</span></footer>
  </section>;
}

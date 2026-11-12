import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BookMarked, Bookmark, BookOpen, Check, ChevronDown, Clock3, ExternalLink, Flame, Gamepad2, Globe2, LayoutGrid, ListFilter, LoaderCircle, Maximize2, Menu, Moon, Newspaper, Orbit, PanelLeftClose, Play, Plus, RefreshCw, Search, Settings2, Sparkles, Sun, TrendingUp, Users, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { Channel, ContentItem, Platform, Snapshot, Source } from './types';
import { fullTime, parseSnapshot, plain, relativeTime, safeUrl, sourceState } from './lib/feed';
import { personal, usePersonal } from './lib/personal-store';
import { migrateWatchlist, resolveInstrument } from './lib/market-model';
import Personal, { ReminderNotifier } from './features/Personal';
import FeatureBoundary from './components/FeatureBoundary';
const Game = lazy(() => import('./features/Game'));
const Recommendations = lazy(() => import('./features/Recommendations'));
const MarketWidget = lazy(() => import('./features/MarketWidget'));
const HotwordRadar = lazy(() => import('./features/HotwordRadar'));
const AiOffice = lazy(() => import('./features/AiOffice'));

type Page = 'today' | 'news' | 'trends' | 'radar' | 'markets' | 'office' | 'library' | 'notes' | 'reminders' | 'settings' | 'game';
const pageNames: Record<Page, string> = { today: '今日', news: '新闻', trends: '热榜', radar: '热点星图', markets: '财经', office: 'AI 办公室', library: '收藏与稍后读', notes: '笔记', reminders: '提醒', settings: '偏好设置', game: '信号远征' };
const nav = [{ id: 'today', icon: LayoutGrid, name: '今日' }, { id: 'news', icon: Newspaper, name: '新闻' }, { id: 'trends', icon: Flame, name: '热榜' }, { id: 'radar', icon: Orbit, name: '热点星图' }, { id: 'markets', icon: TrendingUp, name: '财经' }, { id: 'office', icon: Users, name: 'AI 办公室' }, { id: 'notes', icon: BookOpen, name: '笔记' }, { id: 'game', icon: Gamepad2, name: '休息室' }] as const;
const mobilePages: Page[] = ['today', 'trends', 'markets', 'notes'];
const platforms: { id: Platform; name: string; short: string; url: string; subtitle: string }[] = [
  { id: 'bilibili', name: '哔哩哔哩', short: 'B', url: 'https://www.bilibili.com/v/popular/rank/all', subtitle: '热门视频与创作' },
  { id: 'weibo', name: '微博', short: '微', url: 'https://s.weibo.com/top/summary', subtitle: '此刻正在讨论' },
  { id: 'xiaohongshu', name: '小红书', short: '红', url: 'https://www.xiaohongshu.com/explore', subtitle: '推荐帖子 · 发现生活' },
  { id: 'twitter', name: 'X / Twitter', short: '𝕏', url: 'https://x.com/explore/tabs/trending', subtitle: '美国地区趋势' },
  { id: 'tieba', name: '百度贴吧', short: '贴', url: 'https://tieba.baidu.com/', subtitle: '社区热议与脑洞' },
  { id: 'zhihu', name: '知乎', short: '知', url: 'https://www.zhihu.com/hot', subtitle: '问题背后的另一面' },
];
type BrowseInterest = 'mix' | 'video' | 'daily' | 'tech';
const browseInterests: { id: BrowseInterest; label: string }[] = [{ id: 'mix', label: '随便逛逛' }, { id: 'video', label: '想看视频' }, { id: 'daily', label: '日常灵感' }, { id: 'tech', label: '数码与游戏' }];
function browseCollection(items: ContentItem[], interest: BrowseInterest) {
  const buckets = new Map<string, ContentItem[]>();
  for (const item of items) {
    const video = item.kind === 'video' || item.mediaType === 'video';
    const community = item.kind === 'video' || item.kind === 'post' || item.kind === 'topic';
    if (interest === 'mix' && !community) continue;
    if (interest === 'video' && !video) continue;
    if (interest === 'daily' && item.kind !== 'post' && !/日常|生活|美食|做饭|旅行|旅游|咖啡|猫|狗|宠物|穿搭|装修|摄影|手工|搞笑|整活|开箱/.test(item.title)) continue;
    if (interest === 'tech' && item.channel !== '科技' && !/游戏|动画|动漫|数码|手机|电脑|显卡|芯片|机器人|人工智能|\bAI\b|主机|编程|英雄联盟|星穹铁道|明日方舟|原神/i.test(item.title)) continue;
    if (!buckets.has(item.sourceId)) buckets.set(item.sourceId, []);
    buckets.get(item.sourceId)!.push(item);
  }
  // Round-robin source variety; platform views and heat never become a shared score.
  const selected: ContentItem[] = [];
  while (selected.length < 40) {
    let found = false;
    for (const bucket of buckets.values()) {
      const item = bucket.shift();
      if (item) { selected.push(item); found = true; if (selected.length === 40) break; }
    }
    if (!found) break;
  }
  return selected;
}
const channels: ('全部' | Channel)[] = ['全部', '国内', '国际', '科技', '财经', '趣事'];
function getPage(): Page {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return id in pageNames ? id as Page : 'today';
}
const emptySnapshot: Snapshot = { schemaVersion: 1, generationId: '', generatedAt: '', items: [], sources: [], quotes: [] };
function loadCache(): Snapshot {
  try { return parseSnapshot(JSON.parse(localStorage.getItem('study.public.snapshot') || 'null')); } catch { return emptySnapshot; }
}
function useFeed() {
  const [snapshot, setSnapshot] = useState<Snapshot>(loadCache);
  const [pending, setPending] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(snapshot);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const apply = useCallback((data: Snapshot) => {
    current.current = data; setSnapshot(data); setPending(null);
    try { localStorage.setItem('study.public.snapshot', JSON.stringify(data)); } catch { /* Public cache is optional. */ }
  }, []);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true); setError('');
    const ac = new AbortController(); controller.current = ac;
    const timeout = setTimeout(() => ac.abort(), 15000);
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'data/snapshot.json?t=' + Date.now(), { cache: 'no-store', signal: ac.signal });
      if (!response.ok) throw new Error('内容暂时未能更新');
      const data = parseSnapshot(await response.json());
      if (!mounted.current) return;
      if (!current.current.generationId) apply(data);
      else if (data.generationId !== current.current.generationId) setPending(data);
    } catch (e) {
      if (mounted.current && !ac.signal.aborted) setError(e instanceof Error ? e.message : '网络暂时不可用');
      else if (mounted.current) setError('连接时间较长，已保留现有内容');
    } finally {
      clearTimeout(timeout); inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [apply]);
  useEffect(() => {
    mounted.current = true;
    const kickoff = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => { if (!document.hidden) void refresh(); }, 300000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; clearTimeout(kickoff); clearInterval(interval); document.removeEventListener('visibilitychange', visible); controller.current?.abort(); };
  }, [refresh]);
  return { snapshot, pending, loading, error, refresh, accept: () => { if (pending) apply(pending); } };
}

function IconButton({ label, children, onClick, active, className = '', disabled = false }: { label: string; children: ReactNode; onClick: () => void; active?: boolean; className?: string; disabled?: boolean }) {
  return <button type="button" className={'icon-button ' + (active ? 'active ' : '') + className} title={label} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Empty({ title, text, children, icon = <Newspaper /> }: { title: string; text: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{children}</div>;
}
function SourceBadge({ source }: { source?: Source }) {
  if (!source) return null;
  return <span className="source-badge"><span className={'source-letter source-' + (source.platform || source.channel || '')}>{source.label.slice(0, 1)}</span>{source.label}</span>;
}
function NewsRow({ item, source, onOpen, onSave, saved, read, compact = false }: { item: ContentItem; source?: Source; onOpen: () => void; onSave: () => void; saved: boolean; read: boolean; compact?: boolean }) {
  return <article className={'news-row ' + (read ? 'is-read ' : '') + (compact ? 'compact' : '')}>
    <div className="news-row-main">
      <div className="row-meta"><SourceBadge source={source} /><span>·</span><time title={fullTime(item.publishedAt)}>{relativeTime(item.publishedAt || item.fetchedAt)}</time>{source && sourceState(source).tone === 'warning' && <span className="cached-label">{sourceState(source).label}</span>}{item.kind === 'video' && <span className="video-mark"><Play size={12} /> 视频</span>}</div>
      <button className="news-title-button" onClick={onOpen}><h3>{item.title}</h3></button>
      {item.description && !compact && <p className="news-summary">{item.description}</p>}
      <div className="row-footer"><span className="channel-label">{item.channel}</span>{read && <span className="read-label"><Check size={12} /> 已读</span>}<div className="row-actions"><IconButton label={saved ? '取消收藏' : '收藏'} active={saved} onClick={onSave}><Bookmark /></IconButton><button className="text-button" onClick={onOpen}>阅读 <ArrowUpRight size={14} /></button></div></div>
    </div>
    {item.image && <button className="news-image-button" onClick={onOpen} aria-label={'阅读 ' + item.title}><img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /></button>}
  </article>;
}
function Featured({ item, source, onOpen }: { item: ContentItem; source?: Source; onOpen: () => void }) {
  return <article className={'featured-story ' + (item.image ? 'with-image' : 'text-feature')}>
    {item.image && <img className="feature-image" src={item.image} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />}
    <div className="feature-shade" /><div className="feature-copy">
      <span className="feature-kicker"><Globe2 size={13} /> 今日视野</span>
      <button onClick={onOpen} className="feature-title"><h2>{item.title}</h2></button>
      <p>{item.description || '从一篇报道开始，看见世界正在发生的变化。'}</p>
      <div className="feature-bottom"><SourceBadge source={source} /><span>{relativeTime(item.publishedAt || item.fetchedAt)}</span><button className="round-arrow" onClick={onOpen} aria-label="阅读这篇报道"><ArrowUpRight /></button></div>
    </div>
  </article>;
}
function TrendPreview({ source, items, onOpen, onMore }: { source?: Source; items: ContentItem[]; onOpen: (i: ContentItem) => void; onMore: () => void }) {
  const p = platforms.find(p => p.id === source?.platform) || platforms[0];
  return <section className="trend-preview"><div className="section-heading"><h2><Flame /> 此刻热议</h2><button className="text-button" onClick={onMore}>全部 <ArrowRight size={14} /></button></div>
    <div className="trend-source"><span className={'platform-logo ' + p.id}>{p.short}</span><strong>{p.name}</strong><span className="mini-label">{source ? sourceState(source).label : '原站查看'}</span></div>
    {items.length ? <ol className="mini-rankings">{items.slice(0, 5).map((i, index) => <li key={i.id}><span className={'rank-number rank-' + index}>{i.rank ?? '·'}</span><button onClick={() => onOpen(i)}>{i.title}</button></li>)}</ol> : <div className="quiet-empty">热榜正在等待可用数据。<a href={p.url} target="_blank" rel="noopener noreferrer">去原站看看 <ArrowUpRight size={13} /></a></div>}
    <div className="small-status">最近获取 · {source?.lastSuccessAt ? relativeTime(source.lastSuccessAt) : '尚未接通'}</div>
  </section>;
}

function Reader({ item, source, onClose, onSave, onLater, onNote, saved, later, fontSize, setFont, width }: { item: ContentItem; source?: Source; onClose: () => void; onSave: () => void; onLater: () => void; onNote: () => void; saved: boolean; later: boolean; fontSize: number; setFont: (n: number) => void; width: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playerHelp, setPlayerHelp] = useState(false);
  useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close(); }; }, []);
  const video = item.kind === 'video' && item.bvid && /^BV[0-9A-Za-z]{10}$/.test(item.bvid);
  const html = useMemo(() => item.bodyAllowed && item.body ? DOMPurify.sanitize(item.body, { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'style'], FORBID_ATTR: ['style'] }) : '', [item]);
  return <dialog ref={ref} className={'reader-dialog ' + (video ? 'cinema' : '')} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="reader-shell"><div className="reader-toolbar"><button className="text-button" onClick={onClose}><ArrowLeft /> 返回阅读</button><span>{video ? '影院模式' : '专注阅读'}</span><div className="reader-controls"><IconButton label={saved ? '取消收藏' : '收藏'} active={saved} onClick={onSave}><Bookmark /></IconButton><IconButton label="关闭" onClick={onClose}><X /></IconButton></div></div>
      <div className={'reader-content reader-width-' + width} style={{ fontSize: fontSize + 'px' }}><div className="reader-meta"><SourceBadge source={source} /><span>{item.channel}</span><span>{fullTime(item.publishedAt)}</span></div><h1>{item.title}</h1>
        {item.author && <p className="reader-author">{item.author}</p>}
        {video && <div className="video-stage">{playing ? <iframe title={item.title} src={'https://player.bilibili.com/player.html?bvid=' + item.bvid + '&autoplay=0&danmaku=0'} allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" onError={() => setPlayerHelp(true)} /> : <button className="video-cover" onClick={() => setPlaying(true)}>{item.image && <img src={item.image} alt="" referrerPolicy="no-referrer" />}<span className="play-circle"><Play fill="currentColor" /></span><strong>在这里观看</strong><small>使用哔哩哔哩官方播放器</small></button>}</div>}
        {video && <div className="video-help"><button className="text-button" onClick={() => setPlayerHelp(v => !v)}>无法播放？</button><button className="text-button" onClick={() => { void ref.current?.requestFullscreen?.().catch(() => setPlayerHelp(true)); }}><Maximize2 size={14} /> 全屏</button><a href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer">原站观看 <ArrowUpRight size={14} /></a></div>}
        {playerHelp && <p className="inline-notice">播放器可能需要加载，或受到来源、地区与登录限制。你可以直接在原站继续观看。</p>}
        {!video && item.image && <img className="reader-image" src={item.image} alt="" referrerPolicy="no-referrer" />}
        {html ? <div className="reader-body" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="reader-body"><p>{item.description || (item.kind === 'topic' || item.kind === 'post' ? '这个话题正在被关注。打开原站，可查看完整讨论和最新动态。' : '这条报道提供标题与来源链接，请在原站阅读完整内容。')}</p></div>}
        {!html && <div className="source-callout"><div><strong>{video || item.kind === 'post' ? '在原站继续探索' : '在来源处继续阅读'}</strong><p>{video || item.kind === 'post' ? '完整图文、视频和互动请在原帖查看。' : '这里展示来源提供的摘要，完整报道请以原文为准。'}</p></div><a className="button primary" href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer">{video ? '前往原站' : item.kind === 'post' ? '查看原帖' : '阅读原文'} <ArrowUpRight size={16} /></a></div>}
        <div className="reader-bottom"><span>获取于 {fullTime(item.fetchedAt)}</span><a href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer">{source?.label || '查看来源'} <ExternalLink size={12} /></a></div>
      </div>
      <div className="reader-dock"><div className="font-controls"><button aria-label="减小字号" onClick={() => setFont(Math.max(16, fontSize - 1))}>A−</button><span>{fontSize}</span><button aria-label="增大字号" onClick={() => setFont(Math.min(24, fontSize + 1))}>A+</button></div><button className={'button ' + (later ? 'selected' : '')} onClick={onLater}><Clock3 /> {later ? '已加入稍后读' : '稍后再读'}</button><button className="button primary" onClick={onNote}><BookMarked /> 记下想法</button></div>
    </div>
  </dialog>;
}

export default function App() {
  const feed = useFeed();
  const { data, status: storeStatus } = usePersonal();
  const [page, setPage] = useState<Page>(getPage);
  const [channel, setChannel] = useState<'全部' | Channel>('全部');
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<Platform>('bilibili');
  const [market, setMarket] = useState('全部市场');
  const [libraryTab, setLibraryTab] = useState<'favorite' | 'later'>('favorite');
  const [reader, setReader] = useState<ContentItem | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const [now, setNow] = useState(Date.now());
  const [sourceFilter, setSourceFilter] = useState('');
  const [browseInterest, setBrowseInterest] = useState<BrowseInterest>('daily');
  const [browseOffset, setBrowseOffset] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollPositions = useRef<Record<string, number>>({});
  const previousPage = useRef(page);
  const prefs = data.preferences;
  const notify = useCallback((message: string) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4000); }, []);
  const mutate = useCallback((fn: () => void) => { try { fn(); } catch (e) { notify(e instanceof Error ? e.message : '暂时无法保存，请先导出备份'); } }, [notify]);
  const go = useCallback((target: Page, suffix = '') => { scrollPositions.current[page] = window.scrollY; setMobileOpen(false); setQuery(''); location.hash = '/' + target + suffix; }, [page]);
  useEffect(() => { const update = () => { setPage(getPage()); setMobileOpen(false); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useLayoutEffect(() => { if (page !== previousPage.current) { window.scrollTo({ top: scrollPositions.current[page] || 0, behavior: 'instant' }); previousPage.current = page; } }, [page]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => { clearInterval(t); clearTimeout(toastTimer.current); }; }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = prefs.theme === 'system' ? (media.matches ? 'dark' : 'light') : prefs.theme; document.documentElement.dataset.motion = prefs.reducedMotion ? 'reduced' : 'normal'; document.documentElement.dataset.density = prefs.density; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [prefs.theme, prefs.reducedMotion, prefs.density]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); } if (e.key === 'Escape') { setQuery(''); setMobileOpen(false); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { document.title = pageNames[page] + ' · 信息书房'; }, [page]);
  useEffect(() => { setVisibleCount(20); }, [page, channel, query, platform, sourceFilter, libraryTab]);
  useEffect(() => { setBrowseOffset(0); }, [browseInterest, feed.snapshot.generationId]);
  const sources = feed.snapshot.sources;
  const sourceMap = useMemo(() => new Map(sources.map(s => [s.id, s])), [sources]);
  const favorite = (id: string, kind: 'favorite' | 'later' = 'favorite') => data.saved.some(s => s.item.id === id && s.kind === kind);
  const save = (item: ContentItem, kind: 'favorite' | 'later' = 'favorite') => mutate(() => { const had = favorite(item.id, kind); personal.toggleSaved(item, kind); notify(had ? '已移除' : (kind === 'favorite' ? '已放入收藏' : '已加入稍后读')); });
  const open = (item: ContentItem) => { setReader(item); if (storeStatus !== 'loading') mutate(() => personal.markRead(item.id)); };
  const note = (item: ContentItem) => mutate(() => { const id = personal.createNote(item); setReader(null); go('notes', '?id=' + encodeURIComponent(id)); notify('来源已附在笔记中，写下你的想法吧'); });
  const visibleItems = useMemo(() => feed.snapshot.items.filter(i => !prefs.disabledSources.includes(i.sourceId) && !prefs.blockedKeywords.some(k => k && (i.title + ' ' + (i.description || '')).toLowerCase().includes(k.toLowerCase()))), [feed.snapshot.items, prefs.disabledSources, prefs.blockedKeywords]);
  const articles = useMemo(() => visibleItems.filter(i => i.kind === 'article').sort((a, b) => (Date.parse(b.publishedAt || b.fetchedAt) || 0) - (Date.parse(a.publishedAt || a.fetchedAt) || 0)), [visibleItems]);
  const trends = visibleItems.filter(i => sourceMap.get(i.sourceId)?.category === 'trends');
  const workingTrend = sources.find(s => s.category === 'trends' && trends.some(i => i.sourceId === s.id));
  const lead = articles.find(i => i.image) || articles[0];
  const second = articles.filter(i => i.id !== lead?.id).slice(0, 2);
  const watchedInstruments = migrateWatchlist(prefs.watchlist).map(id => resolveInstrument(id, prefs.customSymbols || [])).filter((item): item is NonNullable<typeof item> => item !== null);
  const browseItems = useMemo(() => browseCollection(visibleItems, browseInterest), [visibleItems, browseInterest]);
  const browseStart = Math.min(browseOffset, Math.max(0, Math.floor((browseItems.length - 1) / 4) * 4));
  const activeNotes = useMemo(() => data.notes.filter(note => !note.deletedAt).map(({ id, title, body }) => ({ id, title, body })), [data.notes]);
  const reminderCount = data.reminders.filter(r => !r.completedAt && Date.parse(r.dueAt) <= now).length;
  const dateText = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(now));
  const matched = (i: ContentItem) => (!query.trim() || (i.title + ' ' + (i.description || '')).toLowerCase().includes(query.trim().toLowerCase()));
  const filteredNews = articles.filter(i => (channel === '全部' || i.channel === channel) && (!sourceFilter || i.sourceId === sourceFilter) && matched(i));
  const libraryItems = data.saved.filter(s => s.kind === libraryTab).map(s => s.item).filter(matched);
  const searchItems = [...new Map([...visibleItems, ...data.saved.map(s => s.item)].filter(matched).map(i => [i.id, i])).values()];
  const sourceCounts = sources.filter(s => s.status === 'ok' && !!s.lastSuccessAt && now - Date.parse(s.lastSuccessAt) < 7200000).length;
  const renderRows = (items: ContentItem[]) => <>{items.slice(0, visibleCount).map(item => <NewsRow key={item.id} item={item} source={sourceMap.get(item.sourceId)} onOpen={() => open(item)} onSave={() => save(item)} saved={favorite(item.id)} read={data.readIds.includes(item.id)} compact={prefs.density === 'compact'} />)}{items.length > visibleCount && <button className="load-more button" onClick={() => setVisibleCount(n => n + 20)}>再读一些 <ArrowDown size={15} /></button>}</>;
  return <div className="app">
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="收起导航" />}
    <aside className={'sidebar ' + (mobileOpen ? 'is-open' : '')}>
      <a className="brand" href="#/today" onClick={e => { e.preventDefault(); go('today'); }}><span className="brand-symbol"><span /><span /><span /></span><span>信息书房<small>THE DAILY STUDY</small></span></a>
      <div className="sidebar-caption">你的每日视野</div>
      <nav aria-label="主导航">{nav.map(n => <a key={n.id} href={'#/' + n.id} className={'nav-link ' + (page === n.id ? 'current' : '')} aria-current={page === n.id ? 'page' : undefined} onClick={e => { e.preventDefault(); go(n.id); }}><n.icon /><span>{n.name}</span>{n.id === 'game' && <span className="nav-small">PLAY</span>}</a>)}</nav>
      <div className="sidebar-divider" /><div className="sidebar-caption">留给自己的</div>
      <nav aria-label="个人工具"><a className={'nav-link ' + (page === 'library' ? 'current' : '')} href="#/library" onClick={e => { e.preventDefault(); go('library'); }}><Bookmark /><span>收藏与稍后读</span><span className="nav-count">{data.saved.length || ''}</span></a><a className={'nav-link ' + (page === 'reminders' ? 'current' : '')} href="#/reminders" onClick={e => { e.preventDefault(); go('reminders'); }}><Bell /><span>记事提醒</span>{reminderCount > 0 && <span className="nav-count notification-count">{reminderCount}</span>}</a></nav>
      <div className="sidebar-bottom"><div className="reading-quote"><BookOpen size={22} /><p>看见世界，<br />也留一点时间给自己。</p></div><a className={'nav-link ' + (page === 'settings' ? 'current' : '')} href="#/settings" onClick={e => { e.preventDefault(); go('settings'); }}><Settings2 /><span>偏好设置</span></a><div className="local-profile"><div className="profile-avatar">我</div><span>我的书房<small>此刻，在这里</small></span><span className="profile-dot" title="个人资料保存于当前浏览器" /></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="topbar-location"><IconButton label="展开导航" className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu /></IconButton><span className="breadcrumb">我的书房</span><span className="breadcrumb-separator">/</span><strong>{pageNames[page]}</strong></div><div className="topbar-tools"><label className="global-search"><Search size={16} /><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索新闻、热榜与收藏" aria-label="搜索新闻、热榜与收藏" /><kbd>{navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd>{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}</label><IconButton label={document.documentElement.dataset.theme === 'light' ? '切换深色模式' : '切换浅色模式'} onClick={() => mutate(() => personal.setPrefs({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }))}>{prefs.theme === 'light' ? <Moon /> : <Sun />}</IconButton><IconButton label="记事提醒" onClick={() => go('reminders')} className="notification-button"><Bell />{reminderCount > 0 && <span />}</IconButton></div></header>
      <main id="main-content" tabIndex={-1} className={'main-content page-' + page}>
        {storeStatus === 'error' && <div className="notice-bar warning"><span>本机保存暂时失败，请到设置中导出备份；当前编辑内容仍保留在页面中。</span><button onClick={() => go('settings')}>前往备份 <ArrowRight size={14} /></button></div>}
        {feed.pending && <div className="notice-bar"><span><Sparkles size={15} /> 有一批新内容，准备好再开始阅读。</span><button onClick={feed.accept}>载入更新 <ArrowDown size={14} /></button></div>}
        {query.trim() ? <><div className="page-heading"><div><span className="eyebrow">在书房里寻找</span><h1>搜索结果</h1><p>“{query}” · 当前快照与收藏中的 {searchItems.length} 条内容</p></div><button className="button" onClick={() => setQuery('')}>返回 <X size={14} /></button></div><div className="feed-list">{searchItems.length ? renderRows(searchItems) : <Empty title="暂时没有找到" text="试试更短的关键词。笔记内的文字可以在笔记页搜索。" icon={<Search />} />}</div></> :
          page === 'today' ? <>
            <div className="page-heading today-heading"><div><div className="eyebrow"><span className="semantic-dot" /> {dateText}</div><h1>先逛一会儿，<span>再看看世界。</span></h1><p>新闻、脑洞和有趣的日常，都可以有一个位置。</p></div><div className="refresh-area"><button className="button" onClick={() => void feed.refresh()} disabled={feed.loading}><RefreshCw className={feed.loading ? 'spin' : ''} />{feed.loading ? '正在检查' : '刷新内容'}</button><small>{sourceCounts ? sourceCounts + ' 个来源可用 · 新闻与社区陆续更新' : '正在连接你的信息来源'}</small></div></div>
            {feed.error && <div className="inline-notice">{feed.error}。已有内容仍可阅读。<button className="text-button" onClick={() => void feed.refresh()}>重试</button></div>}
            <div className="today-shortcuts" aria-label="发现入口">
              <button onClick={() => go('radar')}><span className="shortcut-icon"><Orbit size={20} /></span><span><strong>看看热点星图</strong><small>今天反复出现了哪些词？</small></span><ArrowUpRight size={15} /></button>
              <button onClick={() => go('office')}><span className="shortcut-icon office"><Users size={20} /></span><span><strong>找 AI 小队聊聊</strong><small>工作、学习，或一个突然的念头</small></span><ArrowUpRight size={15} /></button>
              <button onClick={() => go('trends')}><span className="shortcut-icon trends"><Flame size={20} /></span><span><strong>换个平台逛逛</strong><small>六个平台，各有各的热闹</small></span><ArrowUpRight size={15} /></button>
            </div>
            <section className="today-browse" aria-labelledby="browse-heading">
              <div className="browse-heading"><div><span className="eyebrow"><Sparkles size={12} /> LEAVE ROOM FOR CURIOSITY</span><h2 id="browse-heading">逛一会儿</h2><p>从不同来源各拿一点，不用每次都那么正经。</p></div><button className="text-button" onClick={() => go('office')}>让小队帮忙挑 <ArrowRight size={14} /></button></div>
              <div className="browse-toolbar"><div className="browse-interest-tabs" role="group" aria-label="逛一会儿兴趣">{browseInterests.map(interest => <button key={interest.id} aria-pressed={browseInterest === interest.id} className={browseInterest === interest.id ? 'selected' : ''} onClick={() => setBrowseInterest(interest.id)}>{interest.label}</button>)}</div>{browseItems.length > 4 && <button className="browse-next" onClick={() => setBrowseOffset(browseStart + 4 >= browseItems.length ? 0 : browseStart + 4)}><RefreshCw size={13} />换一组<span>{Math.floor(browseStart / 4) + 1}/{Math.ceil(browseItems.length / 4)}</span></button>}</div>
              {browseItems.length > 0 ? <div className="browse-cards">{browseItems.slice(browseStart, browseStart + 4).map(item => {
                const video = item.kind === 'video' || item.mediaType === 'video';
                const source = sourceMap.get(item.sourceId);
                return <article className="browse-card" key={item.id}>
                  <button className={'browse-cover ' + (!item.image ? 'without-image' : '')} aria-label={'打开内容：' + item.title} onClick={() => open(item)}>{item.image ? <img src={safeUrl(item.image)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.opacity = '0'; }} /> : <span className="browse-cover-symbol">{video ? <Play size={28} /> : item.kind === 'topic' ? <Flame size={28} /> : <Sparkles size={28} />}</span>}<span className="browse-format">{video ? <><Play size={10} />视频</> : item.kind === 'post' ? '推荐帖子' : item.kind === 'topic' ? '社区热议' : '科技读物'}</span><span className="browse-cover-open"><ArrowUpRight size={14} /></span></button>
                  <div className="browse-card-copy"><span className="browse-source">{source?.label || '内容来源'}</span><button className="browse-title" onClick={() => open(item)}><h3>{item.title}</h3></button><div className="browse-card-foot"><span title={fullTime(item.fetchedAt)}>{source && sourceState(source).tone === 'warning' ? '缓存 · ' : ''}{relativeTime(item.fetchedAt)}</span><IconButton label={favorite(item.id) ? '取消收藏：' + item.title : '收藏：' + item.title} active={favorite(item.id)} onClick={() => save(item)}><Bookmark size={14} /></IconButton></div></div>
                </article>;
              })}</div> : <div className="browse-empty"><Sparkles size={22} /><p>这个兴趣下还没有可用内容，换个频道继续逛逛吧。</p><button className="text-button" onClick={() => go('trends')}>查看各平台状态 <ArrowUpRight size={13} /></button></div>}
              <footer className="browse-foot"><span>来自当前内容快照 · 按来源轮流展示，兴趣由标题与内容类型筛选。</span><button className="text-button" onClick={() => { setPlatform(browseInterest === 'daily' ? 'xiaohongshu' : browseInterest === 'tech' ? 'zhihu' : 'bilibili'); go('trends'); }}>继续发现 <ArrowUpRight size={12} /></button></footer>
            </section>
            <div className="today-grid"><div className="today-main"><div className="lead-grid">{lead ? <Featured item={lead} source={sourceMap.get(lead.sourceId)} onOpen={() => open(lead)} /> : <div className="featured-story empty-feature"><Globe2 /><h2>{feed.loading ? '正在打开今天的世界' : '等待第一批真实内容'}</h2><p>{feed.loading ? '稍等片刻，正在读取来源快照。' : '还没有可用的新闻快照。你仍可以记录笔记，或查看来源状态。'}</p><button className="button" onClick={() => go('settings')}>查看来源状态 <ArrowRight size={15} /></button></div>}<div className="secondary-stories">{second.map(item => <article key={item.id}><span className="channel-label">{item.channel}</span><button className="news-title-button" onClick={() => open(item)}><h3>{item.title}</h3></button><div className="secondary-footer"><span>{sourceMap.get(item.sourceId)?.label}</span><ArrowUpRight size={17} /></div></article>)}{!second.length && <div className="secondary-placeholder"><BookOpen /><p>好的阅读，<br />从真实的来源开始。</p></div>}</div></div>
              <section className="latest-section"><div className="section-heading"><h2>值得一读 <span className="section-count">{articles.length}</span></h2><button className="text-button" onClick={() => go('news')}>全部新闻 <ArrowRight size={14} /></button></div><div className="channel-tabs" role="group" aria-label="新闻频道">{channels.map(c => <button className={channel === c ? 'selected' : ''} key={c} onClick={() => setChannel(c)}>{c}</button>)}</div><div className="feed-list">{filteredNews.length ? renderRows(filteredNews.filter(i => channel !== '全部' || i.id !== lead?.id)) : <Empty title="这个频道还很安静" text="当前没有符合条件的内容，可以换个频道或调整来源。" />}</div></section>
            </div><aside className="today-rail"><TrendPreview source={workingTrend} items={trends.filter(i => i.sourceId === workingTrend?.id)} onOpen={open} onMore={() => { setPlatform(workingTrend?.platform || 'bilibili'); go('trends'); }} />
              <section className="rail-section market-glance"><div className="section-heading"><h2><TrendingUp /> 我的关注</h2><button className="text-button" aria-label="打开看盘桌面" onClick={() => go('markets')}><ArrowUpRight size={16} /></button></div>{watchedInstruments.slice(0, 4).map(instrument => <button className="market-mini market-watch-link" key={instrument.id} onClick={() => mutate(() => { personal.setPrefs({ activeSymbol: instrument.symbol }); setMarket('我的自选'); go('markets'); })}><span>{instrument.name}<small>{instrument.symbol}</small></span><span className="watch-chart-link">查看走势 <ArrowUpRight size={13} /></span></button>)}{!watchedInstruments.length && <><p className="quiet-note">把关心的股票与商品放进自选，随时回来观察价格变化。</p><button className="button" style={{marginTop:14}} onClick={() => go('markets')}><Plus size={14} /> 添加自选标的</button></>}<p className="small-status">K 线持续更新 · 股票数据可能延迟</p></section>
              <section className="rail-section daily-note"><div className="section-heading"><h2><BookMarked /> 留一点想法</h2></div><p>今天读到的哪件事，<br />值得被记住？</p><button className="button" onClick={() => mutate(() => { const id = personal.createNote(); go('notes', '?id=' + id); })}><Plus size={15} /> 写一则笔记</button><div className="note-lines"><i /><i /><i /></div></section>
              {!!reminderCount && <button className="due-reminder" onClick={() => go('reminders')}><Bell /><span>{reminderCount} 件事等待处理<small>给今天留一点安排</small></span><ArrowUpRight size={15} /></button>}
            </aside></div>
          </> : page === 'news' ? <>
            <div className="page-heading"><div><span className="eyebrow">READ THE WORLD</span><h1>新闻，与你有关。</h1><p>从多个视角，接近事情的全貌。</p></div><button className="button" onClick={() => void feed.refresh()} disabled={feed.loading}><RefreshCw className={feed.loading ? 'spin' : ''} /> 检查更新</button></div>
            <div className="feed-toolbar"><div className="channel-tabs">{channels.map(c => <button key={c} className={channel === c ? 'selected' : ''} onClick={() => setChannel(c)}>{c}</button>)}</div><label className="source-select"><ListFilter size={14} /><select aria-label="筛选新闻来源" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}><option value="">全部来源</option>{sources.filter(s => s.category === 'news').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select><ChevronDown size={13} /></label></div><div className="wide-feed feed-list">{filteredNews.length ? renderRows(filteredNews) : <Empty title="没有符合条件的新闻" text="可以换个来源、频道，或稍后再来。" />}</div>
          </> : page === 'trends' ? <>
            <div className="page-heading"><div><span className="eyebrow">THE CONVERSATION</span><h1>此刻，大家在看。</h1><p>热搜、脑洞和认真提问，各有各的热闹。</p></div><div className="trends-heading-actions"><button className="button" onClick={() => go('radar')}><Orbit size={15} />看看热词星图</button><button className="button" onClick={() => void feed.refresh()} disabled={feed.loading}><RefreshCw className={feed.loading ? 'spin' : ''} />检查更新</button></div></div>
            <div className="platform-tabs" role="group" aria-label="热榜平台">{platforms.map(p => <button key={p.id} aria-pressed={platform === p.id} className={platform === p.id ? 'selected' : ''} onClick={() => setPlatform(p.id)}><span className={'platform-logo ' + p.id}>{p.short}</span><span>{p.name}<small>{p.subtitle}</small></span><ArrowUpRight size={15} /></button>)}</div>
            {platform === 'xiaohongshu' ? <Suspense fallback={<div className="quiet-note">正在打开推荐帖子…</div>}><FeatureBoundary key={platform} name="推荐帖子"><Recommendations sources={sources} items={visibleItems.filter(i => sourceMap.get(i.sourceId)?.platform === 'xiaohongshu')} onOpen={open} onSave={save} isSaved={id => favorite(id)} /></FeatureBoundary></Suspense> : (() => {
              const source = sources.find(candidate => candidate.platform === platform);
              const selectedPlatform = platforms.find(candidate => candidate.id === platform)!;
              const list = trends.filter(item => sourceMap.get(item.sourceId)?.platform === platform).sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
              const state = source ? sourceState(source) : { label: '暂未接通', tone: 'warning' };
              const heading = platform === 'twitter' ? source?.label || selectedPlatform.name + ' · ' + selectedPlatform.subtitle : source?.label || selectedPlatform.name + ' · 热榜';
              return <section className={'ranking-panel ranking-platform-' + platform}>
                <div className="ranking-header"><h2>{heading}</h2><span className={'status-pill ' + state.tone}>{state.label}</span><span className="last-fetched">获取于 {fullTime(source?.lastSuccessAt)}</span><a className="text-button" href={safeUrl(source?.homepage) || selectedPlatform.url} target="_blank" rel="noopener noreferrer">原站查看 <ArrowUpRight size={14} /></a></div>
                {list.length > 0 ? <div className={'rank-list ' + (platform === 'bilibili' ? 'video-ranks' : '')}>{list.slice(0, visibleCount).map((item, index) => <article className="ranking-row" key={item.id}>
                  <span className={'rank-number ' + (item.rank === undefined ? 'rank-unordered' : 'rank-' + index)} aria-label={item.rank === undefined ? '趋势条目，无官方名次' : '第' + item.rank + '名'}>{item.rank ?? '·'}</span>
                  {item.image && <button className="rank-thumb" aria-label={(item.kind === 'video' || item.mediaType === 'video' ? '观看 ' : '打开内容：') + item.title} onClick={() => open(item)}><img src={safeUrl(item.image)} loading="lazy" alt="" referrerPolicy="no-referrer" />{(item.kind === 'video' || item.mediaType === 'video') && <Play size={15} />}</button>}
                  <div className="rank-copy"><button className="news-title-button" onClick={() => open(item)}><h3>{item.title}</h3></button><div>{item.author && <span>{item.author}</span>}{item.heat && <span><Flame size={11} />{item.heat}</span>}</div></div><IconButton label={favorite(item.id) ? '取消收藏' : '收藏'} active={favorite(item.id)} onClick={() => save(item)}><Bookmark /></IconButton><button className="rank-open" onClick={() => open(item)} aria-label={'打开 ' + item.title}><ArrowUpRight size={18} /></button>
                </article>)}{list.length > visibleCount && <button className="button load-more" onClick={() => setVisibleCount(count => count + 20)}>展开更多 <ArrowDown size={14} /></button>}</div> : <Empty title={platform === 'twitter' ? '这份地区趋势暂时没有可用数据' : '这份榜单暂未接通'} text={source?.message || '暂时没有可用的自动更新数据，可以直接前往原站看看。'} icon={<Flame />}><a className="button primary" href={selectedPlatform.url} target="_blank" rel="noopener noreferrer">前往{selectedPlatform.name} <ArrowUpRight size={15} /></a></Empty>}
                <div className="ranking-footnote">{platform === 'twitter' ? '按来源返回的地区趋势展示；未提供官方名次的条目以圆点标记。' : '各平台热度口径不同，仅在同一榜单内比较。'}{source?.message && list.length > 0 ? ' ' + source.message : ''}{source?.attribution && <span className="ranking-attribution">{source.attribution}</span>}</div>
              </section>;
            })()}
          </> : page === 'radar' ? <>
            <div className="page-heading"><div><span className="eyebrow">CONNECT THE CONVERSATION</span><h1>把热闹，拼成一张图。</h1><p>从你已载入的新闻、视频和社区话题中，发现反复出现的词。</p></div><button className="button" onClick={() => go('trends')}><Flame size={15} />回到各平台</button></div>
            <Suspense fallback={<div className="quiet-note">正在整理标题里的热词…</div>}><FeatureBoundary key={page} name="热点星图"><HotwordRadar items={visibleItems} sources={sources} generationId={feed.snapshot.generationId} onOpen={open} onRefresh={() => void feed.refresh()} refreshing={feed.loading} /></FeatureBoundary></Suspense>
          </> : page === 'office' ? <Suspense fallback={<div className="quiet-note">正在打开小队的办公室…</div>}><FeatureBoundary key={page} name="AI 办公室"><AiOffice items={visibleItems} sources={sources} watchSymbols={watchedInstruments.map(instrument => instrument.symbol)} notes={activeNotes} privateOfficeUrl={import.meta.env.VITE_PRIVATE_OFFICE_URL} standalone={false} onOpen={open} /></FeatureBoundary></Suspense> : page === 'markets' ? <>
            <div className="page-heading"><div><span className="eyebrow">MARKET JOURNAL</span><h1>我的看盘桌面。</h1><p>关注自己的标的，在 K 线与价格变化中理解市场。</p></div><a className="button" href="https://quote.eastmoney.com/center/" target="_blank" rel="noopener noreferrer">更多市场信息 <ArrowUpRight size={15} /></a></div><div className="channel-tabs market-tabs">{['全部市场', 'A股', '美股', '大宗商品', '我的自选'].map(t => <button className={market === t ? 'selected' : ''} onClick={() => setMarket(t)} key={t}>{t}</button>)}</div>
            <Suspense fallback={<div className="quiet-note">正在准备来源图表…</div>}><FeatureBoundary key={page} name="行情图表"><MarketWidget market={market} onToast={notify} onMarketChange={setMarket} /></FeatureBoundary></Suspense>
            <section><div className="section-heading"><h2>财经观察</h2><span className="quiet-label">政策、公司与全球经济</span></div><div className="feed-list">{articles.filter(i => i.channel === '财经').length ? renderRows(articles.filter(i => i.channel === '财经')) : <Empty title="财经报道等待更新" text="可先查看新闻中心的其他频道。" />}</div></section>
          </> : page === 'library' ? <>
            <div className="page-heading"><div><span className="eyebrow">KEEP WHAT MATTERS</span><h1>留住，值得的。</h1><p>好内容有它的时间，想读时再回来。</p></div><BookMarked className="heading-watermark" /></div><div className="channel-tabs"><button className={libraryTab === 'favorite' ? 'selected' : ''} onClick={() => setLibraryTab('favorite')}><Bookmark size={14} /> 我的收藏 <span>{data.saved.filter(s => s.kind === 'favorite').length}</span></button><button className={libraryTab === 'later' ? 'selected' : ''} onClick={() => setLibraryTab('later')}><Clock3 size={14} /> 稍后读 <span>{data.saved.filter(s => s.kind === 'later').length}</span></button></div><div className="feed-list">{libraryItems.length ? renderRows(libraryItems) : <Empty title="给好内容留一个位置" text="阅读时点击收藏或稍后读，它就会安静地等在这里。" icon={<Bookmark />} />}</div>
          </> : page === 'game' ? <Suspense fallback={<Empty title="正在准备远征" text="游戏资源只在你进入休息室时加载。" icon={<LoaderCircle className="spin" />} />}><FeatureBoundary key={page} name="信号远征"><Game onToast={notify} /></FeatureBoundary></Suspense> :
          <Personal tab={page === 'settings' ? 'settings' : page === 'reminders' ? 'reminders' : 'notes'} onToast={notify} sources={sources} />}
        <footer className="page-footer"><span>信息书房 <span className="footer-divider">/</span> 看见世界，留下思考</span><span>{feed.snapshot.generatedAt ? '内容快照 · ' + fullTime(feed.snapshot.generatedAt) : '期待与你的每一次阅读'}</span></footer>
      </main>
    </div>
    <nav className="mobile-bottom-nav" aria-label="手机导航">{nav.filter(n => mobilePages.includes(n.id)).map(n => <button className={page === n.id ? 'current' : ''} key={n.id} onClick={() => go(n.id)}><n.icon size={19} /><span>{n.name}</span></button>)}<button className={!mobilePages.includes(page) ? 'current' : ''} onClick={() => setMobileOpen(true)} aria-label="更多页面"><Menu size={19} /><span>更多</span></button></nav>
    {reader && <Reader key={reader.id} item={reader} source={sourceMap.get(reader.sourceId)} onClose={() => setReader(null)} onSave={() => save(reader)} onLater={() => save(reader, 'later')} onNote={() => note(reader)} saved={favorite(reader.id)} later={favorite(reader.id, 'later')} fontSize={prefs.fontSize} setFont={n => mutate(() => personal.setPrefs({ fontSize: n }))} width={prefs.readerWidth} />}
    <ReminderNotifier onToast={notify} />
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}

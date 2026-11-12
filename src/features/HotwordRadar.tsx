import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BarChart3, Clock3, Download, Orbit, RefreshCw, Sparkles } from 'lucide-react';
import type { ContentItem, Source } from '../types';
import { fullTime, relativeTime, sourceState } from '../lib/feed';
import { buildHotwords, HOTWORD_SCOPES, layoutHotwords, type HotwordScope, type PositionedHotword } from '../lib/hotwords';
import './hotword-radar.css';

type Props = {
  items: ContentItem[];
  sources: Source[];
  generationId: string;
  onOpen: (item: ContentItem) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};
const cloudColors = ['#4973b8', '#a26f97', '#598e8d', '#8a76b4', '#ad8358'];
function useCloudWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(650);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => setWidth(Math.max(160, Math.round(host.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver !== 'function') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure); observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
function xml(text: string) { return text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[value]!)); }
function exportCloud(words: PositionedHotword[], corpusCount: number, scope: string, width: number, height: number) {
  const margin = 36;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width + margin * 2}" height="${height + 142}" viewBox="0 0 ${width + margin * 2} ${height + 142}"><rect width="100%" height="100%" rx="24" fill="#f1f6ff"/><text x="${margin}" y="43" font-family="sans-serif" font-size="23" font-weight="600" fill="#314866">热点星图 · ${xml(scope)}</text><text x="${margin}" y="68" font-family="sans-serif" font-size="12" fill="#65788f">来自 ${corpusCount} 条去重标题；数字为提及该词的标题数，每条标题最多计一次。</text>${words.map(word => `<text x="${word.x + margin + word.width / 2}" y="${word.y + 88 + word.height / 2}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${word.fontSize}" font-weight="600" fill="${cloudColors[word.color]}">${xml(word.label)}<tspan font-size="12" dx="5">${word.count}</tspan></text>`).join('')}<text x="${margin}" y="${height + 119}" font-family="sans-serif" font-size="11" fill="#65788f">信息书房 · 当前已载入快照的标题统计，不汇总平台热度，不代表全网热度。</text></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = '热点星图-' + date + '.svg';
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HotwordRadar({ items, sources, generationId, onOpen, onRefresh, refreshing = false }: Props) {
  const [scope, setScope] = useState<HotwordScope>('fun');
  const [includeSingles, setIncludeSingles] = useState(false);
  const [view, setView] = useState<'cloud' | 'rank'>('cloud');
  const [selectedKey, setSelectedKey] = useState('');
  const [visibleStories, setVisibleStories] = useState(6);
  const [notice, setNotice] = useState('');
  const { ref: cloudRef, width } = useCloudWidth();
  const height = width < 480 ? 360 : 400;
  const result = useMemo(() => buildHotwords(items, { scope, minFrequency: includeSingles ? 1 : 2, limit: 60 }), [items, scope, includeSingles, generationId]);
  const positioned = useMemo(() => layoutHotwords(result.terms, width, height), [result.terms, width, height]);
  const selected = result.terms.find(word => word.key === selectedKey) || result.terms[0];
  const evidence = selected ? result.corpus.filter(item => selected.itemIds.includes(item.id)) : [];
  const sourceMap = useMemo(() => new Map(sources.map(source => [source.id, source])), [sources]);
  const scopeInfo = HOTWORD_SCOPES.find(value => value.id === scope)!;
  const choose = (key: string) => { setSelectedKey(key); setVisibleStories(6); };
  const download = () => {
    const arranged = layoutHotwords(result.terms, 1000, 480);
    exportCloud(arranged, result.corpus.length, scopeInfo.label, 1000, 480);
    setNotice('词云已导出为 SVG，可在浏览器中打开或保存为图片。');
  };
  return <section className="hotword-radar" aria-labelledby="hotword-heading">
    <header className="hotword-header"><div><div className="hotword-kicker"><Orbit size={15} /> SIGNAL GARDEN</div><h2 id="hotword-heading">今天的热闹，长什么样？<span>热点星图</span></h2><p>把四散的标题聚在一起，让反复出现的词自己浮出来。</p></div><div className="hotword-actions"><button className="button" disabled={!result.terms.length} onClick={download}><Download size={14} />导出词云</button>{onRefresh && <button className="button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />{refreshing ? '检查中' : '检查新热点'}</button>}</div></header>
    <div className="hotword-controls"><div className="hotword-scope" role="group" aria-label="热词内容范围">{HOTWORD_SCOPES.map(option => <button key={option.id} title={option.description} aria-pressed={scope === option.id} className={scope === option.id ? 'selected' : ''} onClick={() => { setScope(option.id); setVisibleStories(6); }}>{option.label}</button>)}</div><div className="hotword-view" role="group" aria-label="热词显示方式"><button aria-pressed={view === 'cloud'} className={view === 'cloud' ? 'selected' : ''} onClick={() => setView('cloud')}><Orbit size={14} />星图</button><button aria-pressed={view === 'rank'} className={view === 'rank' ? 'selected' : ''} onClick={() => setView('rank')}><BarChart3 size={14} />词频排行</button></div></div>
    <div className="hotword-meta"><span><strong>{result.corpus.length}</strong>条去重标题</span><span><strong>{result.sourceCount}</strong>个来源</span><span><strong>{result.terms.length}</strong>个热词</span><label><input type="checkbox" checked={includeSingles} onChange={event => setIncludeSingles(event.target.checked)} />包括只出现一次的词</label></div>
    <div className="hotword-workspace"><div className="hotword-visual-area"><div className="hotword-chart-caption"><span><Sparkles size={13} />字越大，提及它的标题越多</span><span>点击热词，查看内容</span></div>
      <div ref={cloudRef} className={'hotword-cloud-host ' + (view === 'rank' ? 'show-rank' : '')}>
        {view === 'cloud' ? <div className="hotword-cloud" role="group" aria-label="可点击的标题词云" style={{ height }}>{positioned.map(word => <button key={word.key} className={'hotword-cloud-word color-' + word.color + (selected?.key === word.key ? ' selected' : '')} style={{ left: word.x, top: word.y, width: word.width, height: word.height, fontSize: word.fontSize }} aria-label={word.label + '，' + word.count + '条标题提及，' + word.sourceCount + '个来源'} aria-pressed={selected?.key === word.key} onClick={() => choose(word.key)}><span>{word.label}</span><sup>{word.count}</sup></button>)}{!result.terms.length && <div className="hotword-empty"><Orbit size={32} /><strong>{result.corpus.length ? '这些标题还没有共同的热词' : '还没有可统计的标题'}</strong><p>{result.corpus.length ? '可以包含单次词，或换一个内容范围看看。' : '载入一批真实内容后，这片星空就会亮起来。'}</p>{result.corpus.length > 0 && !includeSingles && <button className="button" onClick={() => setIncludeSingles(true)}>显示单次词</button>}</div>}</div> : <ol className="hotword-ranking" aria-label="按标题提及次数排序的热词">{result.terms.map((word, index) => <li key={word.key}><button aria-pressed={selected?.key === word.key} className={selected?.key === word.key ? 'selected' : ''} onClick={() => choose(word.key)}><span className="hotword-rank-index">{String(index + 1).padStart(2, '0')}</span><span className="hotword-rank-copy"><strong>{word.label}</strong><span className="hotword-rank-track"><span style={{ width: (word.count / result.terms[0].count * 100) + '%' }} /></span></span><span className="hotword-rank-count"><strong>{word.count}</strong>条标题</span><span className="hotword-rank-sources">{word.sourceCount}个来源</span></button></li>)}{!result.terms.length && <li className="hotword-rank-empty">当前范围没有符合条件的热词。试试勾选“包括只出现一次的词”。</li>}</ol>}
      </div><div className="hotword-chart-foot"><span>{view === 'cloud' ? `星图排入 ${positioned.length} / ${result.terms.length} 个热词；完整列表见词频排行。` : '按不同标题的提及次数排序，相同次数时按来源数排序。'}</span>{result.latestFetchedAt && <span><Clock3 size={11} />最近采集 {fullTime(result.latestFetchedAt)}</span>}</div>
    </div><aside className="hotword-evidence" aria-label="热词关联内容"><div className="hotword-evidence-heading"><span>顺着一个词，逛进去</span>{selected ? <><h3>{selected.label}<span>{selected.count}条</span></h3><p>占本范围标题的 {(selected.share * 100).toFixed(1)}% · 涉及 {selected.sourceCount} 个来源</p></> : <h3>等一个有趣的词</h3>}</div>{evidence.length ? <><div className="hotword-evidence-stories">{evidence.slice(0, visibleStories).map(item => { const source = sourceMap.get(item.sourceId); const state = source ? sourceState(source) : null; return <button key={item.id} className="hotword-story" onClick={() => onOpen(item)}><span className="hotword-story-meta"><span>{source?.label || '内容来源'}</span>{(item.kind === 'video' || item.mediaType === 'video') && <span className="hotword-story-kind">视频</span>}{state?.tone === 'warning' && <span className="hotword-story-stale">{state.label}</span>}</span><strong>{item.title}</strong><span className="hotword-story-bottom"><time title={fullTime(item.fetchedAt)}>获取于 {relativeTime(item.fetchedAt)}</time><ArrowUpRight size={13} /></span></button>; })}</div>{evidence.length > visibleStories && <button className="hotword-more" onClick={() => setVisibleStories(count => count + 6)}>再看 {Math.min(6, evidence.length - visibleStories)} 条关联内容</button>}</> : <div className="hotword-evidence-empty"><Sparkles size={23} /><p>选择星图里的一个词，关联的新闻、视频和帖子会出现在这里。</p></div>}</aside></div>
    <footer className="hotword-method"><p><strong>怎么算的？</strong>只统计标题，每条标题对同一个词最多计一次；同标题转载合并，不相加各平台的播放数或热度。已合并 {result.duplicateCount} 条重复标题。</p><p>{scopeInfo.description}。{result.mode === 'basic' ? '当前浏览器采用本地短词匹配，中文覆盖可能较少。' : '采用浏览器中文分词、常见短语合并与虚词过滤。'}随载入的新快照自动重算，可能包含来源缓存，不代表全网热度。</p></footer>
    {notice && <p className="hotword-export-notice" role="status">{notice}</p>}
  </section>;
}

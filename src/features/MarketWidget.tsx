import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Activity, ArrowDown, ArrowUp, ArrowUpRight, BarChart3, Building2, CandlestickChart, Check, CircleHelp, Layers3, LineChart, Maximize2, Plus, RefreshCw, Search, SlidersHorizontal, Star, Trash2, X } from 'lucide-react';
import { personal, usePersonal } from '../lib/personal-store';
import { CHART_INTERVALS, INSTRUMENT_CATALOG, migrateWatchlist, resolveInstrument, searchInstruments, type Instrument } from '../lib/market-model';
import './market-desk.css';

type Props = { market: string; onToast?: (message: string) => void; onMarketChange?: (market: string) => void };
type DetailView = 'quote' | 'technicals' | 'fundamentals' | 'profile';
type WidgetName = 'advanced-chart' | 'symbol-info' | 'technical-analysis' | 'financials' | 'symbol-profile';
const intervalLabels: Record<string, string> = { '1': '1分', '5': '5分', '15': '15分', '60': '1小时', D: '日K', W: '周K', M: '月K' };
const kindLabels: Record<Instrument['kind'], string> = { stock: '股票', index: '指数', commodity: '商品', forex: '外汇', crypto: '数字资产', fund: '基金', other: '其他' };
const sourceLink = (instrument: Instrument) => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(instrument.symbol);

function useWidgetTheme() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** The official embed owns the market stream; cross-origin quotes stay inside the source. */
function SourceWidget({ widget, config, label, instrument, refreshKey = 0, className = '' }: {
  widget: WidgetName; config: Record<string, unknown>; label: string; instrument: Instrument; refreshKey?: number; className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'opening' | 'embedded' | 'waiting' | 'failed'>('opening');
  const [help, setHelp] = useState(false);
  const [retry, setRetry] = useState(0);
  const serialized = JSON.stringify(config);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let active = true;
    const frames = new Set<HTMLIFrameElement>();
    const frameLoaded = () => { if (active) setState('embedded'); };
    const inspectFrames = () => {
      for (const frame of host.querySelectorAll('iframe')) {
        if (frames.has(frame)) continue;
        frames.add(frame); frame.title = label; frame.addEventListener('load', frameLoaded);
      }
    };
    host.replaceChildren(); setState('opening'); setHelp(false);
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-' + widget + '.js';
    script.type = 'text/javascript'; script.async = true; script.textContent = serialized;
    script.onerror = () => { if (active) setState('failed'); };
    const observer = new MutationObserver(inspectFrames);
    observer.observe(host, { childList: true, subtree: true });
    host.append(inner, script); inspectFrames();
    const timer = setTimeout(() => { if (active && !host.querySelector('iframe')) setState('waiting'); }, 16000);
    return () => {
      active = false; clearTimeout(timer); observer.disconnect(); script.onerror = null;
      frames.forEach(frame => frame.removeEventListener('load', frameLoaded)); host.replaceChildren();
    };
  }, [widget, serialized, label, retry, refreshKey]);
  return <div className={'market-source-widget ' + className}>
    <div className="market-source-frame" aria-label={label}><div ref={root} className="market-source-embed tradingview-widget-container" /></div>
    {(state === 'failed' || state === 'waiting' || help) && <div className="market-source-help" role="status">
      <CircleHelp size={15} /><p>{state === 'failed' ? '暂时无法连接行情组件。' : '若组件内提示不支持此标的、数据延迟或需要更多权限，请以来源说明为准。'}<a href={sourceLink(instrument)} target="_blank" rel="noopener nofollow noreferrer">前往来源继续查看 <ArrowUpRight size={13} /></a></p>
      <button aria-label={'重试' + label} onClick={() => setRetry(n => n + 1)}><RefreshCw size={14} /></button>
    </div>}
    <div className="market-source-credit"><a href={sourceLink(instrument)} target="_blank" rel="noopener nofollow noreferrer">{instrument.name} · TradingView</a><button onClick={() => setHelp(v => !v)} aria-expanded={help}>无法显示？</button></div>
  </div>;
}

function SymbolPicker({ customSymbols, selected, onChoose, onClose }: {
  customSymbols: Instrument[]; selected: string[]; onChoose: (instrument: Instrument) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [exchange, setExchange] = useState('');
  const [name, setName] = useState('');
  const [customMarket, setCustomMarket] = useState<Instrument['market']>('其他');
  const [kind, setKind] = useState<Instrument['kind']>('other');
  const trimmedQuery = query.trim();
  const effectiveExchange = trimmedQuery.includes(':') ? '' : exchange;
  const qualifiedQuery = effectiveExchange && /^[A-Za-z0-9.]+$/.test(trimmedQuery) ? effectiveExchange + ':' + trimmedQuery : trimmedQuery;
  const candidate = resolveInstrument(qualifiedQuery, customSymbols);
  const results = searchInstruments(query, customSymbols).filter(item => !effectiveExchange || item.exchange === effectiveExchange).slice(0, 14);
  const customCandidate = candidate && ![...INSTRUMENT_CATALOG, ...customSymbols].some(i => i.symbol === candidate.symbol) ? candidate : null;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal(); input.current?.focus();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { setName(''); setCustomMarket(customCandidate?.market || '其他'); setKind(customCandidate?.kind || 'other'); }, [customCandidate?.symbol]);
  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    if (customCandidate) onChoose({ ...customCandidate, name: name.trim() || customCandidate.name, market: customMarket, kind });
  };
  return <dialog ref={dialog} className="market-symbol-dialog" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><div><span>让关注，成为自己的选择</span><h2>添加自选标的</h2></div><button className="icon-button" aria-label="关闭添加标的" onClick={onClose}><X /></button></header>
    <label className="market-symbol-search"><Search size={18} /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="中文名、股票代码或 NASDAQ:NVDA" aria-label="搜索标的名称或代码" autoComplete="off" spellCheck={false} />{query && <button aria-label="清空标的搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label>
    <div className="market-exchange-select"><label>交易所<select aria-label="选择标的交易所" value={exchange} onChange={event => setExchange(event.target.value)}><option value="">名称搜索 / 完整代码</option><option value="SSE">上海 · SSE</option><option value="SZSE">深圳 · SZSE</option><option value="NASDAQ">美股 · NASDAQ</option><option value="NYSE">美股 · NYSE</option><option value="AMEX">美股 · AMEX</option><option value="HKEX">香港 · HKEX</option></select></label><span>{exchange ? '已指定 ' + exchange + '，可直接输入股票代码' : '也可先选择交易所，再输入代码'}</span></div>
    <p className="market-symbol-tip">常见标的可搜索名称；其他标的可选交易所后输入代码，或输入 SSE:600519、NYSE:BABA 等完整代码。</p>
    <div className="market-symbol-results" role="list" aria-label="标的搜索结果">
      {results.map(instrument => <div role="listitem" key={instrument.symbol}><button className="market-symbol-result" onClick={() => onChoose(instrument)}>
        <span className={'market-instrument-icon type-' + instrument.kind}>{instrument.market === 'A股' ? '中' : instrument.market === '美股' ? 'US' : instrument.kind === 'commodity' ? 'M' : 'G'}</span>
        <span><strong>{instrument.name}</strong><small>{instrument.symbol} · {kindLabels[instrument.kind]}</small></span><span className="market-result-market">{instrument.market}</span>{selected.includes(instrument.symbol) ? <Check size={16} /> : <Plus size={16} />}
      </button></div>)}
      {results.length === 0 && !customCandidate && <div className="market-search-empty"><Search size={24} /><strong>还没有匹配的标的</strong><p>{query.trim() ? '试试指定交易所或使用完整代码。裸代码可能对应多个市场，请先确认交易所。' : '输入你想关注的公司或代码。'}</p></div>}
    </div>
    {customCandidate && <form className="market-custom-symbol" onSubmit={addCustom}>
      <div className="market-custom-heading"><Plus size={17} /><div><strong>添加自定义标的</strong><small>{customCandidate.symbol}</small></div></div>
      <p>代码格式有效。是否存在、能否显示行情和延迟情况，将由来源组件验证。</p>
      <label>显示名称<input value={name} onChange={event => setName(event.target.value)} placeholder={customCandidate.symbol} maxLength={80} /></label>
      <div className="market-custom-fields"><label>市场分组<select value={customMarket} onChange={event => setCustomMarket(event.target.value as Instrument['market'])}>{['A股', '美股', '大宗商品', '其他'].map(value => <option key={value}>{value}</option>)}</select></label><label>资产类型<select value={kind} onChange={event => setKind(event.target.value as Instrument['kind'])}>{Object.entries(kindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      <button className="button primary" type="submit"><Plus size={15} /> 添加并查看</button>
    </form>}
    <footer><span>自选保存在此浏览器，可随完整备份迁移。</span><a href="https://www.tradingview.com/chart/" target="_blank" rel="noopener noreferrer">在来源核对代码 <ArrowUpRight size={13} /></a></footer>
  </dialog>;
}

export default function MarketWidget({ market, onToast, onMarketChange }: Props) {
  const { data, status } = usePersonal();
  const theme = useWidgetTheme();
  const prefs = data.preferences;
  const customSymbols = prefs.customSymbols || [];
  const watchIds = migrateWatchlist(prefs.watchlist);
  const [picker, setPicker] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<DetailView>('quote');
  const [movingAverage, setMovingAverage] = useState(true);
  const [error, setError] = useState('');
  const chartShell = useRef<HTMLDivElement>(null);
  const matchesScope = (instrument: Instrument) => market === '全部市场' || market === '我的自选' || instrument.market === market;
  const knownWatchlist = watchIds.map(id => ({ id, instrument: resolveInstrument(id, customSymbols) }));
  const scopeWatchlist = knownWatchlist.filter(row => row.instrument ? matchesScope(row.instrument) : market === '全部市场' || market === '我的自选');
  const scopeCatalog = INSTRUMENT_CATALOG.filter(matchesScope);
  const preferredDefault = scopeCatalog.find(i => i.symbol === 'NASDAQ:AAPL') || scopeCatalog[0] || INSTRUMENT_CATALOG[0];
  const activePreference = resolveInstrument(prefs.activeSymbol || '', customSymbols);
  const instrument = activePreference && matchesScope(activePreference) ? activePreference : scopeWatchlist.find(row => row.instrument)?.instrument || preferredDefault;
  const preferredInterval = (CHART_INTERVALS as readonly string[]).includes(prefs.chartInterval || '') ? prefs.chartInterval! : '15';
  const aShareDailyOnly = ['SSE', 'SZSE'].includes(instrument.exchange);
  // Do not overwrite the saved intraday preference when this source needs a daily fallback.
  const interval = aShareDailyOnly && !['D', 'W', 'M'].includes(preferredInterval) ? 'D' : preferredInterval;
  const chartStyle = prefs.chartStyle === 'line' ? 'line' : 'candles';
  const isCompany = instrument.kind === 'stock';
  const selected = watchIds.includes(instrument.symbol);
  const activeDetail = !isCompany && (detail === 'fundamentals' || detail === 'profile') ? 'quote' : detail;
  const act = (callback: () => void) => {
    try { callback(); setError(''); }
    catch (cause) { const message = cause instanceof Error ? cause.message : '暂时无法保存，请稍后重试'; setError(message); onToast?.(message); }
  };
  const pick = (item: Instrument) => act(() => personal.setPrefs({ activeSymbol: item.symbol }));
  const add = (item: Instrument) => act(() => {
    const existing = migrateWatchlist(personal.getData().preferences.watchlist);
    const currentCustom = personal.getData().preferences.customSymbols || [];
    const isNew = !existing.includes(item.symbol);
    const nextCustom = INSTRUMENT_CATALOG.some(i => i.symbol === item.symbol) ? currentCustom : [...currentCustom.filter(i => i.symbol !== item.symbol), item];
    personal.setPrefs({ watchlist: isNew ? [...existing, item.symbol] : existing, customSymbols: nextCustom, activeSymbol: item.symbol });
    setPicker(false); onMarketChange?.('我的自选');
    onToast?.(isNew ? '已加入自选：' + item.name : '正在查看：' + item.name);
  });
  const remove = (id: string) => act(() => {
    const remaining = watchIds.filter(symbol => symbol !== id);
    personal.setPrefs({ watchlist: remaining, ...(prefs.activeSymbol === id ? { activeSymbol: remaining.find(symbol => resolveInstrument(symbol, customSymbols)) } : {}) });
  });
  const toggle = () => selected ? remove(instrument.symbol) : add(instrument);
  const move = (id: string, direction: -1 | 1) => act(() => {
    const visibleIds = scopeWatchlist.map(row => row.id);
    const visibleIndex = visibleIds.indexOf(id), nextVisibleIndex = visibleIndex + direction;
    if (visibleIndex < 0 || nextVisibleIndex < 0 || nextVisibleIndex >= visibleIds.length) return;
    const target = watchIds.indexOf(id), adjacent = watchIds.indexOf(visibleIds[nextVisibleIndex]);
    if (target < 0 || adjacent < 0) return;
    const next = [...watchIds]; [next[target], next[adjacent]] = [next[adjacent], next[target]]; personal.setPrefs({ watchlist: next });
  });
  const expand = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (chartShell.current?.requestFullscreen) await chartShell.current.requestFullscreen();
      else onToast?.('当前浏览器不支持全屏，仍可在页面中继续查看。');
    } catch { onToast?.('未能进入全屏，仍可在当前页面查看。'); }
  };
  const chartConfig = useMemo(() => ({
    autosize: true, symbol: instrument.symbol, interval, timezone: 'Asia/Shanghai', theme,
    style: chartStyle === 'line' ? '2' : '1', locale: 'zh_CN', allow_symbol_change: false,
    calendar: false, details: true, hide_side_toolbar: false, hide_top_toolbar: false,
    hide_legend: false, hide_volume: false, save_image: false, withdateranges: true,
    studies: movingAverage ? ['MASimple@tv-basicstudies'] : [], support_host: 'https://www.tradingview.com',
  }), [instrument.symbol, interval, theme, chartStyle, movingAverage]);
  const technicalInterval = ({ '1': '1m', '5': '5m', '15': '15m', '60': '1h', D: '1D', W: '1W', M: '1M' } as Record<string, string>)[interval];
  const detailConfig: Record<string, unknown> = { symbol: instrument.symbol, colorTheme: theme, isTransparent: true, locale: 'zh_CN', width: '100%' };
  let detailWidget: WidgetName = 'symbol-info';
  if (activeDetail === 'technicals') { detailWidget = 'technical-analysis'; Object.assign(detailConfig, { interval: technicalInterval, displayMode: 'multiple', disableInterval: false, showIntervalTabs: true, height: 440 }); }
  if (activeDetail === 'fundamentals') { detailWidget = 'financials'; Object.assign(detailConfig, { displayMode: 'regular', height: 550 }); }
  if (activeDetail === 'profile') { detailWidget = 'symbol-profile'; Object.assign(detailConfig, { height: 370 }); }
  const detailLabels = { quote: '行情摘要', technicals: '技术指标', fundamentals: '财务数据', profile: '公司资料' };
  if (status === 'loading') return <div className="market-desk-loading"><RefreshCw className="spin" size={18} /><span>正在打开你的自选看盘台…</span></div>;
  return <section className="market-desk">
    <div className="market-desk-topline"><div className="market-desk-title"><span className={'market-live-indicator' + (aShareDailyOnly ? ' daily' : '')} /><strong>自选看盘台</strong><span>{aShareDailyOnly ? '日/周/月K线 · 非盘中实时' : '持续更新 · 股票报价可能延迟'}</span></div><button className="button primary" onClick={() => setPicker(true)}><Plus size={15} /> 添加标的</button></div>
    {error && <div className="market-desk-error" role="alert">{error}</div>}
    <div className="market-desk-layout">
      <div className="market-desk-main"><div className="market-desk-chart-shell" ref={chartShell}>
        <header className="market-active-instrument"><div><div className="market-active-heading"><h2>{instrument.name}</h2><span>{kindLabels[instrument.kind]}</span></div><p><strong>{instrument.symbol}</strong><span>{instrument.description || [instrument.market, instrument.exchange, instrument.currency].filter(Boolean).join(' · ')}</span></p></div><div className="market-active-actions"><button className={'market-star-button ' + (selected ? 'selected' : '')} aria-label={selected ? '将当前标的移出自选' : '将当前标的加入自选'} aria-pressed={selected} onClick={toggle}><Star size={17} /></button><button aria-label="刷新行情组件" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={16} /></button><button aria-label="全屏看盘" onClick={() => void expand()}><Maximize2 size={16} /></button></div></header>
        <div className="market-chart-controls">
          <div className="market-chart-intervals" role="group" aria-label="K线周期">{CHART_INTERVALS.map(value => <button key={value} disabled={aShareDailyOnly && !['D', 'W', 'M'].includes(value)} title={aShareDailyOnly && !['D', 'W', 'M'].includes(value) ? '当前免费来源的A股仅支持日、周、月K线' : undefined} aria-pressed={interval === value} className={interval === value ? 'selected' : ''} onClick={() => act(() => personal.setPrefs({ chartInterval: value }))}>{intervalLabels[value]}</button>)}</div>
          <div className="market-chart-options"><div role="group" aria-label="走势图类型"><button className={chartStyle === 'candles' ? 'selected' : ''} aria-pressed={chartStyle === 'candles'} onClick={() => act(() => personal.setPrefs({ chartStyle: 'candles' }))}><CandlestickChart size={14} />K线</button><button className={chartStyle === 'line' ? 'selected' : ''} aria-pressed={chartStyle === 'line'} onClick={() => act(() => personal.setPrefs({ chartStyle: 'line' }))}><LineChart size={14} />价格曲线</button></div><button className={'market-ma-toggle ' + (movingAverage ? 'selected' : '')} aria-pressed={movingAverage} onClick={() => setMovingAverage(v => !v)}><Layers3 size={13} />均线</button></div>
        </div>
        {aShareDailyOnly && <div className="market-ashare-notice"><CircleHelp size={14} /><span>当前免费来源的 A 股仅提供日、周、月 K 线，不支持盘中分钟图。报价可能是上一交易日收盘数据，请核对组件内的日期，不将它当作实时成交价。</span></div>}
        <SourceWidget widget="advanced-chart" config={chartConfig} label={instrument.name + ' K线与成交量图表'} instrument={instrument} refreshKey={attempt} className="market-main-chart" />
        <div className="market-chart-hint"><SlidersHorizontal size={13} /><span>在图表内可缩放、画线、对比标的，并添加 MACD、RSI 等指标。请通过本站自选或“添加标的”切换，主图与研究数据会一起更新。</span></div>
      </div></div>
      <aside className="market-watchlist">
        <div className="market-watchlist-heading"><h3><Star size={15} />我的自选 <span>{watchIds.length}</span></h3><button aria-label="添加自选标的" onClick={() => setPicker(true)}><Plus size={17} /></button></div>
        <p className="market-watchlist-caption">点击标的，同步主图与下方数据。</p>
        <div className="market-watchlist-rows" role="list" aria-label="我的自选标的">
          {scopeWatchlist.map(({ id, instrument: item }, visibleIndex) => <div role="listitem" className={'market-watch-row ' + (item?.symbol === instrument.symbol ? 'active' : '')} key={id}>
            <button className="market-watch-pick" disabled={!item} onClick={() => item && pick(item)}><span className="market-watch-symbol-dot" /><span><strong>{item?.name || '旧版标的'}</strong><small>{item?.symbol || id}</small></span></button>
            <div className="market-watch-row-actions"><button aria-label={'上移' + (item?.name || id)} disabled={visibleIndex === 0} onClick={() => move(id, -1)}><ArrowUp size={12} /></button><button aria-label={'下移' + (item?.name || id)} disabled={visibleIndex === scopeWatchlist.length - 1} onClick={() => move(id, 1)}><ArrowDown size={12} /></button><button aria-label={'移除自选：' + (item?.name || id)} onClick={() => remove(id)}><Trash2 size={12} /></button></div>
          </div>)}
          {!scopeWatchlist.length && <div className="market-watch-empty"><Star size={25} /><strong>{watchIds.length ? '这个市场还没有自选' : '把关心的行情放在一起'}</strong><p>支持 A 股、美股、指数、商品和完整交易所代码。</p><button className="button" onClick={() => setPicker(true)}><Plus size={14} /> 添加我的第一个标的</button></div>}
        </div>
        <div className="market-watchlist-discover"><h4>快速关注</h4><div>{scopeCatalog.filter(i => !watchIds.includes(i.symbol)).slice(0, 4).map(item => <button key={item.symbol} onClick={() => add(item)}><span>{item.name}</span><Plus size={13} /></button>)}</div></div>
        <div className="market-watchlist-bottom"><Check size={13} /><span>自选、周期与图形偏好保存在此浏览器。</span></div>
      </aside>
      <section className="market-data-panel">
        <div className="market-data-heading"><h3><BarChart3 size={17} />行情与研究</h3><span>{instrument.name} · {instrument.symbol}</span></div>
        <div className="market-detail-tabs" role="tablist" aria-label="行情数据视图">{([
          { id: 'quote' as const, label: '行情摘要', icon: Activity },
          { id: 'technicals' as const, label: '技术指标', icon: SlidersHorizontal },
          ...(isCompany ? [{ id: 'fundamentals' as const, label: '财务数据', icon: BarChart3 }, { id: 'profile' as const, label: '公司资料', icon: Building2 }] : []),
        ]).map(tab => <button key={tab.id} role="tab" id={'market-tab-' + tab.id} aria-controls="market-detail-panel" aria-selected={activeDetail === tab.id} className={activeDetail === tab.id ? 'selected' : ''} onClick={() => setDetail(tab.id)}><tab.icon size={14} />{tab.label}</button>)}</div>
        <div id="market-detail-panel" role="tabpanel" aria-labelledby={'market-tab-' + activeDetail} className={'market-detail-panel detail-' + activeDetail}><SourceWidget widget={detailWidget} config={detailConfig} label={instrument.name + detailLabels[activeDetail]} instrument={instrument} refreshKey={attempt} /></div>
        <p className="market-data-footnote">{activeDetail === 'quote' ? '现价、涨跌、市值等字段由来源组件提供；不同品种可提供的字段不同，缺失时不补造数字。' : activeDetail === 'technicals' ? '汇总来源的移动平均线、震荡指标等技术信号。它们是指标计算结果，不是交易指令。' : activeDetail === 'fundamentals' ? '按来源展示可用的估值、收入、盈利与财务历史，财务数据不是逐笔实时数据。' : '公司介绍、行业与所在市场来自来源资料。'}</p>
      </section>
    </div>
    <div className="market-desk-transparency"><CircleHelp size={16} /><div><strong>持续更新，时间保持透明。</strong><p>股票组件受交易所授权影响通常为延迟行情，以组件内的 D 标记、报价时间和市场状态为准；不承诺所有股票秒级实时。分钟周期是 K 线粒度，不能抵消行情延迟。A 股或个别标的不支持嵌入时，可直接前往原站。</p></div><a href={sourceLink(instrument)} target="_blank" rel="noopener noreferrer">打开完整看盘 <ArrowUpRight size={14} /></a></div>
    {picker && <SymbolPicker customSymbols={customSymbols} selected={watchIds} onChoose={add} onClose={() => setPicker(false)} />}
  </section>;
}

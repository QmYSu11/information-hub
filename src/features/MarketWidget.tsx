import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RefreshCw, TrendingUp } from 'lucide-react';
import { usePersonal } from '../lib/personal-store';
const symbols = [
  { id: 'sh000001', symbol: 'SSE:000001', name: '上证指数', market: 'A股', detail: '中国 · 上海证券交易所' },
  { id: 'sz399001', symbol: 'SZSE:399001', name: '深证成指', market: 'A股', detail: '中国 · 深圳证券交易所' },
  { id: 'us.INX', symbol: 'FOREXCOM:SPXUSD', name: '标普 500 参考', market: '美股', detail: '指数跟踪 CFD · 非指数现货成交价' },
  { id: 'us.IXIC', symbol: 'NASDAQ:IXIC', name: '纳斯达克综合', market: '美股', detail: '美国 · NASDAQ · 指数参考' },
  { id: 'usAAPL', symbol: 'NASDAQ:AAPL', name: '苹果', market: '美股', detail: '美国 · NASDAQ · USD' },
  { id: 'usMSFT', symbol: 'NASDAQ:MSFT', name: '微软', market: '美股', detail: '美国 · NASDAQ · USD' },
  { id: 'hf_XAU', symbol: 'OANDA:XAUUSD', name: '现货黄金参考', market: '大宗商品', detail: 'XAU/USD · 美元 / 金衡盎司 · 场外报价' },
  { id: 'wti', symbol: 'TVC:USOIL', name: 'WTI 原油参考', market: '大宗商品', detail: 'WTI 参考 · 美元 / 桶 · 非特定期货合约' },
];
export default function MarketWidget({ market }: { market: string }) {
  const { data } = usePersonal();
  const available = symbols.filter(s => market === '全部市场' || (market === '我的自选' ? data.preferences.watchlist.includes(s.id) : market === s.market));
  const [selected, setSelected] = useState(symbols[0].id);
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');
  const container = useRef<HTMLDivElement>(null);
  const symbol = available.find(s => s.id === selected) || available[0];
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme || 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!container.current || !symbol) return;
    const root = container.current;
    root.replaceChildren();
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%'; inner.style.width = '100%';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true, symbol: symbol.symbol, interval: 'D', timezone: 'Asia/Shanghai',
      theme: theme === 'light' ? 'light' : 'dark', style: '1', locale: 'zh_CN',
      allow_symbol_change: true, calendar: false, details: false, hide_side_toolbar: true,
      hide_top_toolbar: false, hide_legend: false, hide_volume: false,
      save_image: false, withdateranges: true, support_host: 'https://www.tradingview.com',
    });
    setWaiting(false); setFailed(false);
    script.onerror = () => setFailed(true);
    const timer = setTimeout(() => setWaiting(true), 12000);
    root.append(inner, script);
    return () => { clearTimeout(timer); script.onerror = null; root.replaceChildren(); };
  }, [symbol?.symbol, attempt, theme]);
  if (!symbol) return null;
  const sourceUrl = 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(symbol.symbol);
  return <section className="market-widget-section">
    <div className="section-heading"><h2><TrendingUp /> 来源行情图表</h2><a className="text-button" href={sourceUrl} target="_blank" rel="noopener noreferrer">在原站打开 <ArrowUpRight size={14} /></a></div>
    <div className="chart-symbols" role="group" aria-label="行情标的">{available.map(s => <button key={s.id} className={s.id === symbol.id ? 'selected' : ''} onClick={() => setSelected(s.id)}>{s.name}</button>)}</div>
    <div className="chart-caption"><strong>{symbol.name}</strong><span>{symbol.detail}</span></div>
    <div className="market-widget-frame tradingview-widget-container" ref={container} aria-label={symbol.name + ' TradingView 来源图表'} />
    <div className="chart-provider"><a href={sourceUrl} target="_blank" rel="noopener noreferrer">{symbol.name}图表</a><span>由 TradingView 提供</span><span>报价时间、延迟与可用范围以组件内显示为准</span></div>
    {(waiting || failed) && <div className="chart-fallback"><span>{failed ? '图表服务暂时无法连接。' : '如果图表尚未显示或当前标的不支持嵌入，可在原站继续查看。'}</span><button className="text-button" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={13} /> 重试</button><a className="text-button" href={sourceUrl} target="_blank" rel="noopener noreferrer">打开来源 <ArrowUpRight size={13} /></a></div>}
  </section>;
}

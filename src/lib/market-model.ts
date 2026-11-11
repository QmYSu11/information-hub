export type InstrumentMarket = 'A股' | '美股' | '大宗商品' | '其他';
export type InstrumentKind = 'stock' | 'index' | 'commodity' | 'forex' | 'crypto' | 'fund' | 'other';
export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  market: InstrumentMarket;
  kind: InstrumentKind;
  exchange: string;
  currency?: string;
  description?: string;
  aliases?: string[];
}
export const CHART_INTERVALS = ['1', '5', '15', '60', 'D', 'W', 'M'] as const;

function instrument(symbol: string, name: string, market: InstrumentMarket, kind: InstrumentKind, currency: string, aliases: string[] = [], description?: string): Instrument {
  return { id: symbol, symbol, name, market, kind, exchange: symbol.split(':')[0], currency, aliases, ...(description ? { description } : {}) };
}
/** This small local directory is a search aid, not a live exchange listing or a quote feed. */
export const INSTRUMENT_CATALOG: readonly Instrument[] = [
  instrument('SSE:000001', '上证指数', 'A股', 'index', 'CNY', ['上证', '上证综指', '上海综合', 'Shanghai Composite']),
  instrument('SZSE:399001', '深证成指', 'A股', 'index', 'CNY', ['深成指', '深圳成指', 'Shenzhen Component']),
  instrument('SZSE:399006', '创业板指', 'A股', 'index', 'CNY', ['创业板', 'ChiNext']),
  instrument('SSE:000300', '沪深300', 'A股', 'index', 'CNY', ['沪深 300', 'CSI300']),
  instrument('SSE:600519', '贵州茅台', 'A股', 'stock', 'CNY', ['茅台', 'Kweichow Moutai']),
  instrument('SZSE:000001', '平安银行', 'A股', 'stock', 'CNY', ['平安银', 'Ping An Bank']),
  instrument('SZSE:000858', '五粮液', 'A股', 'stock', 'CNY', ['Wuliangye']),
  instrument('SZSE:300750', '宁德时代', 'A股', 'stock', 'CNY', ['宁德', 'CATL']),
  instrument('SZSE:002594', '比亚迪', 'A股', 'stock', 'CNY', ['BYD']),
  instrument('SSE:601318', '中国平安', 'A股', 'stock', 'CNY', ['平安保险', 'Ping An Insurance']),
  instrument('SSE:600036', '招商银行', 'A股', 'stock', 'CNY', ['招行', 'China Merchants Bank']),
  instrument('SSE:688981', '中芯国际', 'A股', 'stock', 'CNY', ['中芯', 'SMIC']),
  instrument('SSE:600900', '长江电力', 'A股', 'stock', 'CNY', ['长电', 'China Yangtze Power']),
  instrument('SZSE:002475', '立讯精密', 'A股', 'stock', 'CNY', ['立讯', 'Luxshare']),
  instrument('NASDAQ:AAPL', '苹果', '美股', 'stock', 'USD', ['Apple', 'Apple Inc']),
  instrument('NASDAQ:MSFT', '微软', '美股', 'stock', 'USD', ['Microsoft']),
  instrument('NASDAQ:NVDA', '英伟达', '美股', 'stock', 'USD', ['NVIDIA', '英伟达公司']),
  instrument('NASDAQ:TSLA', '特斯拉', '美股', 'stock', 'USD', ['Tesla']),
  instrument('NASDAQ:GOOGL', '谷歌 A', '美股', 'stock', 'USD', ['Alphabet', 'Google', '谷歌', '字母表']),
  instrument('NASDAQ:AMZN', '亚马逊', '美股', 'stock', 'USD', ['Amazon']),
  instrument('NASDAQ:META', 'Meta', '美股', 'stock', 'USD', ['Facebook', '脸书']),
  instrument('NYSE:BABA', '阿里巴巴 ADR', '美股', 'stock', 'USD', ['Alibaba', '阿里巴巴', '阿里']),
  instrument('NASDAQ:PDD', '拼多多 ADR', '美股', 'stock', 'USD', ['PDD Holdings', '拼多多']),
  instrument('NYSE:NIO', '蔚来 ADR', '美股', 'stock', 'USD', ['NIO', '蔚来']),
  instrument('NYSE:BRK.B', '伯克希尔 B', '美股', 'stock', 'USD', ['Berkshire Hathaway', '伯克希尔', 'BRK.B']),
  instrument('NYSE:KO', '可口可乐', '美股', 'stock', 'USD', ['Coca-Cola', 'Coca Cola']),
  instrument('AMEX:SPY', 'SPDR 标普500 ETF', '美股', 'fund', 'USD', ['SPY', '标普ETF', 'SPDR S&P 500']),
  instrument('NASDAQ:QQQ', 'Invesco 纳斯达克100 ETF', '美股', 'fund', 'USD', ['QQQ', '纳指ETF', 'Invesco QQQ']),
  instrument('FOREXCOM:SPXUSD', '标普500参考', '美股', 'index', 'USD', ['标普', '标普500', '标普 500', 'S&P 500', 'SP500'], '指数跟踪 CFD，并非交易所指数现货成交价。'),
  instrument('NASDAQ:IXIC', '纳斯达克综合', '美股', 'index', 'USD', ['纳指', '纳斯达克', 'Nasdaq Composite']),
  instrument('NASDAQ:NDX', '纳斯达克100', '美股', 'index', 'USD', ['纳斯达克 100', 'Nasdaq 100']),
  instrument('OANDA:XAUUSD', '现货黄金参考', '大宗商品', 'commodity', 'USD', ['黄金', '伦敦金', 'XAUUSD', 'XAU/USD', 'Gold'], '场外 XAU/USD 参考报价，美元 / 金衡盎司，并非黄金期货合约。'),
  instrument('TVC:USOIL', 'WTI 原油参考', '大宗商品', 'commodity', 'USD', ['原油', 'WTI', '美原油', 'USOIL'], '来源的 WTI 参考代码，美元 / 桶，并非指定月份期货合约。'),
  instrument('COMEX:GC1!', '黄金连续期货', '大宗商品', 'commodity', 'USD', ['GC1!', 'COMEX黄金'], '连续期货合约图表，不是某个固定月份的可交割合约。'),
  instrument('COMEX:SI1!', '白银连续期货', '大宗商品', 'commodity', 'USD', ['SI1!', '白银', 'Silver'], '连续期货合约图表，报价单位与合约规则以来源为准。'),
  instrument('NYMEX:CL1!', 'WTI 连续期货', '大宗商品', 'commodity', 'USD', ['CL1!', 'WTI期货'], '连续期货合约图表，不是某个固定月份的可交割合约。'),
  instrument('COMEX:HG1!', '铜连续期货', '大宗商品', 'commodity', 'USD', ['HG1!', '铜', 'Copper'], '连续期货合约图表，报价单位与合约规则以来源为准。'),
  instrument('OANDA:EURUSD', '欧元 / 美元', '其他', 'forex', 'USD', ['欧元美元', 'EURUSD', 'EUR/USD'], '场外外汇报价，实际点差与时效以来源为准。'),
  instrument('FX:USDJPY', '美元 / 日元', '其他', 'forex', 'JPY', ['美元日元', 'USDJPY', 'USD/JPY']),
  instrument('BINANCE:BTCUSDT', '比特币 / USDT', '其他', 'crypto', 'USDT', ['比特币', 'BTC', 'BTCUSDT', 'Bitcoin']),
];

const legacySymbols: Readonly<Record<string, string>> = {
  SH000001: 'SSE:000001',
  SZ399001: 'SZSE:399001',
  'US.INX': 'FOREXCOM:SPXUSD',
  'US.IXIC': 'NASDAQ:IXIC',
  USAAPL: 'NASDAQ:AAPL',
  USMSFT: 'NASDAQ:MSFT',
  HF_XAU: 'OANDA:XAUUSD',
  SP500: 'FOREXCOM:SPXUSD',
  NASDAQ: 'NASDAQ:IXIC',
  GOLD: 'OANDA:XAUUSD',
  WTI: 'TVC:USOIL',
};
const forbiddenExchanges = new Set(['JAVASCRIPT', 'VBSCRIPT', 'DATA', 'FILE', 'HTTP', 'HTTPS', 'BLOB', 'FTP']);
const key = (value: string) => value.trim().toLocaleUpperCase().replace(/\s+/g, ' ');
function canonicalCode(input: string): string | null {
  const value = input.trim().toUpperCase().replace(/\s*:\s*/, ':');
  if (value.length > 64 || !/^[A-Z0-9_]{2,20}:[A-Z0-9][A-Z0-9._/!-]{0,39}$/.test(value)) return null;
  const [exchange, code] = value.split(':');
  if (forbiddenExchanges.has(exchange) || (['SSE', 'SZSE'].includes(exchange) && !/^\d{6}$/.test(code))) return null;
  return value;
}
function chineseExplicit(input: string): string | null {
  const value = input.trim().toUpperCase();
  const prefix = /^(SH|SZ)(\d{6})$/.exec(value);
  const suffix = /^(\d{6})\.(SH|SS|SZ)$/.exec(value);
  if (prefix) return ({ SH: 'SSE:', SZ: 'SZSE:' } as const)[prefix[1] as 'SH' | 'SZ'] + prefix[2];
  if (suffix) return ({ SH: 'SSE:', SS: 'SSE:', SZ: 'SZSE:' } as const)[suffix[2] as 'SH' | 'SS' | 'SZ'] + suffix[1];
  return null;
}
function matchesExact(item: Instrument, input: string) {
  const query = key(input);
  return [item.name, item.symbol, item.symbol.split(':')[1], ...(item.aliases || [])].some(x => key(x) === query);
}

/** Format normalization cannot prove that an instrument exists or is supported by the provider. */
export function normalizeSymbol(input: string): string | null {
  if (typeof input !== 'string' || !input.trim() || input.length > 120) return null;
  const explicit = canonicalCode(input) || chineseExplicit(input);
  if (explicit) return explicit;
  const legacy = legacySymbols[key(input)];
  if (legacy) return legacy;
  const matches = INSTRUMENT_CATALOG.filter(item => matchesExact(item, input));
  const symbols = [...new Set(matches.map(item => item.symbol))];
  // 000001 is both Shanghai's index and a Shenzhen stock: do not choose an exchange for the user.
  return symbols.length === 1 ? symbols[0] : null;
}

function infer(symbol: string): Pick<Instrument, 'market' | 'kind' | 'currency'> {
  const [exchange, code] = symbol.split(':');
  if (['SSE', 'SZSE'].includes(exchange)) return { market: 'A股', kind: 'stock', currency: 'CNY' };
  if (['NASDAQ', 'NYSE', 'AMEX', 'NYSEARCA', 'NYSEAMERICAN', 'OTC'].includes(exchange)) return { market: '美股', kind: 'stock', currency: 'USD' };
  if (exchange === 'HKEX') return { market: '其他', kind: 'stock', currency: 'HKD' };
  // TradingView's BSE namespace belongs to Bombay, not the Beijing Stock Exchange.
  if (['BSE', 'NSE'].includes(exchange)) return { market: '其他', kind: 'stock', currency: 'INR' };
  if (['COMEX', 'NYMEX', 'SHFE', 'DCE', 'CZCE', 'INE'].includes(exchange)) return { market: '大宗商品', kind: 'commodity' };
  if (['BINANCE', 'COINBASE', 'KRAKEN', 'BITSTAMP', 'OKX'].includes(exchange)) return { market: '其他', kind: 'crypto' };
  if (['FX', 'FX_IDC', 'OANDA', 'FOREXCOM'].includes(exchange) && /^[A-Z]{6}$/.test(code)) return { market: '其他', kind: 'forex' };
  return { market: '其他', kind: 'other' };
}
function knownInstruments(customSymbols: readonly Instrument[]) {
  const map = new Map(INSTRUMENT_CATALOG.map(item => [item.symbol, item]));
  for (const item of customSymbols) {
    const symbol = canonicalCode(item.symbol);
    if (symbol) map.set(symbol, { ...item, id: symbol, symbol });
  }
  return [...map.values()];
}
export function resolveInstrument(input: string, customSymbols: readonly Instrument[] = []): Instrument | null {
  if (typeof input !== 'string' || !input.trim() || input.length > 120) return null;
  const all = knownInstruments(customSymbols);
  const direct = canonicalCode(input) || chineseExplicit(input) || legacySymbols[key(input)];
  const exact = all.filter(item => matchesExact(item, input));
  const symbol = direct || (new Set(exact.map(item => item.symbol)).size === 1 ? exact[0]?.symbol : null);
  if (!symbol) return null;
  const known = all.find(item => item.symbol === symbol);
  if (known) return { ...known, ...(known.aliases ? { aliases: [...known.aliases] } : {}) };
  return { id: symbol, symbol, name: symbol, exchange: symbol.split(':')[0], ...infer(symbol),
    description: '自定义代码，尚未核实存在性；数据与嵌入支持情况以行情来源为准。' };
}
export function searchInstruments(query: string, customSymbols: readonly Instrument[] = []): Instrument[] {
  const search = key(query);
  const all = knownInstruments(customSymbols);
  if (!search) return all;
  const score = (item: Instrument) => {
    const values = [item.name, item.symbol, item.symbol.split(':')[1], ...(item.aliases || [])].map(key);
    if (values.includes(search)) return 3;
    if (values.some(value => value.startsWith(search))) return 2;
    return values.some(value => value.includes(search)) ? 1 : 0;
  };
  return all.map((item, index) => ({ item, index, score: score(item) })).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index).map(x => x.item);
}
/** Unknown old IDs are deliberately retained, so a newer adapter can recover them later. */
export function migrateWatchlist(ids: readonly string[]): string[] {
  return [...new Set(ids.map(id => normalizeSymbol(id) || id))];
}
export function parseInstrument(value: unknown): Instrument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('自选标的格式无效');
  const x = value as Record<string, unknown>;
  const symbol = typeof x.symbol === 'string' ? canonicalCode(x.symbol) : null;
  const id = typeof x.id === 'string' ? canonicalCode(x.id) : null;
  if (!symbol || id !== symbol || typeof x.exchange !== 'string' || x.exchange.toUpperCase() !== symbol.split(':')[0]) throw new Error('自选标的代码或交易所无效');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 120 || /[\u0000-\u001f\u007f]/.test(x.name)) throw new Error('自选标的名称无效');
  const markets = ['A股', '美股', '大宗商品', '其他'];
  const kinds = ['stock', 'index', 'commodity', 'forex', 'crypto', 'fund', 'other'];
  if (!markets.includes(String(x.market)) || !kinds.includes(String(x.kind))) throw new Error('自选标的市场或类型无效');
  if (x.currency !== undefined && (typeof x.currency !== 'string' || !/^[A-Z]{2,12}$/.test(x.currency))) throw new Error('自选标的币种无效');
  if (x.description !== undefined && (typeof x.description !== 'string' || x.description.length > 1000 || /[\u0000\u000b\u000c\u007f]/.test(x.description))) throw new Error('自选标的说明无效');
  if (x.aliases !== undefined && (!Array.isArray(x.aliases) || x.aliases.length > 30 || !x.aliases.every(a => typeof a === 'string' && a.length <= 100 && !/[\u0000-\u001f\u007f]/.test(a)))) throw new Error('自选标的别名无效');
  return { id: symbol, symbol, name: x.name.trim(), market: x.market as InstrumentMarket, kind: x.kind as InstrumentKind,
    exchange: symbol.split(':')[0], ...(x.currency !== undefined ? { currency: x.currency as string } : {}),
    ...(x.description !== undefined ? { description: x.description as string } : {}),
    ...(x.aliases !== undefined ? { aliases: [...new Set((x.aliases as string[]).map(a => a.trim()).filter(Boolean))] } : {}) };
}
export function mergeInstruments(current: readonly Instrument[], incoming: readonly Instrument[]): Instrument[] {
  const result = new Map(current.map(item => [item.symbol, parseInstrument(item)]));
  for (const item of incoming) { const parsed = parseInstrument(item); result.set(parsed.symbol, parsed); }
  return [...result.values()];
}

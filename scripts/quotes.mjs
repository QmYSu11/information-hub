const targets = [
  { id: 'sh000001', symbol: '000001.SH', name: '上证指数', market: 'A股', currency: 'CNY', unit: '点' },
  { id: 'sz399001', symbol: '399001.SZ', name: '深证成指', market: 'A股', currency: 'CNY', unit: '点' },
  { id: 'us.INX', symbol: '.INX', name: '标普 500', market: '美股', currency: 'USD', unit: '点' },
  { id: 'us.IXIC', symbol: '.IXIC', name: '纳斯达克综合', market: '美股', currency: 'USD', unit: '点' },
  { id: 'usAAPL', symbol: 'AAPL', name: '苹果', market: '美股', currency: 'USD', unit: '美元/股' },
  { id: 'usMSFT', symbol: 'MSFT', name: '微软', market: '美股', currency: 'USD', unit: '美元/股' },
  { id: 'hf_XAU', symbol: 'XAU/USD', name: '伦敦金 · 现货', market: '大宗商品', currency: 'USD', unit: '美元/盎司' },
];

export function emptyQuotes(now) {
  return targets.map(target => ({
    ...target, value: null, fetchedAt: now, source: '来源组件',
    url: 'https://gu.qq.com/' + target.id,
    delayLabel: '在来源组件中查看；本站未保存报价',
  }));
}

function makeSource(market, now, status, message, lastSuccessAt = null) {
  return { id: 'market-' + ({ 'A股': 'cn', '美股': 'us', '大宗商品': 'commodities' })[market], label: market + ' · 行情', category: 'markets', homepage: 'https://finance.qq.com/', status, message, lastSuccessAt, lastAttemptAt: now };
}

// Public reachability is not a redistribution license. Enable only after checking usage rights.
export async function collectOptionalQuotes({ now, previous, fetchPublic }) {
  const markets = ['A股', '美股', '大宗商品'];
  if (process.env.ENABLE_TENCENT_QUOTES !== 'true') {
    return {
      sources: markets.map(market => makeSource(market, now, 'external', '报价在来源组件中查看；默认不采集未经核实展示许可的行情')),
      quotes: emptyQuotes(now),
    };
  }
  try {
    const raw = await fetchPublic('https://qt.gtimg.cn/q=' + targets.map(t => t.id).join(','), { encoding: 'gbk' });
    const quotes = parseTencent(raw, now);
    if (!quotes.some(q => q.value !== null)) throw new Error('报价源无有效数据');
    return { sources: markets.map(market => makeSource(market, now, quotes.some(q => q.market === market && q.value !== null) ? 'ok' : 'unavailable', '腾讯财经 · 延迟未知；仅作信息查看', quotes.some(q => q.market === market && q.value !== null) ? now : null)), quotes };
  } catch {
    const old = (previous.quotes || []).filter(q => q.source === '腾讯财经');
    return {
      sources: markets.map(market => makeSource(market, now, old.some(q => q.market === market) ? 'cached' : 'unavailable', '报价获取失败，保留最近可用时间', previous.sources?.find(s => s.id === makeSource(market).id)?.lastSuccessAt || null)),
      quotes: old.length ? old : emptyQuotes(now),
    };
  }
}

export function zonedTimeToISO(value, timeZone) {
  const digits = value.match(/\d+/g)?.map(Number);
  if (!digits) return undefined;
  const parts = digits.length === 1 && value.length === 14
    ? [Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8)), Number(value.slice(8, 10)), Number(value.slice(10, 12)), Number(value.slice(12, 14))]
    : digits;
  if (parts.length !== 6) return undefined;
  const desired = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  if (!Number.isFinite(desired)) return undefined;
  let guess = desired;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const map = Object.fromEntries(formatter.formatToParts(guess).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const represented = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
    const next = guess + desired - represented;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
}

export function parseTencent(raw, now) {
  return targets.map(target => {
    const match = raw.match(new RegExp('v_' + target.id.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '="([^"]*)"'));
    const fallback = { ...target, value: null, fetchedAt: now, source: '腾讯财经', url: 'https://gu.qq.com/' + target.id, delayLabel: '暂无报价；延迟情况未知' };
    if (!match) return fallback;
    const parts = match[1].split(target.id.startsWith('hf_') ? ',' : '~');
    const value = Number(parts[target.id.startsWith('hf_') ? 0 : 3]);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    const change = Number(parts[target.id.startsWith('hf_') ? 1 : 32]);
    const asOf = target.id.startsWith('hf_') ? undefined : zonedTimeToISO(parts[30] || '', target.market === 'A股' ? 'Asia/Shanghai' : 'America/New_York');
    return { ...fallback, value, ...(Number.isFinite(change) ? { changePercent: change } : {}), ...(asOf ? { asOf } : {}), delayLabel: target.id.startsWith('hf_') ? '现货参考价；报价时间与延迟情况未核实' : '延迟情况未知；展示源报价时间' };
  });
}

import type { ContentItem } from '../types';

export type HotwordScope = 'all' | 'fun' | 'tech' | 'finance';
export const HOTWORD_SCOPES: { id: HotwordScope; label: string; description: string }[] = [
  { id: 'all', label: '全部视野', description: '当前已载入的所有新闻、榜单与推荐帖' },
  { id: 'fun', label: '生活趣味', description: '社区热榜、视频和推荐帖，不按情绪或立场判断内容' },
  { id: 'tech', label: '科技数码', description: '科技频道，以及标题明确提到科技、数码、游戏的内容' },
  { id: 'finance', label: '股票财经', description: '财经频道，以及标题明确提到证券、公司财报或商品的内容' },
];

// Function words and headline boilerplate add little topical meaning. The list is local and explicit.
const stopwords = new Set(`一个 一种 一些 一次 一场 一项 一名 一位 一份 一段 一起 一切 一直 一定 一样 一点 这个 这次 这些 这样 这里 这份 那个 那些 那么 怎么 怎么样 什么 为什么 如何 是否 不是 没有 不能 不会 可以 可能 已经 正在 还是 也是 就是 但是 因为 所以 而且 如果 以及 其中 对于 关于 通过 成为 来自 进行 继续 进一步 推动 加快 打造 举行 举办 出席 会见 访问 发布 印发 介绍 回应 表示 认为 以为 指出 强调 透露 记者 报道 消息 现场 今日 今天 昨日 昨天 明天 今年 去年 明年 近日 日前 最近 目前 此前 当地 时间 小时 分钟 之后 之前 以来 以来 再次 首次 首个 最新 最新消息 新闻 热搜 热榜 排行 排行榜 综合 话题 关注 推荐 视频 播放 完整 完整版 合集 第一 第二 第三 第四 第五 最新进展 评论 网友 网民 大家 我们 你们 他们 你 我 他 她 它 你们的 我们的 他的 她的 自己 真的 确实 原来 终于 竟然 还是 还有 又是 一下 一下子 多少 多个 多名 多项 各类 各地 各个 有关 相关 部分 全部 更多 其他 新的 当前 重要 主要 正式 全面 持续 成功 有望 超过 达到 实现 取得 提升 加强 深入 全新 助力 聚焦 解读 速看 看看 看点 一图 全文 总共 记者会 发布会 中新网 中新社 新华社 人民日报 央视新闻 人民网 财联社 亿 万 元 人 年 月 日 条 个 次 期 集 季`.split(/\s+/));
const englishStopwords = new Set('the a an and or of in on at to for from with by is are was were be been being it its this that these those you your we our they their he she his her as not but if into out over about why how what when where who which can could will would should has have had new says said news live video watch full official ft featuring vs via www com net'.split(' '));
for (const word of ['看待', '哪些', '情况', '人的']) stopwords.add(word);

// Preserve common compounds which browser word breaking may split. A phrase must appear literally in the title.
const fallbackPhrases = ['人工智能', '大模型', '机器人', '半导体', '英伟达', '比特币', '新能源汽车', '电动车', '自动驾驶', '游戏', '动画', '电影', '音乐', '美食', '旅行', '咖啡', '宠物', '猫咪', '摄影', '大学生', '双十一', '世界杯', '总决赛', '英雄联盟', '星穹铁道', '全民制作人', '流量王', '阴阳师', '明日方舟', '二次元', '小红书', '财报', '芯片', '手机', '苹果', '华为', '小米', '特斯拉', '腾讯', '阿里巴巴', '微软', '亚马逊', '黄金', '白银', '原油', '美股', '股市', '股票', '基金', '利率', '降息', '通胀', '就业', '新能源', '航天', '卫星', '量子', '医疗', '气候', '能源', '教育'];
const techTerms = /人工智能|大模型|\bAI\b|芯片|半导体|数码|手机|电脑|处理器|机器人|自动驾驶|科技|算法|编程|操作系统|显卡|游戏|主机|航天|卫星|量子|软件|硬件|iPhone|NVIDIA|OpenAI|Gemini|DeepSeek/i;
fallbackPhrases.push('比亚迪');
const financeTerms = /股市|股票|A股|美股|港股|证券|财报|营收|净利润|市值|上市公司|基金|债券|黄金|白银|原油|期货|利率|降息|通胀|央行|NASDAQ|NYSE|S&P|\$[A-Za-z]{1,5}\b/i;

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;
function cleanTitle(value: string) {
  return value.normalize('NFKC').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, ' ').replace(/&(?:[a-z]+|#\d+);/gi, ' ').trim();
}
function titleKey(value: string) {
  return cleanTitle(value).toLocaleLowerCase('zh-CN').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function acceptedTerm(value: string) {
  if (!value || stopwords.has(value) || englishStopwords.has(value.toLowerCase())) return false;
  const length = [...value].length;
  if (length < 2 || length > 24 || /^\d/.test(value) || !/^[\p{L}\p{N}][\p{L}\p{N}._+-]*$/u.test(value)) return false;
  if (/^\p{Script=Han}+$/u.test(value)) return length <= 8 && !/^[一二三四五六七八九十百千万亿零〇两]+$/.test(value);
  return /[A-Za-z]{2}/.test(value);
}
export function extractTitleTerms(title: string, mode: 'auto' | 'basic' = 'auto'): Map<string, string> {
  const text = cleanTitle(title);
  const tokens: string[] = [];
  const matchedPhrases = fallbackPhrases.filter(phrase => text.includes(phrase)).filter(phrase => !fallbackPhrases.some(longer => longer.length > phrase.length && longer.includes(phrase) && text.includes(longer)));
  if (mode === 'auto' && segmenter) {
    for (const item of segmenter.segment(text)) if (item.isWordLike) tokens.push(item.segment);
  } else {
    tokens.push(...(text.match(/[A-Za-z][A-Za-z0-9._+-]{1,23}/g) || []));
    for (const chunk of text.match(/\p{Script=Han}+/gu) || []) {
      if (chunk.length >= 2 && chunk.length <= 8 && !matchedPhrases.some(phrase => chunk.includes(phrase) || phrase.includes(chunk))) tokens.push(chunk);
    }
  }
  tokens.push(...matchedPhrases);
  const result = new Map<string, string>();
  for (const raw of tokens) {
    const label = raw.normalize('NFKC').replace(/^[._+-]+|[._+-]+$/g, '');
    if (matchedPhrases.some(phrase => phrase !== label && phrase.includes(label))) continue;
    if (!acceptedTerm(label)) continue;
    const key = label.toLocaleLowerCase('zh-CN');
    const display = /^[a-z]{2,5}$/i.test(label) ? label.toUpperCase() : label;
    if (!result.has(key)) result.set(key, display);
  }
  return result;
}

export interface HotwordTerm {
  key: string;
  label: string;
  count: number;
  share: number;
  sourceCount: number;
  itemIds: string[];
}
export interface HotwordResult {
  terms: HotwordTerm[];
  corpus: ContentItem[];
  inputCount: number;
  duplicateCount: number;
  sourceCount: number;
  latestFetchedAt?: string;
  mode: 'intl' | 'basic';
}
export function matchesHotwordScope(item: ContentItem, scope: HotwordScope) {
  if (scope === 'fun') return item.kind === 'topic' || item.kind === 'video' || item.kind === 'post';
  if (scope === 'tech') return item.channel === '科技' || techTerms.test(item.title);
  if (scope === 'finance') return item.channel === '财经' || financeTerms.test(item.title);
  return true;
}
export function buildHotwords(items: readonly ContentItem[], options: { scope?: HotwordScope; minFrequency?: number; limit?: number; segmentation?: 'auto' | 'basic' } = {}): HotwordResult {
  const scope = options.scope || 'all';
  const minFrequency = Math.max(1, Math.floor(options.minFrequency ?? 2));
  const limit = Math.max(1, Math.min(150, Math.floor(options.limit ?? 60)));
  const groups = new Map<string, { item: ContentItem; sourceIds: Set<string> }>();
  const ids = new Set<string>();
  let inputCount = 0;
  for (const item of items) {
    if (!item || typeof item.title !== 'string' || !item.id || !item.sourceId || !matchesHotwordScope(item, scope)) continue;
    const normalized = titleKey(item.title);
    if (!normalized || ids.has(item.id)) continue;
    ids.add(item.id); inputCount++;
    const group = groups.get(normalized);
    if (group) {
      group.sourceIds.add(item.sourceId);
      if (Date.parse(item.fetchedAt) > Date.parse(group.item.fetchedAt)) group.item = item;
    } else groups.set(normalized, { item, sourceIds: new Set([item.sourceId]) });
  }
  const documents = [...groups.values()];
  const counts = new Map<string, { label: string; itemIds: string[]; sources: Set<string> }>();
  const sources = new Set<string>();
  let latestTime = -Infinity;
  let latestFetchedAt: string | undefined;
  for (const { item, sourceIds } of documents) {
    sourceIds.forEach(id => sources.add(id));
    const time = Date.parse(item.fetchedAt);
    if (Number.isFinite(time) && time > latestTime) { latestTime = time; latestFetchedAt = item.fetchedAt; }
    for (const [key, label] of extractTitleTerms(item.title, options.segmentation)) {
      let count = counts.get(key);
      if (!count) { count = { label, itemIds: [], sources: new Set() }; counts.set(key, count); }
      count.itemIds.push(item.id);
      sourceIds.forEach(id => count.sources.add(id));
    }
  }
  const corpus = documents.map(x => x.item);
  const terms = [...counts.entries()].filter(([, value]) => value.itemIds.length >= minFrequency).map(([key, value]) => ({
    key, label: value.label, count: value.itemIds.length, share: corpus.length ? value.itemIds.length / corpus.length : 0,
    sourceCount: value.sources.size, itemIds: value.itemIds,
  })).sort((a, b) => b.count - a.count || b.sourceCount - a.sourceCount || a.key.localeCompare(b.key, 'zh-CN')).slice(0, limit);
  return { terms, corpus, inputCount, duplicateCount: inputCount - corpus.length, sourceCount: sources.size, latestFetchedAt,
    mode: options.segmentation !== 'basic' && segmenter ? 'intl' : 'basic' };
}

export interface PositionedHotword extends HotwordTerm { x: number; y: number; width: number; height: number; fontSize: number; color: number }
function hash(value: string) { let h = 0; for (const c of value) h = (Math.imul(h, 31) + c.codePointAt(0)!) >>> 0; return h; }
/** A deterministic collision-checked layout. Positions have no statistical meaning; text size encodes count. */
export function layoutHotwords(terms: readonly HotwordTerm[], width: number, height: number): PositionedHotword[] {
  if (width < 120 || height < 120) return [];
  const max = terms[0]?.count || 1;
  const min = terms.at(-1)?.count || 1;
  const narrow = width < 480;
  const minFont = narrow ? 12 : 14, maxFont = narrow ? 32 : 47;
  const result: PositionedHotword[] = [];
  for (const term of terms.slice(0, 60)) {
    let fontSize = Math.round(min === max ? (narrow ? 20 : 25) : minFont + (maxFont - minFont) * Math.sqrt((term.count - min) / (max - min)));
    const units = [...term.label].reduce((sum, c) => sum + (/\p{Script=Han}/u.test(c) ? 1 : 0.62), 0);
    const estimated = () => Math.ceil(units * fontSize + String(term.count).length * 7 + 20);
    while (estimated() > width - 26 && fontSize > minFont) fontSize--;
    const wordWidth = estimated(), wordHeight = Math.max(30, Math.ceil(fontSize * 1.25 + 10));
    if (wordWidth > width - 16) continue;
    for (let attempt = 0; attempt < 1500; attempt++) {
      const angle = attempt * 0.43;
      const radius = Math.sqrt(attempt) * 4;
      const cx = width / 2 + Math.cos(angle) * radius * (width / height);
      const cy = height / 2 + Math.sin(angle) * radius;
      const x = Math.round(cx - wordWidth / 2), y = Math.round(cy - wordHeight / 2);
      if (x < 8 || y < 12 || x + wordWidth > width - 8 || y + wordHeight > height - 12) continue;
      if (result.some(other => x < other.x + other.width + 4 && x + wordWidth + 4 > other.x && y < other.y + other.height + 3 && y + wordHeight + 3 > other.y)) continue;
      result.push({ ...term, x, y, width: wordWidth, height: wordHeight, fontSize, color: hash(term.key) % 5 });
      break;
    }
  }
  return result;
}

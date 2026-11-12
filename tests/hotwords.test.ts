import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ContentItem } from '../src/types';
import { buildHotwords, extractTitleTerms, layoutHotwords, matchesHotwordScope } from '../src/lib/hotwords';

const time = '2026-11-12T03:00:00.000Z';
function item(id: string, title: string, extra: Partial<ContentItem> = {}): ContentItem {
  return { id, title, sourceId: 'test-source', url: 'https://example.test/' + id, channel: '趣事', kind: 'topic', fetchedAt: time, ...extra };
}

test('a term counts once per distinct title and never sums platform views or hotness', () => {
  const items = [item('a', 'AI AI ai，芯片开始量产', { heat: '999999万 播放' }), item('b', 'AI 帮助制作动画', { heat: '1 热度' })];
  const result = buildHotwords(items);
  assert.equal(result.corpus.length, 2);
  const ai = result.terms.find(word => word.key === 'ai');
  assert.equal(ai?.count, 2);
  assert.equal(ai?.label, 'AI');
  assert.equal(ai?.share, 1);
  assert.deepEqual(ai?.itemIds, ['a', 'b']);
  assert.deepEqual(buildHotwords(items.map(value => ({ ...value, heat: '0' }))).terms, result.terms);
});

test('reposted identical titles are merged while original source coverage and the latest representative survive', () => {
  const result = buildHotwords([
    item('old', 'AI 帮助制作动画', { sourceId: 'one', fetchedAt: '2026-11-12T01:00:00Z' }),
    item('new', 'ＡＩ 帮助制作动画！', { sourceId: 'two' }),
    item('different', 'AI 研究带来新的工具', { sourceId: 'one' }),
    item('different', 'A duplicated ID must never increase the corpus', { sourceId: 'one' }),
  ]);
  assert.equal(result.inputCount, 3);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.corpus.length, 2);
  assert.equal(result.sourceCount, 2);
  assert.ok(result.corpus.some(value => value.id === 'new'));
  assert.ok(!result.corpus.some(value => value.id === 'old'));
  const ai = result.terms.find(word => word.key === 'ai');
  assert.equal(ai?.count, 2);
  assert.equal(ai?.sourceCount, 2);
  assert.equal(result.latestFetchedAt, time);
});

test('generic headline boilerplate, numbers, unsafe markup and duplicate case variants do not become topical words', () => {
  const words = extractTitleTerms('今日发布：2026 AI ai ＡＩ，最新消息，人工智能与芯片 <script>executeThis()</script> https://bad.test/path');
  assert.equal(words.get('ai'), 'AI');
  assert.ok(words.has('人工智能'));
  assert.ok(words.has('芯片'));
  for (const term of ['今日', '发布', '2026', '最新消息', '今日发布', 'executethis', 'https', 'bad.test']) assert.equal(words.has(term), false, term);
  const company = extractTitleTerms('如何看待比亚迪销量的新情况，哪些变化值得注意？');
  assert.ok(company.has('比亚迪'));
  for (const term of ['比亚', '看待', '哪些', '情况']) assert.equal(company.has(term), false, term);
});

test('scope filters distinguish community formats and transparent technology/finance headline matches', () => {
  assert.equal(matchesHotwordScope(item('post', '今天的猫咪也太可爱了', { kind: 'post' }), 'fun'), true);
  assert.equal(matchesHotwordScope(item('rss', '社会新闻', { kind: 'article', channel: '趣事' }), 'fun'), false);
  assert.equal(matchesHotwordScope(item('video', '机器人参加总决赛', { kind: 'video' }), 'tech'), true);
  assert.equal(matchesHotwordScope(item('tech', '一段没有科技关键词的标题', { channel: '科技' }), 'tech'), true);
  assert.equal(matchesHotwordScope(item('stock', '英伟达财报和美股走势'), 'finance'), true);
  assert.equal(matchesHotwordScope(item('cat', '猫咪的一天'), 'finance'), false);
});

test('basic fallback only matches words present in titles and identifies its reduced coverage', () => {
  const result = buildHotwords([item('a', '人工智能帮助摄影'), item('b', '机器人也在学习人工智能')], { segmentation: 'basic' });
  assert.equal(result.mode, 'basic');
  assert.equal(result.terms.find(word => word.key === '人工智能')?.count, 2);
  assert.equal(result.terms.some(word => word.key === '黄金'), false);
  assert.equal(buildHotwords([item('a', '人工智能帮助摄影')], { minFrequency: 2 }).terms.length, 0);
  assert.ok(buildHotwords([item('a', '人工智能帮助摄影')], { minFrequency: 1 }).terms.length > 0);
});

test('empty and non-word titles never produce invented terms, dates or a fake word-cloud', () => {
  const result = buildHotwords([item('a', '…… 2026 12345'), item('b', '<style>body{color:red}</style>')]);
  assert.equal(result.terms.length, 0);
  assert.equal(result.corpus.length, 1);
  assert.equal(buildHotwords([]).latestFetchedAt, undefined);
  assert.deepEqual(layoutHotwords([], 600, 400), []);
});

test('cloud layout is deterministic, non-overlapping and bounded at phone and desktop widths', () => {
  const terms = Array.from({ length: 32 }, (_, index) => ({ key: 'term' + index, label: ['人工智能', '总决赛', '猫咪', '芯片', '摄影', '动画', '旅行', 'OPENAI'][index % 8] + index, count: 34 - index, share: (34 - index) / 100, sourceCount: 2, itemIds: ['a'] }));
  for (const [width, height] of [[320, 360], [760, 400]]) {
    const result = layoutHotwords(terms, width, height);
    assert.deepEqual(result, layoutHotwords(terms, width, height));
    assert.ok(result.length >= 8);
    for (const word of result) {
      assert.ok(word.x >= 0 && word.y >= 0 && word.x + word.width <= width && word.y + word.height <= height);
      assert.ok(word.fontSize >= 12);
      for (const other of result) {
        if (word.key === other.key) continue;
        assert.equal(word.x < other.x + other.width && word.x + word.width > other.x && word.y < other.y + other.height && word.y + word.height > other.y, false);
      }
    }
    assert.ok(result[0].fontSize >= result.at(-1)!.fontSize);
  }
});

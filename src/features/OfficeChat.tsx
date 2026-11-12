import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ArrowUpRight, ChevronDown, Clock3, FileText, History, LoaderCircle, MessageCircle, Paperclip, Play, Plus, RefreshCw, Send, Sparkles, TrendingUp } from 'lucide-react';
import type { ContentItem, Source } from '../types';
import { fullTime, safeUrl } from '../lib/feed';
import { OFFICE_ROSTER } from '../lib/office-client';
import type { OfficeProviderId, OfficeStatus } from '../lib/office-client';
import { chooseChatMaterials, createChatSendInput, getChatConversation, getChatConversations, OfficeChatError, referencesForChatMessage, sendChatMessage, validConversationId } from '../lib/office-chat-client';
import type { ChatConversation, ChatConversationSummary, ChatIntent, ChatMessage, ChatSendInput } from '../lib/office-chat-client';
import './office-chat.css';

type Props = { status: OfficeStatus | null; items: ContentItem[]; sources: Source[]; watchSymbols: string[]; onOpen?: (item: ContentItem) => void; onStatusRefresh?: () => Promise<void> | void; onRefreshMaterials?: () => Promise<void>; refreshingMaterials?: boolean; materialError?: string };
const activeKey = 'information-study.office-chat.active.v1';
const newsHome = 'https://qmysu11.github.io/information-hub/#/markets';
const quickPrompts: { intent: ChatIntent; label: string; prompt: string; icon: typeof Sparkles }[] = [
  { intent: 'curation', label: '挑点有趣的', prompt: '从我附上的新闻、视频和帖子中挑 5 条有趣、有新意或值得花时间的内容。告诉我它好玩或有用在哪里，保留原帖来源。请只根据标题和摘要判断。', icon: Sparkles },
  { intent: 'videos', label: '推荐视频', prompt: '从这批视频帖子中，挑 3 条值得一看的，解释推荐理由并保留原站入口。请只根据标题和摘要判断，不要假装已经看过完整视频。', icon: Play },
  { intent: 'market', label: '自选动态', prompt: '从我附上的财经报道中，整理与我的自选标的相关的动态。区分已知事实、可能影响和待核实事项，注明来源与材料时间。没有行情数据就不要猜实时价格，也不要当作已经在后台持续盯盘。', icon: TrendingUp },
];
function memberOf(id: OfficeProviderId) { return OFFICE_ROSTER.find(member => member.id === id)!; }
function remember(id?: string) { try { if (id) sessionStorage.setItem(activeKey, id); else sessionStorage.removeItem(activeKey); } catch { /* The server history still works without browser session storage. */ } }
function remembered() { try { const value = sessionStorage.getItem(activeKey); return validConversationId(value) ? value : ''; } catch { return ''; } }
function mergeSummary(current: ChatConversationSummary[], value: ChatConversation) { return [{ id: value.id, title: value.title, provider: value.provider, updatedAt: value.updatedAt }, ...current.filter(row => row.id !== value.id)].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); }

function Message({ message, provider, items, onOpen }: { message: ChatMessage; provider: OfficeProviderId; items: ContentItem[]; onOpen?: (item: ContentItem) => void }) {
  const references = referencesForChatMessage(message);
  const member = memberOf(provider);
  const text = message.role === 'assistant' ? message.text.replace(/\[来源:([^\]\n]+)\]/g, (_, id: string) => { const index = references.findIndex(row => row.id === id); return index >= 0 ? `〔${index + 1}〕` : '〔来源未匹配〕'; }) : message.text;
  const formatted = useMemo(() => message.role === 'assistant' ? DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }), { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'], ALLOWED_ATTR: [], FORBID_TAGS: ['a', 'img', 'iframe', 'style', 'script', 'video', 'audio', 'form', 'input'], FORBID_ATTR: ['style'] }) : '', [message.role, text]);
  return <article className={'office-chat-message role-' + message.role + (message.deliveryStatus === 'failed' ? ' delivery-failed' : '')}>
    <header><span className="office-chat-message-avatar">{message.role === 'user' ? '我' : member.nickname.slice(0, 1)}</span><div><strong>{message.role === 'user' ? '你' : member.nickname}<small>{message.role === 'assistant' ? member.name : ''}</small></strong><span>{fullTime(message.createdAt)}{message.model ? ' · ' + message.model : ''}</span></div></header>
    {message.role === 'assistant' ? <div className="office-chat-rich-text" dangerouslySetInnerHTML={{ __html: formatted }} /> : <div className="office-chat-message-text">{text}</div>}
    {message.materials && message.materials.length > 0 && <details className="office-chat-attached-history"><summary><Paperclip size={12} />本条附入 {message.materials.length} 条来源材料</summary><ul>{message.materials.map(row => <li key={row.id}><a href={safeUrl(row.url)} target="_blank" rel="noopener noreferrer">{row.title}<ArrowUpRight size={11} /></a><span>{row.source} · 获取于 {fullTime(row.fetchedAt)}</span></li>)}</ul></details>}
    {message.role === 'user' && message.watchSymbols && message.watchSymbols.length > 0 && <p className="office-chat-history-watch">本条附入自选：{message.watchSymbols.join('、')}</p>}
    {references.length > 0 && <div className="office-chat-references">{references.map((reference, index) => { const current = items.find(item => item.id === reference.id && safeUrl(item.url) === safeUrl(reference.url)); return <div key={reference.id}>{onOpen && current ? <button onClick={() => onOpen(current)}><span>{index + 1}</span>{reference.title}<ArrowUpRight size={12} /></button> : <a href={safeUrl(reference.url)} target="_blank" rel="noopener noreferrer"><span>{index + 1}</span>{reference.title}<ArrowUpRight size={12} /></a>}<small>{reference.source} · 获取于 {fullTime(reference.fetchedAt)}</small></div>; })}</div>}
    {message.deliveryStatus === 'failed' && <p className="office-chat-delivery-note">这次发送未完成，未作为后续模型上下文。可在输入框修改后重新发送。</p>}
    {message.deliveryStatus === 'pending' && <p className="office-chat-delivery-note"><LoaderCircle className="spin" size={12} />这条消息仍在处理中，可刷新会话状态。</p>}
    {message.usage && <footer>输入 {message.usage.input} / 输出 {message.usage.output} tokens</footer>}
  </article>;
}

export default function OfficeChat({ status, items, sources, watchSymbols, onOpen, onStatusRefresh, onRefreshMaterials, refreshingMaterials = false, materialError = '' }: Props) {
  const [history, setHistory] = useState<ChatConversationSummary[]>([]);
  const [active, setActive] = useState<ChatConversation | null>(null);
  const [provider, setProvider] = useState<OfficeProviderId>('deepseek');
  const [draft, setDraft] = useState('');
  const [intent, setIntent] = useState<ChatIntent>('general');
  const [includeMaterials, setIncludeMaterials] = useState(false);
  const [includeWatch, setIncludeWatch] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'sending' | null>(null);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [pendingText, setPendingText] = useState('');
  const [counts, setCounts] = useState<{ used?: number; limit?: number }>({});
  const mounted = useRef(true), locked = useRef(false);
  const sendController = useRef<AbortController | null>(null);
  const lastAttempt = useRef<{ payload: ChatSendInput; conversationId?: string; message: string; beforeIds: Set<string> } | null>(null);
  const messages = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const materialChoices = useMemo(() => chooseChatMaterials(items, sources, intent), [items, sources, intent]);
  const configured = status?.providers.some(row => row.id === provider && row.configured) || false;
  const canLoad = Boolean(status?.canConfigure || status?.ready);
  const pendingDelivery = active?.pending === true || active?.messages.some(message => message.deliveryStatus === 'pending') || false;
  const navigationBlocked = Boolean(busy || pendingDelivery);
  const canSend = Boolean(status?.ready && configured && draft.trim() && !busy && !pendingDelivery && !unresolved && (!includeMaterials || !refreshingMaterials));
  const member = memberOf(provider);
  const latestMaterial = materialChoices.reduce((latest, row) => Date.parse(row.fetchedAt) > Date.parse(latest || '') || !latest ? row.fetchedAt : latest, '');
  const usedCalls = counts.used ?? status?.usedCalls ?? 0, dailyLimit = counts.limit ?? status?.dailyLimit ?? 30;
  function attemptObserved(value: ChatConversation) {
    const attempt = lastAttempt.current;
    if (!attempt) return true;
    if (attempt.conversationId && attempt.conversationId !== value.id) return false;
    return value.pending === true || value.messages.some(message => message.role === 'user' && !attempt.beforeIds.has(message.id) && message.text === attempt.message);
  }
  function apply(value: ChatConversation) {
    if (!mounted.current) return false;
    setActive(value); setProvider(value.provider); setHistory(current => mergeSummary(current, value)); setCounts({ used: value.usedCalls, limit: value.dailyLimit }); remember(value.id);
    const attempt = lastAttempt.current;
    let index = value.messages.length - 1;
    while (index >= 0 && value.messages[index].role !== 'user') index--;
    const user = value.messages[index];
    const completed = Boolean(attempt && (!attempt.conversationId || attempt.conversationId === value.id) && !value.pending && user && !attempt.beforeIds.has(user.id) && user.text === attempt.message && user.deliveryStatus === 'completed' && value.messages.slice(index + 1).some(message => message.role === 'assistant'));
    if (completed) { setDraft(''); resetAttachments(); lastAttempt.current = null; }
    return completed;
  }
  async function refreshHistory() { try { const list = await getChatConversations(); if (mounted.current) { setHistory(list); setHistoryError(''); } } catch (cause) { if (mounted.current) setHistoryError(cause instanceof Error ? cause.message : '暂时无法读取历史。'); } }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sendController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!canLoad) return;
    const controller = new AbortController(); locked.current = true; setBusy('loading');
    void (async () => {
      try {
        const list = await getChatConversations(controller.signal);
        if (controller.signal.aborted || !mounted.current) return;
        setHistory(list); setHistoryError('');
        const id = remembered();
        if (id) { try { const value = await getChatConversation(id, controller.signal); if (!controller.signal.aborted) apply(value); } catch { if (!controller.signal.aborted) { remember(); setHistoryError('上一段对话暂时无法恢复，可从历史重新打开。'); } } }
      } catch (cause) { if (!controller.signal.aborted && mounted.current) setHistoryError(cause instanceof Error ? cause.message : '暂时无法读取历史。'); }
      finally { if (!controller.signal.aborted && mounted.current) { locked.current = false; setBusy(null); } }
    })();
    return () => { controller.abort(); locked.current = false; };
  }, [canLoad]);
  useEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }, [active?.id, active?.messages.length, busy]);
  function resetAttachments() { setIntent('general'); setIncludeMaterials(false); setIncludeWatch(false); }
  function newConversation() { if (locked.current || pendingDelivery || unresolved) return; setActive(null); setProvider('deepseek'); setDraft(''); setError(''); setUnresolved(false); setPendingText(''); setHistoryOpen(false); lastAttempt.current = null; resetAttachments(); remember(); input.current?.focus(); }
  async function openConversation(id: string, preserveDraft = false) {
    if (locked.current || (pendingDelivery && id !== active?.id)) return;
    locked.current = true; setBusy('loading'); setError('');
    try { const value = await getChatConversation(id); const observed = attemptObserved(value); apply(value); setUnresolved(unresolved && !observed); setHistoryOpen(false); if (!preserveDraft && !unresolved) { setDraft(''); resetAttachments(); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : '对话暂时无法打开。'); }
    finally { if (mounted.current) { locked.current = false; setBusy(null); } }
  }
  function usePrompt(next: ChatIntent) { if (locked.current || pendingDelivery || unresolved) return; const prompt = quickPrompts.find(row => row.intent === next); if (!prompt) return; setIntent(next); setDraft(prompt.prompt); setIncludeMaterials(true); setIncludeWatch(next === 'market'); setError(''); input.current?.focus(); }
  async function send(event?: FormEvent) {
    event?.preventDefault(); if (locked.current || !canSend) return;
    let payload;
    try { payload = createChatSendInput({ conversationId: active?.id, provider, message: draft, requestId: crypto.randomUUID(), intent, includeMaterials, materials: materialChoices, includeWatchSymbols: includeWatch, watchSymbols }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '请检查消息内容。'); return; }
    lastAttempt.current = { payload, conversationId: active?.id, message: payload.message, beforeIds: new Set(active?.messages.map(message => message.id) || []) };
    await deliver(payload);
  }
  async function deliver(payload: ChatSendInput) {
    if (locked.current) return;
    locked.current = true; setBusy('sending'); setError(''); setPendingText(payload.message);
    const controller = new AbortController(); sendController.current = controller;
    try { const value = await sendChatMessage(payload, controller.signal); apply(value); setUnresolved(false); }
    catch (cause) {
      if (!mounted.current) return;
      const message = cause instanceof Error ? cause.message : '这条消息暂时没有完成。';
      const id = cause instanceof OfficeChatError ? cause.conversationId || active?.id : active?.id;
      setError(message); setUnresolved(cause instanceof OfficeChatError && cause.deliveryUnknown);
      if (id) { remember(id); if (lastAttempt.current) lastAttempt.current.conversationId = id; try { const value = await getChatConversation(id); const observed = attemptObserved(value); const completed = apply(value); if (completed) setError(''); setUnresolved(cause instanceof OfficeChatError && cause.deliveryUnknown && !observed); } catch { /* Keep the draft and last readable history. */ } }
      await refreshHistory();
    } finally {
      if (mounted.current) { locked.current = false; setBusy(null); setPendingText(''); sendController.current = null; try { await onStatusRefresh?.(); } catch { /* Status refresh does not retry a model call. */ } }
    }
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }
  return <section className="office-chat" style={{ '--chat-accent': member.color } as CSSProperties} aria-labelledby="office-chat-heading">
    <aside className={'office-chat-history ' + (historyOpen ? 'is-open' : '')}><header><h2><History size={15} />对话记录</h2><button className="icon-button" disabled={Boolean(busy) || !canLoad} onClick={() => void refreshHistory()} aria-label="刷新对话历史"><RefreshCw size={14} /></button></header><button className="button office-chat-new" onClick={newConversation} disabled={navigationBlocked || unresolved}><Plus size={14} />新对话</button><div className="office-chat-history-list">{history.map(row => <button key={row.id} className={active?.id === row.id ? 'selected' : ''} disabled={navigationBlocked} onClick={() => void openConversation(row.id)}><strong>{row.title}</strong><span><small>{memberOf(row.provider).name}</small><time>{fullTime(row.updatedAt)}</time></span></button>)}{!history.length && <p className="office-chat-history-empty">{busy === 'loading' ? '正在读取历史…' : '第一句开始之后，对话会留在这里。'}</p>}</div>{historyError && <p className="office-chat-history-error" role="status">{historyError}</p>}<footer>会话保留 30 天，按当前登录账号隔离。切换模型请新开一段对话。</footer></aside>
    <div className="office-chat-main"><header className="office-chat-topline"><div><span className="office-chat-eyebrow">A CONVERSATION THAT CONTINUES</span><h2 id="office-chat-heading">{active ? active.title : '想说什么，都可以接着聊。'}</h2><p>{active ? `${member.name} · ${active.messages.length} 条已保存消息` : '默认和 DeepSeek 聊，也可以手动选择已接入的其他成员。'}</p></div><button className="office-chat-history-toggle" onClick={() => setHistoryOpen(current => !current)} aria-expanded={historyOpen}><History size={15} />历史<ChevronDown size={12} /></button></header>
      <div className="office-chat-provider"><label>当前成员<select aria-label="连续对话模型" value={provider} disabled={Boolean(active || navigationBlocked || unresolved)} onChange={event => { setProvider(event.target.value as OfficeProviderId); setDraft(''); resetAttachments(); setError(''); }} >{OFFICE_ROSTER.map(row => <option key={row.id} value={row.id} disabled={!status?.providers.some(option => option.id === row.id && option.configured)}>{row.name}{!status?.providers.some(option => option.id === row.id && option.configured) ? ' · 未接入' : ''}</option>)}</select></label><span className={'office-chat-provider-state ' + (configured ? 'ready' : '')}>{configured ? '已连接' : '请先在“连接模型”中配置'}</span>{active && <button className="text-button" onClick={newConversation} disabled={navigationBlocked || unresolved}>另开对话换模型 <ArrowUpRight size={12} /></button>}<small>今日 {usedCalls} / {dailyLimit} 次调用</small></div>
      <div ref={messages} className="office-chat-messages" aria-label="连续对话消息">
        {active?.messages.map(message => <Message key={message.id} message={message} provider={active.provider} items={items} onOpen={onOpen} />)}
        {!active?.messages.length && !busy && <div className="office-chat-welcome"><span className="office-chat-welcome-orbit"><MessageCircle size={30} /></span><h3>这次，不用一句话把事情说完。</h3><p>继续追问、补充条件、换个角度。这里会保存这段对话，而不是每次重新开始。</p><div><span><Sparkles size={12} />挑点有趣的</span><span><Play size={12} />找一段想看的视频</span><span><TrendingUp size={12} />跟进自选相关新闻</span></div></div>}
        {busy === 'loading' && <div className="office-chat-progress" role="status"><LoaderCircle size={16} className="spin" />正在读取这段对话…</div>}
        {busy === 'sending' && <div className="office-chat-progress" role="status"><LoaderCircle size={16} className="spin" /><div><strong>{member.name} 正在回应</strong><p>{pendingText.length > 100 ? pendingText.slice(0, 100) + '…' : pendingText}</p></div></div>}
      </div>
      {active && <div className="office-chat-context"><Clock3 size={11} /><span>最近一次发送包含 {active.contextMessageCount} 条上下文。{active.contextLimited ? '较早内容未送入本轮模型，完整历史仍保留。' : '继续追问会使用近期对话。'}</span></div>}
      {pendingDelivery && !busy && <div className="office-chat-recovery" role="status"><p>上一条仍在处理中，先刷新状态，避免重复发送。</p><button className="button" onClick={() => active && void openConversation(active.id, true)}><RefreshCw size={13} />刷新会话状态</button></div>}
      {unresolved && !busy && <div className="office-chat-recovery" role="status"><p>暂时无法确认上一条是否完成。可先查看历史；“恢复上次发送”只恢复同一条请求，不会作为新消息重复调用。草稿仍保留在下方。</p><button className="button" onClick={() => void refreshHistory()}><RefreshCw size={13} />刷新历史列表</button>{lastAttempt.current && !pendingDelivery && <button className="button" onClick={() => lastAttempt.current && void deliver(lastAttempt.current.payload)}><RefreshCw size={13} />恢复上次发送</button>}</div>}
      {error && <div className="office-chat-error" role="alert">{error}</div>}
      <form className="office-chat-composer" onSubmit={event => void send(event)}><div className="office-chat-quick" aria-label="连续对话快捷任务">{quickPrompts.map(row => <button key={row.intent} type="button" disabled={navigationBlocked || unresolved} className={intent === row.intent ? 'selected' : ''} onClick={() => usePrompt(row.intent)}><row.icon size={13} />{row.label}</button>)}</div>
        <textarea ref={input} aria-label="继续对话的消息" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={keyDown} disabled={navigationBlocked} maxLength={6000} rows={3} placeholder="接着问，也可以从一个新想法开始。不要在聊天里填写 API 密钥。" />
        <div className="office-chat-attachment-options"><label><input type="checkbox" checked={includeMaterials} disabled={navigationBlocked || unresolved} onChange={event => setIncludeMaterials(event.target.checked)} /><Paperclip size={12} />本次附入新闻材料</label>{includeMaterials && <span>{materialChoices.length} 条 · 最新获取 {fullTime(latestMaterial)}</span>}<button className="text-button" type="button" disabled={Boolean(busy) || refreshingMaterials || !onRefreshMaterials} onClick={() => { setError(''); void onRefreshMaterials?.().catch(() => {}); }}><RefreshCw className={refreshingMaterials ? 'spin' : ''} size={12} />{refreshingMaterials ? '刷新中' : '刷新资料'}</button></div>
        {includeMaterials && <details className="office-chat-material-preview"><summary><FileText size={12} />查看本次将附入的 {materialChoices.length} 条标题与摘要</summary><p>这些是来源标题与短摘要，可能包含缓存；不是报道全文或完整视频。</p><ul>{materialChoices.map(row => <li key={row.id}><a href={safeUrl(row.url)} target="_blank" rel="noopener noreferrer">{row.title}<ArrowUpRight size={11} /></a><span>{row.source} · 获取于 {fullTime(row.fetchedAt)}</span>{row.description && <small>{row.description}</small>}</li>)}</ul></details>}
        {materialError && <p className="office-chat-material-error" role="status">{materialError} 仍保留此前可用资料，请核对获取时间。</p>}
        {(intent === 'market' || includeWatch) && <div className="office-chat-watch"><label><input type="checkbox" checked={includeWatch} disabled={navigationBlocked || unresolved} onChange={event => setIncludeWatch(event.target.checked)} />本次附入我的自选代码</label><span>{watchSymbols.length ? watchSymbols.join('、') : '尚无自选，可在页首的关注标的中填写。'}</span><p>整理相关新闻；持续更新的 K 线在<a href={newsHome} target="_blank" rel="noopener noreferrer">行情页查看 <ArrowUpRight size={11} /></a>，股票报价可能延迟。这里不会自动读取 K 线或在后台持续盯盘。</p></div>}
        <footer><span>{draft.length}/6000 · Enter 发送，Shift + Enter 换行<small>每条消息调用一次所选模型；默认不附新闻或笔记。</small></span><button className="button primary" type="submit" disabled={!canSend}>{busy === 'sending' ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}{busy === 'sending' ? '等待回复' : '发送消息'}</button></footer>
      </form><p className="office-chat-retention">每轮最多使用最近 20 条、24000 字上下文；完整会话最多 200 条、24 万字，服务端保留 30 天。新对话不会自动带入另一位模型的历史。</p>
    </div>
  </section>;
}

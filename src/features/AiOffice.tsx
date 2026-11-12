import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, CircleHelp, Coffee, Download, FileText, LoaderCircle, MessageCircle, Plus, RefreshCw, ShieldCheck, Sparkles, Square, Trash2, Users } from 'lucide-react';
import type { ContentItem, Source } from '../types';
import { parseSnapshot, safeUrl, fullTime } from '../lib/feed';
import { approveOfficeTask, cancelOfficeTask, chooseOfficeMaterials, getOfficeFeed, getOfficeStatus, OFFICE_ROSTER, planOfficeTask, resumeOfficeTask, runOfficeStep } from '../lib/office-client';
import type { OfficePlan, OfficeProviderId, OfficeReply, OfficeSession, OfficeStatus, OfficeTemplate } from '../lib/office-client';
import './ai-office.css';
import OfficeConnections from './OfficeConnections';
import OfficeChat from './OfficeChat';

type Props = { items: ContentItem[]; sources: Source[]; watchSymbols?: string[]; notes?: { id: string; title: string; body: string }[]; privateOfficeUrl?: string; standalone?: boolean; onOpen?: (item: ContentItem) => void };
const templates: { id: OfficeTemplate; label: string; prompt: string }[] = [
  { id: 'general', label: '随时提问', prompt: '' },
  { id: 'study', label: '学习陪跑', prompt: '帮我把这个知识点讲清楚，安排循序渐进的练习，并检查容易混淆的地方：' },
  { id: 'curation', label: '有趣精选', prompt: '从这批新闻、视频和帖子中，挑选 5 条有趣、有新意或值得花时间的内容。少一点公式化的宏大叙事，告诉我它好玩或有用在哪里。只根据标题和摘要判断，不要假装看过完整视频。' },
  { id: 'market', label: '自选观察', prompt: '整理给定财经报道中与我的自选相关的动态。区分已知事实、可能影响和仍需核实的事项，列出值得继续跟进的问题；没有价格数据就不要猜实时行情，也不要给买卖指令。' },
];
const currentKey = 'information-study.office-session.v1';
function providerName(id: OfficeProviderId) { return OFFICE_ROSTER.find(member => member.id === id)?.name || id; }
function exportText(name: string, text: string) { const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function Reply({ reply, items, onOpen }: { reply: OfficeReply; items: ContentItem[]; onOpen?: (item: ContentItem) => void }) {
  const member = OFFICE_ROSTER.find(candidate => candidate.id === reply.provider)!;
  const references = [...new Set([...reply.text.matchAll(/\[来源:([^\]\n]+)\]/g)].map(match => match[1]))].map(id => items.find(item => item.id === id)).filter((item): item is ContentItem => Boolean(item));
  return <article className={'office-reply phase-' + reply.phase} style={{ '--member-color': member.color } as CSSProperties}>
    <header><span className="office-small-avatar">{member.nickname.slice(0, 1)}</span><div><strong>{member.nickname}<small>{member.name}</small></strong><span>{reply.title} · {reply.model}</span></div><CheckCircle2 size={16} /></header>
    <div className="office-reply-text">{reply.text.replace(/\[来源:([^\]\n]+)\]/g, (_, id: string) => references.some(item => item.id === id) ? '〔来源见下方〕' : '〔来源未匹配〕')}</div>
    {references.length > 0 && <div className="office-citations">{references.map(item => onOpen ? <button key={item.id} onClick={() => onOpen(item)}><FileText size={12} />{item.title}<ArrowUpRight size={12} /></button> : <a key={item.id} href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer"><FileText size={12} />{item.title}<ArrowUpRight size={12} /></a>)}</div>}
    <footer><span>{fullTime(reply.completedAt)}</span><span>输入 {reply.usage.input} / 输出 {reply.usage.output} tokens</span></footer>
  </article>;
}
export default function AiOffice({ items, sources, watchSymbols = [], notes = [], privateOfficeUrl, standalone = false, onOpen }: Props) {
  const [status, setStatus] = useState<OfficeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(standalone);
  const [mode, setMode] = useState<'chat' | 'team'>('chat');
  const [refreshingMaterials, setRefreshingMaterials] = useState(false);
  const [materialError, setMaterialError] = useState('');
  const [remoteFeed, setRemoteFeed] = useState<{ items: ContentItem[]; sources: Source[] } | null>(null);
  const [template, setTemplate] = useState<OfficeTemplate>('general');
  const [task, setTask] = useState('');
  const [members, setMembers] = useState<OfficeProviderId[]>([]);
  const [convener, setConvener] = useState<OfficeProviderId>('deepseek');
  const [maxCalls, setMaxCalls] = useState(6);
  const [includeNews, setIncludeNews] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [session, setSession] = useState<OfficeSession | null>(null);
  const [draft, setDraft] = useState<OfficePlan | null>(null);
  const [busy, setBusy] = useState<'planning' | 'working' | 'recovering' | null>(null);
  const [error, setError] = useState('');
  const [restoreTicket, setRestoreTicket] = useState('');
  const sessionRef = useRef<OfficeSession | null>(null);
  const abort = useRef<AbortController | null>(null);
  const visibleItems = remoteFeed?.items || items;
  const visibleSources = remoteFeed?.sources || sources;
  const materials = useMemo(() => chooseOfficeMaterials(visibleItems, visibleSources, template), [visibleItems, visibleSources, template]);
  const configured = status?.providers.filter(member => member.configured).map(member => member.id) || [];
  const officeLink = safeUrl(privateOfficeUrl || import.meta.env.VITE_PRIVATE_OFFICE_URL || '');
  const locked = Boolean(busy || session);
  const applySession = (value: OfficeSession) => { sessionRef.current = value; setSession(value); setMembers(value.members); setConvener(value.convener); try { sessionStorage.setItem(currentKey, value.ticket); } catch { /* Session persistence is optional. */ } };
  async function refreshStatus() {
    if (!standalone) return;
    setStatusLoading(true);
    try { const value = await getOfficeStatus(); setStatus(value); const ids = value.providers.filter(member => member.configured).map(member => member.id); const active = sessionRef.current; if (active) { setMembers(active.members); setConvener(active.convener); } else { setMembers(current => current.length ? current.filter(id => ids.includes(id)) : ids); setConvener(current => ids.includes(current) ? current : ids.includes('deepseek') ? 'deepseek' : ids[0] || 'deepseek'); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法连接办公室。'); }
    finally { setStatusLoading(false); }
  }
  async function refreshMaterials() {
    if (!standalone || refreshingMaterials) return;
    setRefreshingMaterials(true); setMaterialError('');
    try { const feed = parseSnapshot(await getOfficeFeed()); setRemoteFeed({ items: feed.items, sources: feed.sources }); }
    catch { setMaterialError('暂时无法刷新新闻，仍显示上次载入的资料，请留意各条来源时间。'); }
    finally { setRefreshingMaterials(false); }
  }
  useEffect(() => {
    if (!standalone) return;
    void refreshStatus();
    const controller = new AbortController();
    void getOfficeFeed(controller.signal).then(raw => { const feed = parseSnapshot(raw); setRemoteFeed({ items: feed.items, sources: feed.sources }); }).catch(() => { if (!controller.signal.aborted) setMaterialError('新闻资料暂时无法载入，可以继续普通聊天，或稍后刷新资料。'); });
    try { setRestoreTicket(sessionStorage.getItem(currentKey) || ''); } catch { /* No stored session. */ }
    return () => { controller.abort(); abort.current?.abort(); };
  }, [standalone]);
  function selectTemplate(id: OfficeTemplate) { if (locked) return; setTemplate(id); setTask(templates.find(candidate => candidate.id === id)?.prompt || ''); setIncludeNews(id === 'curation' || id === 'market'); }
  function toggleMember(id: OfficeProviderId) {
    const next = members.includes(id) ? members.filter(member => member !== id) : [...members, id]; setMembers(next);
    if (!next.includes(convener) && next.length) setConvener(next[0]);
  }
  async function prepare(event: FormEvent) {
    event.preventDefault(); if (busy || !standalone || !status?.ready) return;
    setBusy('planning'); setError(''); const controller = new AbortController(); abort.current = controller;
    const included = [noteText, ...notes.filter(note => selectedNotes.includes(note.id)).map(note => note.title + '\n' + note.body)].join('\n\n').slice(0, 6000);
    try { const value = await planOfficeTask({ task, template, convener, members, maxCalls, materials: includeNews ? materials : [], includeNotes, noteText: includeNotes ? included : '', watchSymbols: template === 'market' ? watchSymbols : [] }, controller.signal); applySession(value); setDraft(value.plan ? structuredClone(value.plan) : null); setRestoreTicket(''); }
    catch (cause) { setError(controller.signal.aborted ? '已停止等待。已发送的模型请求仍可能计费，本次不会继续执行。' : cause instanceof Error ? cause.message : '分工暂时无法拟定。'); }
    finally { setBusy(null); abort.current = null; void refreshStatus(); }
  }
  async function execute(approve: boolean) {
    if (!session || busy || (approve && !draft)) return;
    const controller = new AbortController(); abort.current = controller; setBusy('working'); setError('');
    let current = session;
    try {
      if (approve && draft) { current = await approveOfficeTask(current.ticket, draft, controller.signal); applySession(current); }
      while (current.status === 'ready' && !controller.signal.aborted) { current = await runOfficeStep(current.ticket, controller.signal); applySession(current); }
    } catch (cause) {
      if (!controller.signal.aborted) { try { applySession(await resumeOfficeTask(sessionRef.current?.ticket || current.ticket)); } catch { /* Keep visible results if reconnecting fails. */ } }
      setError(controller.signal.aborted ? '已停止后续工作。当前已发送的请求仍可能计费。' : cause instanceof Error ? cause.message : '本步骤未完成，任务已停止。');
    } finally { setBusy(null); abort.current = null; void refreshStatus(); }
  }
  async function stop() {
    abort.current?.abort();
    const ticket = sessionRef.current?.ticket;
    if (ticket) { try { applySession(await cancelOfficeTask(ticket)); } catch { setError('已停止等待，请恢复任务状态确认服务端结果。'); } }
  }
  async function recover() {
    const ticket = sessionRef.current?.ticket || restoreTicket;
    if (!ticket || busy) return;
    setBusy('recovering'); setError('');
    try { const value = await resumeOfficeTask(ticket); applySession(value); setDraft(value.plan ? structuredClone(value.plan) : null); setRestoreTicket(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法恢复会话。'); setRestoreTicket(''); }
    finally { setBusy(null); }
  }
  function newTask() { setSession(null); sessionRef.current = null; setDraft(null); setError(''); setRestoreTicket(''); try { sessionStorage.removeItem(currentKey); } catch { /* Optional browser persistence. */ } }
  function updateAssignment(index: number, field: 'title' | 'instruction' | 'provider', value: string) { setDraft(current => current ? { ...current, assignments: current.assignments.map((row, i) => i === index ? { ...row, [field]: value } : row) } : null); }
  const plannedCalls = draft ? 1 + draft.assignments.length + (draft.reviewer ? 1 : 0) + 1 : 0;
  const activeStep = busy === 'working' && session ? session.steps[session.nextStep] : null;
  return <div className={'ai-office' + (standalone ? ' mode-' + mode : '')}>
    <header className="office-intro"><div><span className="office-eyebrow"><Coffee size={14} /> OUR LITTLE STUDIO</span><h1>{standalone && mode === 'chat' ? '想到什么，就接着聊。' : '有问题，就叫大家来聊。'}</h1><p>{standalone && mode === 'chat' ? '保留上下文，随时追问。工作、日常、新闻和自选动态，都可以在同一段对话里继续。' : '工作、学习，或者一个临时冒出的念头。让小队自己拟定分工，你来决定什么时候开工。'}</p></div><span className="office-door-sign"><span />{standalone ? '你的私密办公室' : '一起，把事情做出来'}</span></header>
    <div className="office-roster">{OFFICE_ROSTER.map(member => { const available = configured.includes(member.id); const working = busy === 'planning' ? convener === member.id : activeStep?.provider === member.id; const duties = (session?.plan?.assignments || []).filter(row => row.provider === member.id).map(row => row.title); return <article key={member.id} className={'office-member ' + (working ? 'is-working' : '')} style={{ '--member-color': member.color } as CSSProperties}>
      <div className="office-member-portrait" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}art/agents-team.webp)`, backgroundPosition: member.portrait }}><span>{member.nickname}</span><small>{working ? <><LoaderCircle className="spin" size={11} />正在回应</> : standalone ? available ? <><span className="office-presence" />可参与</> : '尚未接入' : '虚拟协作伙伴'}</small></div>
      <div className="office-member-copy"><h2>{member.nickname}<span>{member.name}</span></h2><p>{member.personality}</p><small>{working ? busy === 'planning' ? '本次：召集人正在拟定分工' : '本次：' + activeStep?.title : duties.length ? '本次：' + duties.join('、') : '每次任务，由小队重新分工'}</small></div>
    </article>; })}</div>
    {!standalone && <section className="office-private-gate"><ShieldCheck size={24} /><div><h2>把讨论留在自己的空间里</h2><p>打开私密办公室即可连续聊天、追问新闻视频和自选动态，也保留小队协作。API 密钥与工作资料由私密服务处理。</p></div>{officeLink ? <a className="button primary" href={officeLink} target="_blank" rel="noopener noreferrer">打开我的私密办公室 <ArrowUpRight size={16} /></a> : <span className="status-pill warning">私密服务待连接</span>}</section>}
    {standalone && !statusLoading && !status?.ready && <section className="office-service-state" role="status"><CircleHelp size={19} /><div><strong>小队还在等待接入</strong><p>{error || (status?.providers.some(member => member.configured) ? '模型已配置，办公室存储或会话配置还需完成。' : '先在私密管理入口配置至少一个模型的密钥。这里不会收集或保存浏览器里的 API 密钥。')}</p></div><button className="button" onClick={() => void refreshStatus()}><RefreshCw size={14} />检查连接</button></section>}
    {standalone && <OfficeConnections status={status} onConnected={refreshStatus} disabled={Boolean(busy)} />}
    {standalone && <nav className="office-mode-switch" aria-label="办公室使用方式"><button type="button" className={mode === 'chat' ? 'selected' : ''} aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}><MessageCircle size={15} />连续对话</button><button type="button" className={mode === 'team' ? 'selected' : ''} aria-pressed={mode === 'team'} onClick={() => setMode('team')}><Users size={15} />小队协作</button><span>{mode === 'chat' ? '每条消息一次回复，可以一直追问' : '保留原有的分工、审阅和汇总流程'}</span></nav>}
    {standalone && <div hidden={mode !== 'chat'}><OfficeChat status={status} items={visibleItems} sources={visibleSources} watchSymbols={watchSymbols} onOpen={onOpen} onStatusRefresh={refreshStatus} onRefreshMaterials={refreshMaterials} refreshingMaterials={refreshingMaterials} materialError={materialError} /></div>}
    <div hidden={standalone && mode !== 'team'}>
    {standalone && restoreTicket && !session && <div className="office-restore"><span>这个标签页还有一项未查看的工作。</span><button className="text-button" onClick={() => void recover()}>恢复工作状态 <ArrowRight size={14} /></button></div>}
    <div className="office-workspace"><section className="office-brief"><div className="office-section-label"><MessageCircle size={16} /><h2>今天，想一起做什么？</h2></div><form onSubmit={event => void prepare(event)}>
      <div className="office-template-tabs">{templates.map(row => <button key={row.id} type="button" disabled={locked || !standalone} className={template === row.id ? 'selected' : ''} onClick={() => selectTemplate(row.id)}>{row.label}</button>)}</div>
      <textarea aria-label="交给 AI 小队的任务" value={task} onChange={event => setTask(event.target.value)} disabled={locked || !standalone} maxLength={6000} placeholder="解释一个概念、整理材料、写一份提案，或者把一个模糊的想法变成计划……" rows={7} />
      <div className="office-task-meta"><span>任务 {task.length} / 6000 字</span><span>通用协作 · 不固定品牌岗位</span></div>
      <div className="office-participants"><label>这次邀请谁？</label><div>{OFFICE_ROSTER.map(member => <label key={member.id} className={!configured.includes(member.id) && standalone ? 'unavailable' : ''}><input type="checkbox" checked={members.includes(member.id)} disabled={locked || !standalone || !configured.includes(member.id)} onChange={() => toggleMember(member.id)} /><span>{member.name}</span>{standalone && !configured.includes(member.id) && <small>未接入</small>}</label>)}</div></div>
      <div className="office-form-row"><label>由谁召集<select aria-label="选择召集人" value={convener} disabled={locked || !standalone || !members.length} onChange={event => setConvener(event.target.value as OfficeProviderId)}>{OFFICE_ROSTER.filter(member => members.includes(member.id) || !standalone).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>本次调用上限<select aria-label="本次模型调用上限" value={maxCalls} disabled={locked || !standalone} onChange={event => setMaxCalls(Number(event.target.value))}><option value={3}>3 次 · 轻量</option><option value={4}>4 次 · 简洁协作</option><option value={6}>6 次 · 完整协作</option></select></label></div>
      <details className="office-materials"><summary><FileText size={14} />这次带哪些资料？<span>{includeNews ? materials.length + ' 条快照' : '不附新闻'}{includeNotes ? ' · 已附文字' : ''}</span></summary><div><label className="office-check"><input type="checkbox" checked={includeNews} disabled={locked || !standalone} onChange={event => setIncludeNews(event.target.checked)} />附上当前新闻标题与短摘要（最多 40 条）</label>{includeNews && <p>本次可用 {materials.length} 条，来自不同来源；不是完整报道或视频内容。{template === 'market' && `自选：${watchSymbols.join('、') || '尚未设置'}`}</p>}<label className="office-check"><input type="checkbox" checked={includeNotes} disabled={locked || !standalone} onChange={event => setIncludeNotes(event.target.checked)} />附上我选择的笔记或文字资料</label>{includeNotes && <><textarea rows={4} disabled={locked || !standalone} value={noteText} onChange={event => setNoteText(event.target.value)} maxLength={6000} aria-label="本次同意发送的文字资料" placeholder="只粘贴你愿意发给参与模型的内容，最多合计 6000 字。" />{notes.length > 0 && <div className="office-note-picker">{notes.slice(0, 30).map(note => <label key={note.id}><input type="checkbox" checked={selectedNotes.includes(note.id)} disabled={locked || !standalone} onChange={event => setSelectedNotes(current => event.target.checked ? [...current, note.id] : current.filter(id => id !== note.id))} />{note.title || '未命名笔记'}</label>)}</div>}<p>仅发送勾选笔记与上面的文字，合计截取至 6000 字。默认不发送任何笔记。</p></>}</div></details>
      <div className="office-send-area"><p><ShieldCheck size={13} />任务与勾选资料将发送给本次参与的模型。拟定分工先调用召集人 1 次，确认后才执行。</p><button className="button primary" type="submit" disabled={!standalone || !status?.ready || !task.trim() || !members.length || locked}>{busy === 'planning' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy === 'planning' ? '召集人正在拟定分工…' : '请小队拟定分工'}</button></div>
    </form></section>
    <aside className="office-desk-note"><span className="office-paper-pin" /><BookOpen size={20} /><h3>一张桌子，多种思路。</h3><p>先说明你想达到什么结果。小队会提出本次的分工，也可以只请一个成员独立完成。</p><ol><li><span>01</span>召集人拟定分工</li><li><span>02</span>你调整并确认计划</li><li><span>03</span>成员交付、审阅、汇总</li></ol><p className="office-budget-note">{standalone && status ? `今日已预留 ${status.usedCalls} / ${status.dailyLimit} 次调用。` : '每项任务有明确的调用次数上限。'}次数限制不等于金额预算，账单以各服务商账户为准。</p><small>虚拟形象是本站原创角色，不代表模型官方形象。股票观察只整理本次材料，页面关闭后不会自动盯盘。</small></aside></div>
    {error && <div className="office-error" role="alert"><CircleHelp size={16} /><span>{error}</span></div>}
    {busy && <div className="office-working-status" role="status"><LoaderCircle className="spin" size={15} /><span>{busy === 'planning' ? `${providerName(convener)} 正在拟定本次分工` : busy === 'recovering' ? '正在恢复工作记录' : activeStep ? `${providerName(activeStep.provider)} · ${activeStep.title}` : '正在提交已确认的分工'}</span><button className="text-button" onClick={() => void stop()}><Square size={12} />停止后续工作</button></div>}
    {session?.status === 'draft' && draft && <section className="office-plan"><header><div><span className="office-eyebrow">PROPOSED BY YOUR TEAM</span><h2>这是小队拟定的分工</h2><p>可以换成员、改任务，再决定是否开工。模型身份与本次职责分别展示。</p></div><span className={'office-call-count ' + (plannedCalls > session.maxCalls ? 'over-limit' : '')}>共 {plannedCalls} / {session.maxCalls} 次调用，含已完成的分工</span></header><label className="office-plan-name">任务名称<input value={draft.title} maxLength={100} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><div className="office-assignments">{draft.assignments.map((row, index) => <article key={row.id}><div><span className="office-assignment-number">{String(index + 1).padStart(2, '0')}</span><input aria-label={'子任务 ' + (index + 1) + ' 标题'} value={row.title} maxLength={60} onChange={event => updateAssignment(index, 'title', event.target.value)} /><select aria-label={'子任务 ' + (index + 1) + ' 成员'} value={row.provider} onChange={event => updateAssignment(index, 'provider', event.target.value)}>{members.map(id => <option key={id} value={id}>{providerName(id)}</option>)}</select><button className="icon-button" aria-label={'移除子任务 ' + (index + 1)} disabled={draft.assignments.length === 1} onClick={() => setDraft({ ...draft, assignments: draft.assignments.filter((_, i) => i !== index) })}><Trash2 size={14} /></button></div><textarea rows={3} aria-label={'子任务 ' + (index + 1) + ' 交付要求'} value={row.instruction} maxLength={800} onChange={event => updateAssignment(index, 'instruction', event.target.value)} /></article>)}</div><div className="office-plan-actions"><button className="button" disabled={draft.assignments.length >= 3} onClick={() => setDraft({ ...draft, assignments: [...draft.assignments, { id: 'added-' + Date.now(), provider: members[0], title: '补充任务', instruction: '' }] })}><Plus size={14} />补充分工</button><label>独立审阅<select value={draft.reviewer || ''} onChange={event => setDraft({ ...draft, reviewer: event.target.value as OfficeProviderId || null })}><option value="">本次不单独审阅</option>{members.map(id => <option key={id} value={id}>{providerName(id)}</option>)}</select></label><label>最终汇总<select value={draft.summarizer} onChange={event => setDraft({ ...draft, summarizer: event.target.value as OfficeProviderId })}>{members.map(id => <option key={id} value={id}>{providerName(id)}</option>)}</select></label></div><footer><span>确认后将按以上分工自动执行；失败即停止，可随时停止后续步骤。</span><button className="button primary" disabled={Boolean(busy) || plannedCalls > session.maxCalls || draft.assignments.some(row => !row.instruction.trim())} onClick={() => void execute(true)}><Check size={16} />确认分工，开始协作</button></footer></section>}
    {session && <section className="office-deliveries"><header><div><span className="office-eyebrow">REAL WORK, VISIBLE HANDOFFS</span><h2>{session.title}</h2></div><div><span>{session.usedCalls} / {session.maxCalls} 次调用</span>{!busy && <button className="button" onClick={() => void recover()}><RefreshCw size={13} />恢复状态</button>}</div></header>{session.results.length ? <div className="office-discussion">{session.results.map(reply => <Reply key={reply.id} reply={reply} items={visibleItems} onOpen={onOpen} />)}</div> : <div className="office-no-results"><Users size={24} /><p>{session.status === 'draft' ? '分工已拟定。等你确认后，这里才会出现真实成员回复。' : '成员还没有交付。本页不会填充模拟讨论。'}</p></div>}{session.error && <p className="office-inline-error">{session.error}</p>}<footer><span>{session.status === 'completed' ? '本次协作已完成' : session.status === 'cancelled' ? '后续工作已停止' : session.status === 'failed' ? '本次协作已停止，保留已交付内容' : session.status === 'ready' && !busy ? '已恢复到可继续的步骤' : session.status === 'draft' ? '等待你的分工确认' : '正在处理'} · 服务端记录临时保留一小时</span><div>{session.status === 'ready' && !busy && <button className="button primary" onClick={() => void execute(false)}>继续已确认的分工 <ArrowRight size={14} /></button>}{session.results.length > 0 && <button className="button" onClick={() => exportText(session.title + '.md', '# ' + session.title + '\n\n' + session.results.map(reply => '## ' + reply.title + ' · ' + providerName(reply.provider) + '\n\n' + reply.text).join('\n\n'))}><Download size={14} />导出工作记录</button>}{!busy && <button className="button" onClick={newTask}><Plus size={14} />开一项新任务</button>}</div></footer></section>}
    </div>
    <div className="office-bottom-note"><ShieldCheck size={14} /><p>回复来自实际调用的模型，观点仍需你判断。平台版本、地区、账户额度与网络会影响可用性；没有接入的成员不会被另一个模型代扮。</p></div>
  </div>;
}

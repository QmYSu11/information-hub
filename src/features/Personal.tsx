import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Bell, BellRing, BookOpen, Check, CheckCheck, ChevronRight, Clock3, Download,
  ExternalLink, FileText, Folder, FolderOpen, HelpCircle, Inbox, Monitor, Moon, Pin,
  Plus, RotateCcw, Search, Settings2, ShieldCheck, Sun, Tag, Trash2, Upload, X } from 'lucide-react';
import type { ContentItem, Source } from '../types';
import { personal, usePersonal } from '../lib/personal-store';
import type { Note, PersonalData, Recurrence, Reminder } from '../lib/personal-store';
import { completeReminder, createId, fromShanghaiInput, instanceId, isDue, mergeBackup,
  parseBackup, reminderCalendar, safeUrl, shanghaiInput, snoozeReminder } from '../lib/personal-model';
import './personal.css';

type Props = { tab: 'notes' | 'reminders' | 'settings'; onToast: (s: string) => void; sources?: Source[] };
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const longDate = (iso: string) => dateFormat.format(new Date(iso));
const recurrenceName: Record<Recurrence, string> = { once: '仅一次', daily: '每天', weekly: '每周', weekdays: '周一至周五' };
function download(text: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function getHashId() { return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id'); }
function usePersonalDialog(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.personal-modal');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const nodes = focusable(); const first = nodes[0]; const last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [open]);
}
function Empty({ icon: Icon = Inbox, title, children }: { icon?: typeof Inbox; title: string; children?: React.ReactNode }) {
  return <div className="personal-empty"><span className="personal-empty-icon"><Icon size={26} strokeWidth={1.4} /></span><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
function SourceReference({ item }: { item: ContentItem }) {
  return <a className="personal-source-ref" href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer"><BookOpen size={16} /><span><small>来自阅读</small><strong>{item.title}</strong></span><ExternalLink size={14} /></a>;
}
function SaveState() {
  const { status, error } = usePersonal();
  return <span className={'personal-save-state ' + (status === 'error' ? 'is-error' : '')} title={error}>
    {status === 'saved' ? <CheckCheck size={14} /> : status === 'error' ? <HelpCircle size={14} /> : <Clock3 size={14} />}
    {status === 'loading' ? '正在读取资料' : status === 'saving' ? '正在保存' : status === 'error' ? '尚未保存，请导出' : '已保存到此浏览器'}
  </span>;
}

export default function Personal({ tab, onToast, sources = [] }: Props) {
  const { status, error } = usePersonal();
  const act = (fn: () => void) => { try { fn(); } catch (e) { onToast(e instanceof Error ? e.message : '操作未完成，请重试'); } };
  if (status === 'loading') return <div className="personal-page"><Empty icon={BookOpen} title="正在打开你的书房">正在读取此浏览器保存的资料。</Empty></div>;
  return <div className="personal-page">
    {error && <div className="personal-storage-warning" role="status"><HelpCircle size={17} /><span>{error}。可以在设置中导出当前资料。</span></div>}
    {tab === 'notes' && <Notes onToast={onToast} act={act} />}
    {tab === 'reminders' && <Reminders onToast={onToast} act={act} />}
    {tab === 'settings' && <Settings onToast={onToast} act={act} sources={sources} />}
  </div>;
}
export { Personal };

function Notes({ onToast, act }: { onToast: Props['onToast']; act: (fn: () => void) => void }) {
  const { data } = usePersonal();
  const [selectedId, setSelectedId] = useState<string | null>(getHashId);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('全部笔记');
  const [showTrash, setShowTrash] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const change = () => setSelectedId(getHashId()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const folders = [...new Set(data.notes.filter(n => !n.deletedAt && n.folder).map(n => n.folder))].sort();
  const allTags = [...new Set(data.notes.filter(n => !n.deletedAt).flatMap(n => n.tags))].sort();
  const filtered = useMemo(() => data.notes.filter(n => Boolean(n.deletedAt) === showTrash &&
    (showTrash || folder === '全部笔记' || n.folder === folder) &&
    (!tagFilter || n.tags.includes(tagFilter)) &&
    (!query || [n.title, n.body, n.folder, ...n.tags].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt)),
  [data.notes, showTrash, folder, query, tagFilter]);
  const note = filtered.find(n => n.id === selectedId) ?? filtered[0];
  useEffect(() => { setTagValue(note?.tags.join('，') ?? ''); setConfirmDelete(false); }, [note?.id]);
  const patch = (value: Partial<Note>) => act(() => {
    if (!note) return;
    personal.update(d => { const n = d.notes.find(x => x.id === note.id); if (n) Object.assign(n, value, { updatedAt: new Date().toISOString() }); });
  });
  const add = () => act(() => {
    const id = personal.createNote();
    if (folder !== '全部笔记') personal.update(d => { const n = d.notes.find(n => n.id === id); if (n) n.folder = folder; });
    setSelectedId(id); setShowTrash(false); setQuery(''); setTagFilter(''); setPreview(false);
    window.location.hash = '/notes?id=' + id;
  });
  const bodyHTML = useMemo(() => DOMPurify.sanitize(marked.parse(note?.body || '', { async: false }) as string,
    { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'iframe', 'style', 'input', 'button'], FORBID_ATTR: ['style', 'target'] }), [note?.body]);
  const exportNote = () => { if (note) download('# ' + (note.title || '未命名笔记') + '\n\n' +
    (note.source ? '> 来源：[' + note.source.title + '](' + note.source.url + ')\n\n' : '') + note.body,
    (note.title || '未命名笔记').replace(/[\\/:*?"<>|]/g, '_') + '.md', 'text/markdown;charset=utf-8'); };
  return <>
    <div className="personal-page-head"><div><p className="personal-eyebrow">把信息留给未来的自己</p><h1>我的笔记<span>{data.notes.filter(n => !n.deletedAt).length}</span></h1><p>收藏值得留下的想法，让阅读慢慢生长。</p></div><button className="personal-primary" onClick={add}><Plus size={17} />新建笔记</button></div>
    <div className="personal-notes-workspace">
      <aside className="personal-notebook-list">
        <label className="personal-search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索笔记与标签" aria-label="搜索笔记" />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label>
        <div className="personal-folder-controls">
          <button className={!showTrash && folder === '全部笔记' ? 'is-active' : ''} onClick={() => { setShowTrash(false); setFolder('全部笔记'); setTagFilter(''); }}><FolderOpen size={15} />全部笔记<span>{data.notes.filter(n => !n.deletedAt).length}</span></button>
          {folders.map(f => <button key={f} className={!showTrash && folder === f ? 'is-active' : ''} onClick={() => { setShowTrash(false); setFolder(f); }}><Folder size={15} />{f}<span>{data.notes.filter(n => n.folder === f && !n.deletedAt).length}</span></button>)}
          <button className={showTrash ? 'is-active' : ''} onClick={() => { setShowTrash(true); setTagFilter(''); }}><Trash2 size={15} />回收站<span>{data.notes.filter(n => n.deletedAt).length}</span></button>
        </div>
        {allTags.length > 0 && !showTrash && <div className="personal-filter-tags">{allTags.slice(0, 12).map(t => <button key={t} className={tagFilter === t ? 'is-active' : ''} onClick={() => setTagFilter(v => v === t ? '' : t)}>#{t}</button>)}</div>}
        <div className="personal-note-list-label"><span>{showTrash ? '已删除的笔记' : tagFilter ? '#' + tagFilter : folder}</span><span>{filtered.length} 篇</span></div>
        <div className="personal-note-list">
          {filtered.map(n => <button key={n.id} className={'personal-note-card ' + (note?.id === n.id ? 'is-selected' : '')} onClick={() => { setSelectedId(n.id); setPreview(false); }}>
            <div><strong>{n.title || '未命名笔记'}</strong>{n.pinned && <Pin size={12} />}</div>
            <p>{n.body.replace(/[#*>_\x60~]/g, '').slice(0, 85) || (n.source ? '记录你对这篇内容的想法…' : '等待一个想法落下…')}</p>
            <small>{longDate(n.updatedAt)}{n.tags[0] && <span>#{n.tags[0]}</span>}</small>
          </button>)}
          {filtered.length === 0 && <div className="personal-list-empty"><FileText size={22} /><p>{query ? '没有找到匹配的笔记' : showTrash ? '回收站是空的' : '这里还没有笔记'}</p></div>}
        </div>
      </aside>
      <section className="personal-note-editor" aria-label="笔记编辑器">
        {note ? <>
          <div className="personal-editor-toolbar"><SaveState /><div>{!note.deletedAt && <><button className={note.pinned ? 'is-active' : ''} title={note.pinned ? '取消置顶' : '置顶笔记'} aria-label={note.pinned ? '取消置顶' : '置顶笔记'} onClick={() => patch({ pinned: !note.pinned })}><Pin size={16} /></button><button onClick={() => setPreview(v => !v)} className={preview ? 'is-active' : ''}><BookOpen size={15} />{preview ? '继续编辑' : '预览'}</button></>}<button title="导出 Markdown" aria-label="导出此笔记" onClick={exportNote}><Download size={16} /></button>
            {!note.deletedAt && <button title="为这篇笔记创建提醒" aria-label="为笔记创建提醒" onClick={() => { window.location.hash = '/reminders?note=' + encodeURIComponent(note.id); }}><Bell size={16} /></button>}
            {note.deletedAt ? <button onClick={() => { patch({ deletedAt: undefined }); setShowTrash(false); onToast('笔记已恢复'); }}><RotateCcw size={15} />恢复</button> : <button title="移至回收站" aria-label="删除笔记" onClick={() => { patch({ deletedAt: new Date().toISOString() }); onToast('已移至回收站，可随时恢复'); }}><Trash2 size={16} /></button>}</div></div>
          {note.deletedAt && <div className="personal-trash-banner"><span>这篇笔记在回收站中，恢复后可继续编辑。</span><button onClick={() => setConfirmDelete(true)}>永久删除</button></div>}
          {confirmDelete && <div className="personal-delete-confirm" role="alert"><p>永久删除后，只有以前导出的备份可以恢复。</p><button onClick={() => act(() => { personal.update(d => { d.notes = d.notes.filter(n => n.id !== note.id); }); setConfirmDelete(false); onToast('笔记已永久删除'); })}>确认永久删除</button><button onClick={() => setConfirmDelete(false)}>取消</button></div>}
          <div className="personal-note-paper">
            <input className="personal-note-title" aria-label="笔记标题" placeholder="未命名笔记" value={note.title} maxLength={200} disabled={Boolean(note.deletedAt)} onChange={e => patch({ title: e.target.value })} />
            <div className="personal-note-meta"><label><Folder size={14} /><input aria-label="文件夹" placeholder="未分类" list="personal-folders" value={note.folder} maxLength={50} disabled={Boolean(note.deletedAt)} onChange={e => patch({ folder: e.target.value })} /><datalist id="personal-folders">{folders.map(f => <option key={f} value={f} />)}</datalist></label><span>更新于 {longDate(note.updatedAt)}</span></div>
            {note.source && <SourceReference item={note.source} />}
            {preview ? <div className="personal-markdown" dangerouslySetInnerHTML={{ __html: bodyHTML || '<p class="personal-placeholder">空白也可以是一个开始。</p>' }} onClick={e => { const a = (e.target as HTMLElement).closest('a'); if (a && !safeUrl(a.href)) e.preventDefault(); }} /> :
              <textarea ref={textarea} className="personal-note-body" aria-label="笔记正文" placeholder={'写下你的想法…\n\n支持 Markdown：用 # 写标题，用 - 列清单。'} value={note.body} disabled={Boolean(note.deletedAt)} onChange={e => patch({ body: e.target.value })} />}
          </div>
          <div className="personal-editor-footer"><label><Tag size={14} /><input aria-label="笔记标签" value={tagValue} placeholder="添加标签，以逗号分隔" disabled={Boolean(note.deletedAt)} onChange={e => { setTagValue(e.target.value); patch({ tags: [...new Set(e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean))].slice(0, 20) }); }} /></label><span>{note.body.length.toLocaleString()} 字</span></div>
        </> : <div className="personal-editor-empty"><Empty icon={BookOpen} title={showTrash ? '让想法重新回来' : '给今天的阅读，留一点回声'}>{showTrash ? '选择一篇已删除的笔记，即可恢复。' : '新建一篇笔记，或从新闻详情中记录想法。'}</Empty>{!showTrash && <button className="personal-primary" onClick={add}><Plus size={16} />写第一篇笔记</button>}</div>}
      </section>
    </div>
  </>;
}

function Reminders({ onToast, act }: { onToast: Props['onToast']; act: (fn: () => void) => void }) {
  const { data } = usePersonal();
  const [filter, setFilter] = useState('未完成');
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [due, setDue] = useState(shanghaiInput(new Date(Date.now() + 3_600_000).toISOString()));
  const [recurrence, setRecurrence] = useState<Recurrence>('once');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [linkedNote, setLinkedNote] = useState<string | undefined>();
  const dueCount = data.reminders.filter(r => isDue(r)).length;
  const today = shanghaiInput().slice(0, 10);
  const list = data.reminders.filter(r => filter === '已完成' ? Boolean(r.completedAt) : !r.completedAt &&
    (filter === '已逾期' ? isDue(r) : filter === '今天' ? shanghaiInput(r.dueAt).slice(0, 10) === today : true))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  function openForm(r?: Reminder) {
    setEditing(r?.id ?? null); setTitle(r?.title ?? ''); setBody(r?.body ?? ''); setLinkedNote(r?.noteId);
    setDue(shanghaiInput(r?.dueAt ?? new Date(Date.now() + 3_600_000).toISOString())); setRecurrence(r?.recurrence ?? 'once');
    setShowForm(true);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { onToast('先给提醒起一个名字'); return; }
    act(() => {
      const now = new Date().toISOString(); const dueAt = fromShanghaiInput(due);
      personal.update(d => {
        const r = d.reminders.find(r => r.id === editing);
        if (r) Object.assign(r, { title: title.trim(), body, dueAt, recurrence, completedAt: undefined, updatedAt: now, notifiedInstance: undefined, noteId: linkedNote, scheduledAt: undefined });
        else d.reminders.push({ id: createId(), title: title.trim(), body, dueAt, recurrence, createdAt: now, updatedAt: now, noteId: linkedNote });
      });
      setShowForm(false); onToast(editing ? '提醒已更新' : '提醒已添加');
    });
  }
  function complete(r: Reminder) {
    act(() => personal.update(d => {
      const item = d.reminders.find(x => x.id === r.id); if (!item) return;
      Object.assign(item, completeReminder(item));
    }));
    onToast(r.recurrence === 'once' ? '又完成了一件事' : '本次已完成，已安排下一次');
  }
  function snooze(r: Reminder, minutes: number) {
    act(() => personal.update(d => { const item = d.reminders.find(x => x.id === r.id); if (item) Object.assign(item, snoozeReminder(item, minutes)); }));
    onToast('已延后 ' + (minutes >= 60 ? '1 小时' : minutes + ' 分钟'));
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('note');
    const note = data.notes.find(n => n.id === id && !n.deletedAt);
    if (note) { openForm(); setTitle(note.title ? '重读：' + note.title : '整理这篇笔记'); setLinkedNote(note.id); }
  }, []);
  usePersonalDialog(showForm, () => setShowForm(false));
  return <>
    <div className="personal-page-head"><div><p className="personal-eyebrow">给重要的事，一个恰好的时刻</p><h1>记事提醒{dueCount > 0 && <span>{dueCount} 项待处理</span>}</h1><p>不用一直记着，把注意力留给眼前。</p></div><button className="personal-primary" onClick={() => openForm()}><Plus size={17} />新建提醒</button></div>
    <div className="personal-reminder-layout">
      <section className="personal-reminder-main">
        <div className="personal-tabs">{['未完成', '今天', '已逾期', '已完成'].map(f => <button key={f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>{f}{f === '已逾期' && dueCount > 0 && <span>{dueCount}</span>}</button>)}</div>
        <div className="personal-reminder-list">{list.map(r => <article key={r.id} className={'personal-reminder-item ' + (isDue(r) ? 'is-overdue' : '')}>
          <button className={'personal-check ' + (r.completedAt ? 'is-done' : '')} aria-label={r.completedAt ? '重新打开提醒' : '完成提醒：' + r.title} onClick={() => r.completedAt ? act(() => personal.update(d => { const item = d.reminders.find(x => x.id === r.id); if (item) { item.completedAt = undefined; item.updatedAt = new Date().toISOString(); item.notifiedInstance = undefined; } })) : complete(r)}>{r.completedAt && <Check size={15} />}</button>
          <div className="personal-reminder-content"><h3>{r.title}</h3>{r.body && <p>{r.body}</p>}<div className="personal-reminder-meta"><span className={isDue(r) ? 'is-overdue' : ''}><Clock3 size={13} />{longDate(r.dueAt)}</span>{r.recurrence !== 'once' && <span><RotateCcw size={12} />{recurrenceName[r.recurrence]}</span>}{r.completedAt && <span><Check size={13} />已完成</span>}</div>
            <div className="personal-reminder-actions">{r.noteId && <a href={'#/notes?id=' + encodeURIComponent(r.noteId)}>查看笔记</a>}{!r.completedAt && <><button onClick={() => snooze(r, 10)}>延后 10 分钟</button><button onClick={() => snooze(r, 60)}>延后 1 小时</button></>}<button onClick={() => openForm(r)}>编辑</button><button onClick={() => setDeleteId(r.id)}>{deleteId === r.id ? '取消删除' : '删除'}</button>{deleteId === r.id && <button className="personal-danger" onClick={() => act(() => { personal.update(d => { d.reminders = d.reminders.filter(x => x.id !== r.id); }); setDeleteId(null); onToast('提醒已删除'); })}>确认删除</button>}</div>
          </div>
        </article>)}
          {list.length === 0 && <Empty icon={filter === '已完成' ? CheckCheck : Bell} title={filter === '已逾期' ? '没有遗漏，刚刚好' : filter === '已完成' ? '完成的事会留在这里' : '给重要的事留个位置'}>添加提醒，到期时书房会提醒你。</Empty>}
        </div>
      </section>
      <aside className="personal-reminder-aside"><div className="personal-aside-illustration"><BellRing size={34} strokeWidth={1.2} /></div><h3>轻轻提醒，不打扰</h3><p>网页打开时，到期事项会在站内提示。重新进入时，也会汇总你遗漏的事项。</p><p>关闭网页后无法保证准点提醒。需要更可靠的提醒，可导出到手机或电脑的日历。</p><button className="personal-secondary" onClick={() => { download(reminderCalendar(data.reminders), '信息书房-提醒.ics', 'text/calendar;charset=utf-8'); onToast('日历文件已导出，导入常用日历后检查通知设置'); }}><Download size={15} />导出到日历</button><small>个人提醒时区：北京时间 UTC+8<br />“周一至周五”不包含法定调休规则</small></aside>
    </div>
    {showForm && <div className="personal-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowForm(false); }}><section className="personal-modal" role="dialog" aria-modal="true" aria-labelledby="personal-reminder-title"><form onSubmit={save}><div className="personal-modal-heading"><h2 id="personal-reminder-title">{editing ? '编辑提醒' : '新建提醒'}</h2><button type="button" aria-label="关闭" onClick={() => setShowForm(false)}><X size={20} /></button></div><label>提醒我<input autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：整理本周的阅读笔记" /></label><label>备注<textarea value={body} onChange={e => setBody(e.target.value)} placeholder="补充一点细节…" rows={3} /></label><div className="personal-form-grid"><label>时间 · 北京时间<input required type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label><label>重复<select value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}>{Object.entries(recurrenceName).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div><div className="personal-modal-actions"><button type="button" onClick={() => setShowForm(false)}>取消</button><button className="personal-primary" type="submit"><Check size={16} />保存提醒</button></div></form></section></div>}
  </>;
}

function Settings({ onToast, act, sources }: { onToast: Props['onToast']; act: (fn: () => void) => void; sources: Source[] }) {
  const { data, status } = usePersonal(); const p = data.preferences;
  const [keywords, setKeywords] = useState(p.blockedKeywords.join('，'));
  const [incoming, setIncoming] = useState<PersonalData | null>(null);
  const [filename, setFilename] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  usePersonalDialog(Boolean(incoming), () => setIncoming(null));
  const fileInput = useRef<HTMLInputElement>(null);
  const prefs = (value: Partial<typeof p>) => act(() => personal.setPrefs(value));
  function exportAll() {
    act(() => {
      const now = new Date().toISOString(); personal.update(d => { d.lastExportAt = now; });
      download(JSON.stringify({ format: 'information-study-backup', version: 1, exportedAt: now, data: personal.getData() }, null, 2), '信息书房-备份-' + shanghaiInput(now).slice(0, 10) + '.json');
      onToast('完整备份已导出，请保存在可靠的位置');
    });
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20_000_000) throw new Error('文件超过 20MB，暂时无法导入');
      const parsed = parseBackup(await file.text());
      setIncoming(parsed); setFilename(file.name); setConfirmReplace(false); setImportMode('merge');
    } catch (error) { onToast(error instanceof Error ? error.message : '备份文件无法读取'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  function importAll() {
    if (!incoming) return;
    if (importMode === 'replace' && !confirmReplace) { setConfirmReplace(true); return; }
    act(() => {
      const next = importMode === 'merge' ? mergeBackup(personal.getData(), incoming) : incoming;
      personal.update(d => Object.assign(d, next)); setIncoming(null); setConfirmReplace(false);
      setKeywords(next.preferences.blockedKeywords.join('，'));
      onToast(importMode === 'merge' ? '备份已合并，内容不同的同名记录保留为副本' : '备份已恢复');
    });
  }
  async function enableNotifications() {
    if (!('Notification' in window)) { onToast('此浏览器暂不支持系统通知，站内提醒仍可使用'); return; }
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') { prefs({ notificationsEnabled: true }); onToast('系统通知已启用，网页关闭后仍无法保证准点送达'); }
      else { prefs({ notificationsEnabled: false }); onToast(result === 'denied' ? '通知被浏览器阻止，可在站点权限中重新开启' : '尚未授权通知，站内提醒仍然可用'); }
    } catch { onToast('未能启用系统通知，站内提醒不受影响'); }
  }
  const notificationGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  return <>
    <div className="personal-page-head"><div><p className="personal-eyebrow">以你舒服的方式</p><h1>书房设置</h1><p>让阅读、整理和提醒，贴合你的习惯。</p></div><SaveState /></div>
    <div className="personal-settings-grid">
      <section className="personal-settings-section"><div className="personal-section-title"><Settings2 size={19} /><div><h2>阅读与外观</h2><p>好看的同时，也让眼睛舒服。</p></div></div>
        <div className="personal-setting-row"><div><strong>主题</strong><span>在不同光线下，保持清楚舒适。</span></div><div className="personal-segmented">{([['dark', '深色', Moon], ['light', '浅色', Sun], ['system', '系统', Monitor]] as const).map(([value, label, Icon]) => <button key={value} className={p.theme === value ? 'is-active' : ''} onClick={() => prefs({ theme: value })}><Icon size={14} />{label}</button>)}</div></div>
        <div className="personal-setting-row"><div><strong>列表密度</strong><span>更宽松地阅读，或一次看更多内容。</span></div><select aria-label="列表密度" value={p.density} onChange={e => prefs({ density: e.target.value as typeof p.density })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></div>
        <div className="personal-setting-row"><div><strong>正文大小</strong><span>专注阅读模式的默认字号。</span></div><label className="personal-range"><input type="range" min={16} max={24} step={1} aria-label="正文字号" value={p.fontSize} onChange={e => prefs({ fontSize: Number(e.target.value) })} /><span>{p.fontSize}px</span></label></div>
        <div className="personal-setting-row"><div><strong>阅读宽度</strong><span>找到适合自己的每行长度。</span></div><select aria-label="阅读宽度" value={p.readerWidth} onChange={e => prefs({ readerWidth: e.target.value as typeof p.readerWidth })}><option value="narrow">窄</option><option value="standard">标准</option><option value="wide">宽</option></select></div>
        <div className="personal-setting-row"><div><strong>减少动态效果</strong><span>淡化页面过渡，专注内容本身。</span></div><button className={'personal-switch ' + (p.reducedMotion ? 'is-on' : '')} role="switch" aria-checked={p.reducedMotion} aria-label="减少动态效果" onClick={() => prefs({ reducedMotion: !p.reducedMotion })}><span /></button></div>
      </section>
      <section className="personal-settings-section"><div className="personal-section-title"><ShieldCheck size={19} /><div><h2>我的数据</h2><p>资料留在此浏览器，由你保存和带走。</p></div></div>
        <div className="personal-data-counts"><div><strong>{data.notes.filter(n => !n.deletedAt).length}</strong><span>篇笔记</span></div><div><strong>{data.saved.length}</strong><span>条收藏与稍后读</span></div><div><strong>{data.reminders.filter(r => !r.completedAt).length}</strong><span>项提醒</span></div></div>
        <p className="personal-setting-description">完整备份包含笔记、收藏、提醒、阅读偏好、自选与游戏存档。清除站点数据、换浏览器或更换域名后，需要手动导入恢复。</p>
        <div className="personal-data-actions"><button className="personal-primary" onClick={exportAll}><Download size={16} />导出完整备份</button><button className="personal-secondary" onClick={() => fileInput.current?.click()}><Upload size={16} />导入备份</button><input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={e => void chooseFile(e.target.files?.[0])} /></div>
        <small className="personal-backup-note">{data.lastExportAt ? '最近导出：' + longDate(data.lastExportAt) : '还没有导出过备份，建议定期保存一份。'}<br />备份文件未加密，请妥善保存。{status === 'error' && ' 当前未保存草稿也会包含在导出中。'}</small>
      </section>
      <section className="personal-settings-section"><div className="personal-section-title"><Bell size={19} /><div><h2>提醒通知</h2><p>只在你允许时，发送系统通知。</p></div></div>
        <div className="personal-setting-row"><div><strong>系统通知</strong><span>{p.notificationsEnabled && notificationGranted ? '已启用；网页运行时尝试送达。' : '尚未启用，站内提醒仍可使用。'}</span></div>{p.notificationsEnabled && notificationGranted ? <button className="personal-secondary" onClick={() => prefs({ notificationsEnabled: false })}>关闭</button> : <button className="personal-secondary" onClick={() => void enableNotifications()}>启用通知</button>}</div>
        <p className="personal-setting-description">设备休眠、后台节流或关闭网页会影响提醒。需要关闭网站后提醒时，请将事项导出到常用日历，并检查日历通知权限。</p><a className="personal-text-link" href="#/reminders">管理我的提醒<ChevronRight size={14} /></a>
      </section>
      <section className="personal-settings-section"><div className="personal-section-title"><Tag size={19} /><div><h2>内容偏好</h2><p>给信息留一点选择的空间。</p></div></div>
        <label className="personal-full-label">屏蔽关键词<textarea value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="以逗号分隔，例如：剧透，某个话题" rows={3} /></label><div className="personal-inline-actions"><small>匹配标题和摘要，不影响已经保存的笔记。</small><button className="personal-secondary" onClick={() => { prefs({ blockedKeywords: [...new Set(keywords.split(/[,，\n]/).map(s => s.trim()).filter(Boolean))] }); onToast('关键词偏好已保存'); }}>保存关键词</button></div>
      </section>
      <section className="personal-settings-section personal-settings-wide"><div className="personal-section-title"><BookOpen size={19} /><div><h2>信息来源</h2><p>关闭的来源会从公共信息流隐藏，已收藏内容仍保留。</p></div></div>
        <div className="personal-source-list">{sources.length ? sources.map(source => <div className="personal-source-row" key={source.id}><div><strong>{source.label}</strong><small>{source.lastSuccessAt ? '最近成功获取：' + longDate(source.lastSuccessAt) : source.status === 'external' ? '通过原站查看' : '尚无成功获取记录'}</small></div><button className={'personal-switch ' + (!p.disabledSources.includes(source.id) ? 'is-on' : '')} role="switch" aria-checked={!p.disabledSources.includes(source.id)} aria-label={'显示来源：' + source.label} onClick={() => prefs({ disabledSources: p.disabledSources.includes(source.id) ? p.disabledSources.filter(s => s !== source.id) : [...p.disabledSources, source.id] })}><span /></button></div>) : <p className="personal-setting-description">加载信息快照后，可在这里管理来源。</p>}</div>
      </section>
    </div>
    {incoming && <div className="personal-modal-backdrop"><section className="personal-modal" role="dialog" aria-modal="true" aria-labelledby="personal-import-title"><div className="personal-modal-heading"><h2 id="personal-import-title">导入备份</h2><button aria-label="关闭导入预览" onClick={() => setIncoming(null)}><X size={20} /></button></div><p className="personal-import-file">{filename}</p><div className="personal-data-counts"><div><strong>{incoming.notes.length}</strong><span>篇笔记</span></div><div><strong>{incoming.saved.length}</strong><span>条保存内容</span></div><div><strong>{incoming.reminders.length}</strong><span>项提醒</span></div></div><label className="personal-full-label">恢复方式<select value={importMode} onChange={e => { setImportMode(e.target.value as 'merge' | 'replace'); setConfirmReplace(false); }}><option value="merge">合并到现有资料</option><option value="replace">完整替换现有资料</option></select></label><p className="personal-setting-description">{importMode === 'merge' ? '笔记内容冲突时保留导入副本。偏好和游戏存档使用备份中的版本，收藏与提醒按记录合并。' : '将替换当前浏览器中的全部个人资料。建议先导出一份现有备份。'}</p>{confirmReplace && <p className="personal-import-warning" role="alert">再次确认后将替换现有资料，此操作不能撤销。</p>}<div className="personal-modal-actions"><button onClick={() => setIncoming(null)}>取消</button><button className="personal-primary" onClick={importAll}>{confirmReplace ? '确认替换全部资料' : '开始导入'}</button></div></section></div>}
  </>;
}

export function ReminderNotifier({ onToast }: { onToast: (s: string) => void }) {
  const { data, status } = usePersonal();
  const latest = useRef({ data, status, onToast });
  latest.current = { data, status, onToast };
  const sessionSeen = useRef(new Set<string>());
  useEffect(() => {
    let checking = false;
    const check = async () => {
      const current = latest.current;
      if (current.status === 'loading' || document.hidden || checking) return;
      const due = current.data.reminders.filter(r => isDue(r) && r.notifiedInstance !== instanceId(r) && !sessionSeen.current.has(instanceId(r)));
      if (!due.length) return;
      checking = true;
      try {
        const notify = () => {
          const fresh = due.filter(r => {
            const item = personal.getData().reminders.find(x => x.id === r.id);
            return item && isDue(item) && item.notifiedInstance !== instanceId(item);
          });
          if (!fresh.length) return;
          fresh.forEach(r => sessionSeen.current.add(instanceId(r)));
          personal.update(draft => { fresh.forEach(r => { const item = draft.reminders.find(x => x.id === r.id); if (item) item.notifiedInstance = instanceId(item); }); });
          const message = fresh.length === 1 ? '到时间了：' + fresh[0].title : '有 ' + fresh.length + ' 项提醒待处理，去提醒中心看看';
          current.onToast(message);
          if (current.data.preferences.notificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { const notification = new Notification('信息书房 · 记事提醒', { body: message, tag: 'study-reminder-' + fresh.map(r => r.id).join('-') });
              notification.onclick = () => { window.focus(); window.location.hash = '/reminders'; notification.close(); };
            } catch { /* Unsupported mobile constructor leaves the in-page reminder fully usable. */ }
          }
        };
        if (navigator.locks) await navigator.locks.request('information-study-reminders', async () => { await personal.flush(); notify(); await personal.flush(); });
        else notify();
      } finally { checking = false; }
    };
    const interval = setInterval(() => void check(), 15_000);
    const visible = () => { if (!document.hidden) void check(); };
    const conflict = () => latest.current.onToast('检测到其他标签页的不同修改，已保留冲突笔记副本');
    document.addEventListener('visibilitychange', visible); window.addEventListener('personal-conflict', conflict);
    void check();
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible); window.removeEventListener('personal-conflict', conflict); };
  }, []);
  return null;
}

import type { ContentItem } from '../types';

export interface Note {
  id: string; title: string; body: string; folder: string; tags: string[];
  source?: ContentItem; createdAt: string; updatedAt: string; deletedAt?: string;
  pinned?: boolean;
}
export type Recurrence = 'once' | 'daily' | 'weekly' | 'weekdays';
export interface Reminder {
  id: string; title: string; body: string; dueAt: string; recurrence: Recurrence;
  completedAt?: string; createdAt: string; updatedAt: string; lastCompletedAt?: string;
  notifiedInstance?: string;
  noteId?: string;
  scheduledAt?: string;
}
export interface Preferences {
  theme: 'dark' | 'light' | 'system'; reducedMotion: boolean;
  density: 'comfortable' | 'compact'; fontSize: number;
  readerWidth: 'narrow' | 'standard' | 'wide'; blockedKeywords: string[];
  disabledSources: string[]; watchlist: string[]; notificationsEnabled?: boolean;
}
export interface PersonalData {
  schemaVersion: 1; notes: Note[]; reminders: Reminder[];
  saved: { id: string; item: ContentItem; kind: 'favorite' | 'later'; createdAt: string }[];
  readIds: string[]; preferences: Preferences; gameSave: unknown;
  lastExportAt?: string;
}
export const createId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
export function emptyPersonal(): PersonalData {
  return { schemaVersion: 1, notes: [], reminders: [], saved: [], readIds: [],
    preferences: { theme: 'light', reducedMotion: false, density: 'comfortable', fontSize: 18,
      readerWidth: 'standard', blockedKeywords: [], disabledSources: [], watchlist: [] },
    gameSave: null };
}
export const instanceId = (r: Reminder) => r.id + ':' + r.dueAt;
export const isDue = (r: Reminder, now = Date.now()) => !r.completedAt && new Date(r.dueAt).getTime() <= now;

/** Personal reminders use a fixed Asia/Shanghai calendar, never the host timezone. */
export function nextOccurrence(dueAt: string, recurrence: Recurrence, after = Date.now()): string | undefined {
  if (recurrence === 'once') return undefined;
  let next = Date.parse(dueAt);
  if (!Number.isFinite(next)) throw new Error('提醒时间无效');
  const day = 86_400_000;
  if (recurrence === 'weekly') {
    next += Math.max(1, Math.floor((after - next) / (7 * day)) + 1) * 7 * day;
  } else {
    next += Math.max(1, Math.floor((after - next) / day) + 1) * day;
    if (recurrence === 'weekdays') {
      while ([0, 6].includes(new Date(next + 8 * 3_600_000).getUTCDay())) next += day;
    }
  }
  return new Date(next).toISOString();
}
export function shanghaiInput(iso = new Date().toISOString()) {
  const date = new Date(Date.parse(iso) + 8 * 3_600_000);
  return date.toISOString().slice(0, 16);
}
export function fromShanghaiInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请选择有效的日期和时间');
  const iso = new Date(value + ':00+08:00');
  if (!Number.isFinite(iso.getTime())) throw new Error('提醒时间无效');
  return iso.toISOString();
}
export function completeReminder(reminder: Reminder, now = Date.now()): Reminder {
  const at = new Date(now).toISOString();
  const next = nextOccurrence(reminder.scheduledAt ?? reminder.dueAt, reminder.recurrence, now);
  return next ? { ...reminder, dueAt: next, lastCompletedAt: at, notifiedInstance: undefined,
    scheduledAt: undefined, updatedAt: at } : { ...reminder, completedAt: at, updatedAt: at };
}
export function snoozeReminder(reminder: Reminder, minutes: number, now = Date.now()): Reminder {
  return { ...reminder, dueAt: new Date(now + minutes * 60_000).toISOString(),
    scheduledAt: reminder.scheduledAt ?? reminder.dueAt, notifiedInstance: undefined,
    updatedAt: new Date(now).toISOString() };
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function str(x: unknown, field: string, max = 20_000): string {
  if (typeof x !== 'string' || x.length > max) throw new Error('备份字段无效：' + field);
  return x;
}
function strings(x: unknown, field: string): string[] {
  if (!Array.isArray(x) || x.length > 20_000 || !x.every(s => typeof s === 'string' && s.length < 2000))
    throw new Error('备份列表无效：' + field);
  return [...new Set(x as string[])];
}
function timestamp(x: unknown, field: string): string {
  const text = str(x, field, 100);
  if (!Number.isFinite(Date.parse(text))) throw new Error('备份时间无效：' + field);
  return new Date(text).toISOString();
}
export function safeUrl(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  try { const url = new URL(x); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}
function content(x: unknown): ContentItem {
  if (!record(x) || !safeUrl(x.url)) throw new Error('备份引用链接无效');
  const channels = ['国内', '国际', '科技', '趣事', '财经'];
  const kinds = ['article', 'video', 'topic'];
  if (!channels.includes(String(x.channel)) || !kinds.includes(String(x.kind))) throw new Error('备份内容类型无效');
  return {
    id: str(x.id, '内容ID', 2000), sourceId: str(x.sourceId, '来源', 1000),
    title: str(x.title, '内容标题'), url: safeUrl(x.url)!, channel: x.channel as ContentItem['channel'],
    kind: x.kind as ContentItem['kind'], fetchedAt: timestamp(x.fetchedAt, '获取时间'),
    ...(typeof x.description === 'string' ? { description: str(x.description, '摘要', 500_000) } : {}),
    ...(safeUrl(x.image) ? { image: safeUrl(x.image) } : {}),
    ...(typeof x.publishedAt === 'string' ? { publishedAt: timestamp(x.publishedAt, '发布时间') } : {}),
    ...(typeof x.author === 'string' ? { author: str(x.author, '作者') } : {}),
    ...(typeof x.bvid === 'string' && /^BV[A-Za-z0-9]+$/.test(x.bvid) ? { bvid: x.bvid } : {}),
    ...(typeof x.rank === 'number' && Number.isFinite(x.rank) ? { rank: x.rank } : {}),
    ...(typeof x.heat === 'string' ? { heat: str(x.heat, '热度') } : {}),
    ...(typeof x.body === 'string' && x.bodyAllowed === true ? { body: str(x.body, '正文', 2_000_000), bodyAllowed: true } : {}),
  };
}
export function parseBackup(text: string): PersonalData {
  if (text.length > 20_000_000) throw new Error('备份超过 20MB，请拆分后再导入');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('无法读取备份，请选择本站导出的 JSON 文件'); }
  if (record(parsed) && parsed.format === 'information-study-backup') parsed = parsed.data;
  if (!record(parsed) || parsed.schemaVersion !== 1) throw new Error('不支持的备份版本，请使用版本 1 备份');
  for (const name of ['notes', 'reminders', 'saved']) {
    if (!Array.isArray(parsed[name]) || parsed[name].length > 20_000) throw new Error('备份列表无效：' + name);
  }
  const notes: Note[] = (parsed.notes as unknown[]).map(x => {
    if (!record(x)) throw new Error('笔记格式无效');
    return { id: str(x.id, '笔记ID', 1000), title: str(x.title, '笔记标题'), body: str(x.body, '笔记正文', 2_000_000),
      folder: str(x.folder, '文件夹', 1000), tags: strings(x.tags, '标签'), createdAt: timestamp(x.createdAt, '创建时间'),
      updatedAt: timestamp(x.updatedAt, '修改时间'), ...(x.source ? { source: content(x.source) } : {}),
      ...(x.deletedAt ? { deletedAt: timestamp(x.deletedAt, '删除时间') } : {}), pinned: x.pinned === true };
  });
  const reminders: Reminder[] = (parsed.reminders as unknown[]).map(x => {
    if (!record(x) || !['once', 'daily', 'weekly', 'weekdays'].includes(String(x.recurrence))) throw new Error('提醒规则无效');
    return { id: str(x.id, '提醒ID', 1000), title: str(x.title, '提醒标题'), body: str(x.body, '提醒备注'),
      dueAt: timestamp(x.dueAt, '到期时间'), recurrence: x.recurrence as Recurrence,
      createdAt: timestamp(x.createdAt, '创建时间'), updatedAt: timestamp(x.updatedAt, '修改时间'),
      ...(x.completedAt ? { completedAt: timestamp(x.completedAt, '完成时间') } : {}),
      ...(x.lastCompletedAt ? { lastCompletedAt: timestamp(x.lastCompletedAt, '上次完成时间') } : {}),
      ...(typeof x.notifiedInstance === 'string' ? { notifiedInstance: str(x.notifiedInstance, '通知实例', 2000) } : {}),
      ...(typeof x.noteId === 'string' ? { noteId: str(x.noteId, '关联笔记', 1000) } : {}),
      ...(x.scheduledAt ? { scheduledAt: timestamp(x.scheduledAt, '原定时间') } : {}) };
  });
  const saved: PersonalData['saved'] = (parsed.saved as unknown[]).map(x => {
    if (!record(x) || !['favorite', 'later'].includes(String(x.kind))) throw new Error('收藏格式无效');
    return { id: str(x.id, '收藏ID', 2000), item: content(x.item), kind: x.kind as 'favorite' | 'later',
      createdAt: timestamp(x.createdAt, '收藏时间') };
  });
  if (!record(parsed.preferences)) throw new Error('偏好设置格式无效');
  const p = parsed.preferences;
  if (!['dark', 'light', 'system'].includes(String(p.theme)) ||
      !['comfortable', 'compact'].includes(String(p.density)) ||
      !['narrow', 'standard', 'wide'].includes(String(p.readerWidth)) ||
      typeof p.fontSize !== 'number' || p.fontSize < 16 || p.fontSize > 24)
    throw new Error('偏好设置数值无效');
  const preferences: Preferences = {
    theme: p.theme as Preferences['theme'], reducedMotion: p.reducedMotion === true,
    density: p.density as Preferences['density'], fontSize: p.fontSize,
    readerWidth: p.readerWidth as Preferences['readerWidth'],
    blockedKeywords: strings(p.blockedKeywords, '屏蔽词'), disabledSources: strings(p.disabledSources, '来源'),
    watchlist: strings(p.watchlist, '自选'), notificationsEnabled: p.notificationsEnabled === true,
  };
  for (const values of [notes.map(n => n.id), reminders.map(r => r.id), saved.map(s => s.kind + s.id)]) {
    if (new Set(values).size !== values.length) throw new Error('备份含重复 ID，请使用未修改的导出文件');
  }
  return { schemaVersion: 1, notes, reminders, saved, readIds: strings(parsed.readIds, '已读'),
    preferences, gameSave: parsed.gameSave ?? null,
    ...(typeof parsed.lastExportAt === 'string' ? { lastExportAt: timestamp(parsed.lastExportAt, '导出时间') } : {}) };
}
export function mergeBackup(current: PersonalData, incoming: PersonalData): PersonalData {
  const result = structuredClone(current);
  for (const note of incoming.notes) {
    const old = result.notes.find(n => n.id === note.id);
    if (!old) result.notes.push(note);
    else if (old.body !== note.body || old.title !== note.title) {
      result.notes.push({ ...note, id: createId(), title: (note.title || '未命名笔记') + '（导入副本）' });
    } else if (note.updatedAt > old.updatedAt) Object.assign(old, note);
  }
  for (const reminder of incoming.reminders) {
    const old = result.reminders.find(r => r.id === reminder.id);
    if (!old) result.reminders.push(reminder);
    else if (reminder.updatedAt > old.updatedAt) Object.assign(old, reminder);
  }
  const saved = new Map(result.saved.map(s => [s.kind + ':' + s.id, s]));
  incoming.saved.forEach(s => saved.set(s.kind + ':' + s.id, s));
  result.saved = [...saved.values()];
  result.readIds = [...new Set([...result.readIds, ...incoming.readIds])];
  result.preferences = { ...incoming.preferences,
    blockedKeywords: [...new Set([...current.preferences.blockedKeywords, ...incoming.preferences.blockedKeywords])],
    watchlist: [...new Set([...current.preferences.watchlist, ...incoming.preferences.watchlist])] };
  result.gameSave = incoming.gameSave ?? current.gameSave;
  return result;
}

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icsDate = (s: string) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function reminderCalendar(reminders: Reminder[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Information Study//Reminders//ZH', 'CALSCALE:GREGORIAN'];
  for (const r of reminders.filter(r => !r.completedAt)) {
    lines.push('BEGIN:VEVENT', 'UID:' + r.id + '@information-study.local', 'DTSTAMP:' + icsDate(r.updatedAt),
      'DTSTART:' + icsDate(r.dueAt), 'SUMMARY:' + icsEscape(r.title), 'DESCRIPTION:' + icsEscape(r.body));
    if (r.recurrence === 'daily') lines.push('RRULE:FREQ=DAILY');
    if (r.recurrence === 'weekly') lines.push('RRULE:FREQ=WEEKLY');
    if (r.recurrence === 'weekdays') lines.push('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(r.title), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const encoder = new TextEncoder();
  const folded = lines.map(line => {
    const out: string[] = []; let chunk = ''; let bytes = 0;
    for (const char of line) {
      const count = encoder.encode(char).length;
      if (bytes + count > 73) { out.push(chunk); chunk = ' '; bytes = 1; }
      chunk += char; bytes += count;
    }
    out.push(chunk); return out.join('\r\n');
  });
  return folded.join('\r\n') + '\r\n';
}

import { useSyncExternalStore } from 'react';
import type { ContentItem } from '../types';
import { createId, emptyPersonal, parseBackup } from './personal-model';
import type { PersonalData, Preferences } from './personal-model';
export type { PersonalData, Preferences, Note, Reminder, Recurrence } from './personal-model';
export { parseBackup, mergeBackup } from './personal-model';

type State = { data: PersonalData; status: 'loading' | 'saved' | 'saving' | 'error'; error?: string };
type Persisted = { revision: number; writer: string; data: PersonalData };
export function canApplyRemoteRead(startVersion: number, currentVersion: number, status: State['status'], incomingRevision: number, currentRevision: number) {
  return status === 'saved' && currentVersion === startVersion && incomingRevision > currentRevision;
}
export function chooseReconciledGameSave(local: unknown, remote: unknown, ancestor: unknown) {
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const localChanged = !equal(local, ancestor);
  const conflict = localChanged && !equal(remote, ancestor) && !equal(local, remote);
  // A queued simulation checkpoint must never overwrite a newly imported/remote save.
  return { value: localChanged && !conflict ? local : remote, conflict };
}
let state: State = { data: emptyPersonal(), status: 'loading' };
let base = structuredClone(state.data);
let revision = 0;
let version = 0;
let db: IDBDatabase | undefined;
let saveChain = Promise.resolve();
let initPromise: Promise<void> | undefined;
let channel: BroadcastChannel | undefined;
const writer = createId();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const clone = <T,>(value: T): T => structuredClone(value);
function openDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('此浏览器无法使用本地数据库，当前内容仅留在内存中，请及时导出')); return; }
    const request = indexedDB.open('information-study-personal', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('personal')) request.result.createObjectStore('personal');
    };
    request.onerror = () => reject(new Error('本地数据库未能打开，请检查浏览器的存储权限并导出当前草稿'));
    request.onblocked = () => reject(new Error('本地数据库正在被其他页面升级，请关闭旧标签页后重试'));
    request.onsuccess = () => resolve(request.result);
  });
}
function readRecord(database: IDBDatabase) {
  return new Promise<Persisted | undefined>((resolve, reject) => {
    const req = database.transaction('personal').objectStore('personal').get('state');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('未能读取已有资料，请暂勿清除浏览器数据'));
  });
}
/** Three-way merge preserves another tab's changes and forks genuinely conflicting notes. */
function reconcile(local: PersonalData, remote: PersonalData, ancestor: PersonalData, onGameConflict?: () => void) {
  const result = clone(remote);
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const localNote of local.notes) {
    const old = ancestor.notes.find(n => n.id === localNote.id);
    if (equal(localNote, old)) continue;
    const other = result.notes.find(n => n.id === localNote.id);
    if (other && old && !equal(other, old) && !equal(other, localNote)) {
      result.notes.push({ ...localNote, id: createId(), title: (localNote.title || '未命名笔记') + '（冲突副本）' });
    } else if (other) Object.assign(other, localNote);
    else result.notes.push(localNote);
  }
  const localIds = new Set(local.notes.map(n => n.id));
  result.notes = result.notes.filter(n => !ancestor.notes.some(a => a.id === n.id) || localIds.has(n.id) || !equal(n, ancestor.notes.find(a => a.id === n.id)));
  for (const field of ['reminders', 'saved'] as const) {
    const key = (x: PersonalData[typeof field][number]) => field === 'saved' ? ('kind' in x ? x.kind : '') + x.id : x.id;
    const remoteMap = new Map<string, any>((result[field] as any[]).map(x => [key(x), x]));
    const oldMap = new Map<string, any>((ancestor[field] as any[]).map(x => [key(x), x]));
    const localMap = new Map<string, any>((local[field] as any[]).map(x => [key(x), x]));
    for (const [id, value] of localMap) if (!equal(value, oldMap.get(id))) remoteMap.set(id, value);
    for (const [id, old] of oldMap) if (!localMap.has(id) && equal(remoteMap.get(id), old)) remoteMap.delete(id);
    (result as any)[field] = [...remoteMap.values()];
  }
  for (const key of Object.keys(local.preferences) as (keyof Preferences)[]) {
    if (!equal(local.preferences[key], ancestor.preferences[key])) (result.preferences as any)[key] = local.preferences[key];
  }
  result.readIds = [...new Set([...local.readIds, ...remote.readIds])];
  const game = chooseReconciledGameSave(local.gameSave, remote.gameSave, ancestor.gameSave);
  result.gameSave = game.value;
  if (game.conflict) onGameConflict?.();
  if (local.lastExportAt) result.lastExportAt = local.lastExportAt;
  return result;
}
async function persist() {
  const ownVersion = version;
  if (!db) {
    state = { ...state, status: 'error', error: state.error ?? '本地保存不可用，当前草稿仍可导出' }; emit(); return;
  }
  const local = clone(state.data);
  const previous = clone(base);
  const expected = revision;
  let gameConflict = false;
  try {
    const result = await new Promise<Persisted>((resolve, reject) => {
      const transaction = db!.transaction('personal', 'readwrite');
      const store = transaction.objectStore('personal');
      let row: Persisted;
      const req = store.get('state');
      req.onsuccess = () => {
        try {
          const current = req.result as Persisted | undefined;
          let data = local;
          if (current && current.revision !== expected && current.writer !== writer) {
            data = reconcile(local, parseBackup(JSON.stringify(current.data)), previous, () => { gameConflict = true; });
          }
          row = { revision: Math.max(current?.revision ?? 0, expected) + 1, writer, data };
          store.put(row, 'state');
        } catch {
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(row);
      transaction.onerror = () => reject(new Error('保存失败，可能没有可用存储空间；当前草稿已保留，请导出备份'));
      transaction.onabort = () => reject(new Error('本地保存被中断；当前草稿已保留，请导出备份'));
    });
    revision = result.revision;
    base = clone(result.data);
    if (result.data.notes.filter(n => n.title.endsWith('（冲突副本）')).length > local.notes.filter(n => n.title.endsWith('（冲突副本）')).length) {
      window.dispatchEvent(new Event('personal-conflict'));
    }
    if (version === ownVersion) state = { data: result.data, status: 'saved' };
    else state = { ...state, data: reconcile(state.data, result.data, local, () => { gameConflict = true; }), status: 'saving' };
    channel?.postMessage({ revision });
    emit();
    if (gameConflict) window.dispatchEvent(new Event('personal-game-conflict'));
  } catch (error) {
    state = { ...state, status: 'error', error: error instanceof Error ? error.message : '保存失败，草稿仍在当前页面' }; emit();
  }
}
function queueSave() {
  saveChain = saveChain.then(persist, persist);
}
export async function initializePersonal() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      db = await openDB();
      const stored = await readRecord(db);
      const data = stored ? parseBackup(JSON.stringify(stored.data)) : emptyPersonal();
      revision = stored?.revision ?? 0; base = clone(data); state = { data, status: 'saved' }; emit();
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('information-study-personal');
        channel.onmessage = async () => {
          if (!db || state.status !== 'saved') return;
          const readVersion = version;
          const remote = await readRecord(db).catch(() => undefined);
          // Reading is asynchronous: editing may have started while IndexedDB was busy.
          // Dirty drafts are reconciled by persist(), never replaced by this read path.
          if (remote && canApplyRemoteRead(readVersion, version, state.status, remote.revision, revision)) {
            try {
              const next = parseBackup(JSON.stringify(remote.data));
              revision = remote.revision; base = clone(next); state = { data: next, status: 'saved' }; emit();
            } catch { /* Invalid external writes never replace a valid in-memory draft. */ }
          }
        };
      }
      db.onversionchange = () => { db?.close(); db = undefined; state = { ...state, status: 'error', error: '数据库已更新，请先导出未保存内容再刷新' }; emit(); };
    } catch (error) {
      db?.close(); db = undefined;
      state = { ...state, status: 'error', error: error instanceof Error ? error.message : '无法读取本地资料' }; emit();
    }
  })();
  return initPromise;
}
export const personal = {
  getData: () => state.data,
  update(mutator: (draft: PersonalData) => void) {
    if (state.status === 'loading') throw new Error('个人资料正在加载，请稍后再试');
    const draft = clone(state.data); mutator(draft); version++;
    state = { data: draft, status: db ? 'saving' : 'error', ...(db ? {} : { error: state.error }) }; emit();
    // Start a write in this event's microtask turn. A debounce here loses discrete
    // actions (complete/save/import) when the user immediately reloads the page.
    queueSave();
  },
  toggleSaved(item: ContentItem, kind: 'favorite' | 'later') {
    this.update(d => {
      const index = d.saved.findIndex(s => s.id === item.id && s.kind === kind);
      if (index >= 0) d.saved.splice(index, 1);
      else d.saved.unshift({ id: item.id, item, kind, createdAt: new Date().toISOString() });
    });
  },
  createNote(item?: ContentItem) {
    const id = createId(); const now = new Date().toISOString();
    this.update(d => d.notes.unshift({ id, title: item?.title ?? '', body: '', folder: '', tags: [],
      ...(item ? { source: item } : {}), createdAt: now, updatedAt: now }));
    return id;
  },
  markRead(id: string) { this.update(d => { if (!d.readIds.includes(id)) d.readIds.push(id); }); },
  setPrefs(partial: Partial<Preferences>) { this.update(d => { d.preferences = { ...d.preferences, ...partial }; }); },
  setGameSave(save: unknown) { this.update(d => { d.gameSave = save; }); },
  flush() { queueSave(); return saveChain; },
};
export function usePersonal() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);
}
if (typeof window !== 'undefined') {
  void initializePersonal();
  window.addEventListener('pagehide', () => { if (state.status === 'saving') queueSave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.status === 'saving') queueSave(); });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeReminder, emptyPersonal, fromShanghaiInput, isDue, mergeBackup, nextOccurrence, parseBackup, reminderCalendar, shanghaiInput, snoozeReminder } from '../src/lib/personal-model';
import type { Note, Reminder } from '../src/lib/personal-model';

const now = '2026-11-11T10:00:00.000Z';
const note = (partial: Partial<Note> = {}): Note => ({
  id: 'n-1', title: '阅读想法', body: '保留自己的文字', folder: '阅读', tags: ['随想'],
  createdAt: now, updatedAt: now, ...partial,
});
const reminder = (partial: Partial<Reminder> = {}): Reminder => ({
  id: 'r-1', title: '整理笔记', body: '复习本周收藏', dueAt: now, recurrence: 'once',
  createdAt: now, updatedAt: now, ...partial,
});
test('Shanghai datetime is independent from host timezone and survives a day boundary', () => {
  assert.equal(fromShanghaiInput('2026-11-12T00:15'), '2026-11-11T16:15:00.000Z');
  assert.equal(shanghaiInput('2026-11-11T16:15:00.000Z'), '2026-11-12T00:15');
  assert.throws(() => fromShanghaiInput('bad-value'));
});
test('overdue daily recurrence advances beyond completion time instead of making a notification storm', () => {
  const due = '2026-11-05T01:00:00.000Z';
  assert.equal(nextOccurrence(due, 'daily', Date.parse('2026-11-11T03:00:00.000Z')), '2026-11-12T01:00:00.000Z');
  assert.equal(nextOccurrence(due, 'once'), undefined);
});
test('weekdays skip Shanghai weekend and weekly recurrence preserves its weekday and clock', () => {
  const friday = '2026-11-13T01:00:00.000Z';
  assert.equal(nextOccurrence(friday, 'weekdays', Date.parse(friday)), '2026-11-16T01:00:00.000Z');
  assert.equal(nextOccurrence(friday, 'weekly', Date.parse('2026-11-29T05:00:00.000Z')), '2026-12-04T01:00:00.000Z');
  assert.equal(isDue(reminder({ completedAt: now }), Date.parse(now) + 1), false);
});
test('snoozing a repeating reminder does not permanently change the scheduled clock', () => {
  const r = reminder({ recurrence: 'daily' });
  const snoozed = snoozeReminder(r, 60, Date.parse(now));
  assert.equal(snoozed.dueAt, '2026-11-11T11:00:00.000Z');
  const completed = completeReminder(snoozed, Date.parse('2026-11-11T11:05:00.000Z'));
  assert.equal(completed.dueAt, '2026-11-12T10:00:00.000Z');
  assert.equal(completed.scheduledAt, undefined);
});
test('complete backup roundtrip preserves notes, recycled records, reminders, preferences and game save', () => {
  const data = emptyPersonal();
  data.notes = [note(), note({ id: 'trash', deletedAt: now })];
  data.reminders = [reminder()];
  data.gameSave = { seed: 29, permanent: { shards: 11 }, offlineClaimedAt: now };
  data.preferences.watchlist = ['AAPL', 'sh000001'];
  const restored = parseBackup(JSON.stringify({ format: 'information-study-backup', version: 1, data }));
  assert.equal(restored.notes.length, 2);
  assert.equal(restored.notes[1].deletedAt, now);
  assert.deepEqual(restored.gameSave, data.gameSave);
  assert.deepEqual(restored.preferences.watchlist, data.preferences.watchlist);
});
test('invalid or future backup fails before it can change current data', () => {
  const data = emptyPersonal(); data.notes = [note()];
  const before = JSON.stringify(data);
  assert.throws(() => parseBackup(JSON.stringify({ ...data, schemaVersion: 2 })), /版本/);
  assert.throws(() => parseBackup(JSON.stringify({ ...data, notes: [note(), note()] })), /重复/);
  assert.throws(() => parseBackup(JSON.stringify({ ...data, reminders: [reminder({ dueAt: 'invalid' })] })), /时间/);
  assert.throws(() => parseBackup(JSON.stringify({ ...data, preferences: { ...data.preferences, fontSize: 500 } })), /数值/);
  assert.equal(JSON.stringify(data), before);
});
test('import rejects executable links rather than allowing a stored unsafe source into the reader', () => {
  const data = emptyPersonal();
  data.notes = [note({ source: { id: 'x', sourceId: 'x', title: 'x', url: 'javascript:alert(1)',
    channel: '国内', kind: 'article', fetchedAt: now } })];
  assert.throws(() => parseBackup(JSON.stringify(data)), /链接/);
});
test('merge preserves conflicting note contents as a copy and deduplicates saved references', () => {
  const a = emptyPersonal(); const b = emptyPersonal();
  a.notes = [note()]; b.notes = [note({ body: '另一台设备上的文字' })];
  const item = { id: 'article', sourceId: 'source', title: '新闻', url: 'https://example.com/article', channel: '国内' as const, kind: 'article' as const, fetchedAt: now };
  a.saved = [{ id: item.id, item, kind: 'favorite', createdAt: now }];
  b.saved = [{ id: item.id, item, kind: 'favorite', createdAt: now }];
  b.gameSave = { seed: 101 };
  const merged = mergeBackup(a, b);
  assert.equal(merged.notes.length, 2);
  assert.equal(merged.notes[0].body, '保留自己的文字');
  assert.match(merged.notes[1].title, /导入副本/);
  assert.equal(merged.saved.length, 1);
  assert.deepEqual(merged.gameSave, b.gameSave);
  assert.equal(a.notes.length, 1);
});
test('calendar exports UTC instants, valid repeat rules and alarms without newline injection', () => {
  const r = reminder({ title: '中文提醒'.repeat(20) + '\nBEGIN:BAD', recurrence: 'weekdays' });
  const calendar = reminderCalendar([r]);
  assert.match(calendar, /DTSTART:20261111T100000Z/);
  assert.match(calendar, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/);
  assert.match(calendar, /BEGIN:VALARM/);
  assert.ok(!calendar.includes('\r\nBEGIN:BAD'));
  assert.ok(calendar.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
  assert.ok(!reminderCalendar([reminder({ completedAt: now })]).includes('BEGIN:VEVENT'));
});

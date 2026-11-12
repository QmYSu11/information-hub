import type { ContentItem, Source } from '../types';
import { chooseOfficeMaterials } from './office-client';
import type { OfficeProviderId } from './office-client';

export type ChatIntent = 'general' | 'curation' | 'videos' | 'market';
export interface ChatMaterial { id: string; title: string; url: string; description?: string; source?: string; fetchedAt: string; channel: string; kind: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; model?: string; usage?: { input: number; output: number }; deliveryStatus?: 'pending' | 'completed' | 'failed'; materials?: ChatMaterial[]; references?: ChatMaterial[]; intent?: ChatIntent; watchSymbols?: string[] }
export interface ChatConversationSummary { id: string; title: string; provider: OfficeProviderId; updatedAt: string }
export interface ChatConversation extends ChatConversationSummary { messages: ChatMessage[]; contextMessageCount: number; contextLimited?: boolean; pending?: boolean; usedCalls?: number; dailyLimit?: number }
export interface ChatSendInput { conversationId?: string; provider: OfficeProviderId; message: string; requestId: string; intent: ChatIntent; materials?: ChatMaterial[]; watchSymbols?: string[] }
const providers = new Set(['deepseek', 'openai', 'gemini']);
const intents = new Set(['general', 'curation', 'videos', 'market']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const validConversationId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function string(value: unknown, max: number) { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : ''; }
function iso(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : ''; }
function publicUrl(value: unknown) { try { const url = new URL(String(value)); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function material(value: unknown): ChatMaterial | null {
  if (!record(value)) return null;
  const id = string(value.id, 200), title = string(value.title, 180), url = publicUrl(value.url), fetchedAt = iso(value.fetchedAt);
  if (!id || !title || !url || !fetchedAt) return null;
  return { id, title, url, fetchedAt, channel: string(value.channel, 20), kind: string(value.kind, 20), ...(typeof value.description === 'string' ? { description: string(value.description, 250) } : {}), ...(typeof value.source === 'string' ? { source: string(value.source, 80) } : {}) };
}
function materials(value: unknown) { return Array.isArray(value) ? [...new Map(value.slice(0, 200).map(material).filter((row): row is ChatMaterial => row !== null).map(row => [row.id, row])).values()] : []; }
function summary(value: unknown): ChatConversationSummary {
  if (!record(value) || !validConversationId(value.id) || !providers.has(String(value.provider)) || !iso(value.updatedAt)) throw new Error('对话记录格式暂时无法读取，请刷新历史后重试。');
  return { id: value.id, title: string(value.title, 200) || '新的对话', provider: value.provider as OfficeProviderId, updatedAt: value.updatedAt as string };
}
export function parseChatConversation(value: unknown): ChatConversation {
  const meta = summary(value);
  if (!record(value) || !Array.isArray(value.messages) || value.messages.length > 200) throw new Error('无法完整读取这段对话，请刷新历史。');
  const seen = new Set<string>();
  const messages: ChatMessage[] = value.messages.map(raw => {
    if (!record(raw) || !string(raw.id, 200) || !['user', 'assistant'].includes(String(raw.role)) || typeof raw.text !== 'string' || raw.text.length > 240_000 || !iso(raw.createdAt)) throw new Error('无法完整读取这段对话，请刷新历史。');
    const id = string(raw.id, 200);
    if (seen.has(id)) throw new Error('对话中出现重复消息，请刷新历史。');
    seen.add(id);
    const usage = record(raw.usage) && typeof raw.usage.input === 'number' && raw.usage.input >= 0 && Number.isFinite(raw.usage.input) && typeof raw.usage.output === 'number' && raw.usage.output >= 0 && Number.isFinite(raw.usage.output) ? { input: raw.usage.input, output: raw.usage.output } : undefined;
    return { id, role: raw.role as ChatMessage['role'], text: raw.text, createdAt: raw.createdAt as string,
      ...(typeof raw.model === 'string' ? { model: string(raw.model, 100) } : {}), ...(usage ? { usage } : {}),
      ...(['pending', 'completed', 'failed'].includes(String(raw.deliveryStatus)) ? { deliveryStatus: raw.deliveryStatus as ChatMessage['deliveryStatus'] } : {}),
      ...(Array.isArray(raw.materials) ? { materials: materials(raw.materials) } : {}), ...(Array.isArray(raw.references) ? { references: materials(raw.references) } : {}),
      ...(intents.has(String(raw.intent)) ? { intent: raw.intent as ChatIntent } : {}), ...(Array.isArray(raw.watchSymbols) ? { watchSymbols: raw.watchSymbols.filter((value): value is string => typeof value === 'string' && /^[A-Z0-9_]{2,20}:[A-Z0-9][A-Z0-9._/!-]{0,39}$/.test(value)).slice(0, 30) } : {}) };
  });
  if (messages.reduce((sum, row) => sum + row.text.length, 0) > 300_000) throw new Error('对话记录过大，请在新对话中继续。');
  return { ...meta, messages, contextMessageCount: typeof value.contextMessageCount === 'number' && Number.isFinite(value.contextMessageCount) ? Math.max(0, Math.floor(value.contextMessageCount)) : 0,
    contextLimited: value.contextLimited === true, pending: value.pending === true,
    ...(typeof value.usedCalls === 'number' && value.usedCalls >= 0 ? { usedCalls: value.usedCalls } : {}), ...(typeof value.dailyLimit === 'number' && value.dailyLimit >= 0 ? { dailyLimit: value.dailyLimit } : {}) };
}
export class OfficeChatError extends Error {
  conversationId?: string;
  status: number;
  deliveryUnknown: boolean;
  constructor(message: string, options: { conversationId?: string; status?: number; deliveryUnknown?: boolean } = {}) {
    super(message); this.name = 'OfficeChatError'; this.conversationId = validConversationId(options.conversationId) ? options.conversationId : undefined;
    this.status = options.status || 0; this.deliveryUnknown = options.deliveryUnknown === true;
  }
}
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  let response: Response;
  try { response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal }); }
  catch { throw new OfficeChatError('连接中断了，上一条是否完成还不确定。请先刷新会话或打开最新历史，再决定是否重新发送。', { deliveryUnknown: body !== undefined }); }
  let value: unknown;
  try { value = await response.json(); } catch { throw new OfficeChatError('办公室暂时没有返回可读取的结果，请刷新会话状态。', { status: response.status, deliveryUnknown: body !== undefined }); }
  if (!response.ok) throw new OfficeChatError(record(value) ? string(value.error, 600) || '这条消息暂时没有完成，请稍后继续。' : '这条消息暂时没有完成，请稍后继续。', { status: response.status, conversationId: record(value) && validConversationId(value.conversationId) ? value.conversationId : undefined });
  return value;
}
export async function getChatConversations(signal?: AbortSignal): Promise<ChatConversationSummary[]> {
  const value = await request('/api/chat/conversations', undefined, signal);
  if (!record(value) || !Array.isArray(value.conversations)) throw new Error('暂时无法读取历史列表。');
  return value.conversations.map(summary);
}
export async function getChatConversation(id: string, signal?: AbortSignal) {
  if (!validConversationId(id)) throw new Error('对话编号无效，请从历史重新打开。');
  const value = parseChatConversation(await request('/api/chat/conversations/' + encodeURIComponent(id), undefined, signal));
  if (value.id !== id) throw new Error('对话编号不匹配，请从历史重新打开。');
  return value;
}
export async function sendChatMessage(input: ChatSendInput, signal?: AbortSignal) {
  const raw = await request('/api/chat/send', input, signal);
  let value: ChatConversation;
  try { value = parseChatConversation(raw); }
  catch { throw new OfficeChatError('消息可能已经送达，但返回的记录无法完整读取。请先刷新会话确认，避免重复发送。', { conversationId: record(raw) && validConversationId(raw.id) ? raw.id : input.conversationId, deliveryUnknown: true }); }
  if (value.provider !== input.provider || (input.conversationId && value.id !== input.conversationId)) throw new OfficeChatError('返回的对话与当前模型不匹配，请刷新会话后核对。', { conversationId: input.conversationId, deliveryUnknown: true });
  return value;
}
export function chooseChatMaterials(items: ContentItem[], sources: Source[], intent: ChatIntent): ChatMaterial[] {
  const eligible = items.filter(item => intent !== 'videos' || item.kind === 'video' || item.mediaType === 'video');
  const selected = chooseOfficeMaterials(eligible, sources, intent === 'market' ? 'market' : intent === 'general' ? 'general' : 'curation');
  const map = new Map(eligible.map(item => [item.id, item]));
  return selected.slice(0, 20).map(row => material({ ...row, url: map.get(row.id)?.url })).filter((row): row is ChatMaterial => row !== null);
}
export function createChatSendInput(value: { conversationId?: string; provider: OfficeProviderId; message: string; requestId: string; intent: ChatIntent; includeMaterials?: boolean; materials?: ChatMaterial[]; includeWatchSymbols?: boolean; watchSymbols?: string[] }): ChatSendInput {
  if (!providers.has(value.provider) || !validConversationId(value.requestId) || (value.conversationId && !validConversationId(value.conversationId))) throw new Error('对话配置有误，请刷新后再试。');
  const message = value.message.trim();
  if (!message || message.length > 6000) throw new Error('请填写 1 到 6000 字的消息。');
  const selected = value.includeMaterials ? materials(value.materials).slice(0, 20) : [];
  if (value.includeMaterials && !selected.length) throw new Error('还没有可附的新闻材料，请先刷新资料，或取消勾选后用普通聊天提问。');
  const watchSymbols = value.includeWatchSymbols ? [...new Set((value.watchSymbols || []).filter(symbol => /^[A-Z0-9_]{2,20}:[A-Z0-9][A-Z0-9._/!-]{0,39}$/.test(symbol)))].slice(0, 30) : [];
  return { ...(value.conversationId ? { conversationId: value.conversationId } : {}), provider: value.provider, message, requestId: value.requestId,
    intent: value.includeMaterials && intents.has(value.intent) ? value.intent : 'general', ...(selected.length ? { materials: selected } : {}), ...(watchSymbols.length ? { watchSymbols } : {}) };
}
export function referencesForChatMessage(message: ChatMessage): ChatMaterial[] {
  if (message.role !== 'assistant') return [];
  const cited = new Set([...message.text.matchAll(/\[来源:([^\]\n]+)\]/g)].map(match => match[1]));
  return materials(message.references).filter(row => cited.has(row.id));
}

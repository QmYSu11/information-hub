import type { ContentItem, Source } from '../types';

export type OfficeProviderId = 'deepseek' | 'openai' | 'gemini';
export type OfficeTemplate = 'general' | 'study' | 'curation' | 'market';
export const OFFICE_ROSTER: { id: OfficeProviderId; name: string; nickname: string; personality: string; color: string; portrait: string }[] = [
  { id: 'deepseek', name: 'DeepSeek', nickname: '澄海', personality: '好奇心很强，喜欢把问题问清楚。', color: '#5b98cc', portrait: '0% 50%' },
  { id: 'openai', name: 'ChatGPT', nickname: '知白', personality: '表达温柔，也愿意认真提出不同意见。', color: '#74a891', portrait: '50% 50%' },
  { id: 'gemini', name: 'Gemini', nickname: '星野', personality: '脑洞开阔，习惯从另一个角度看事情。', color: '#b192c7', portrait: '100% 50%' },
];
export interface OfficeAssignment { id: string; provider: OfficeProviderId; title: string; instruction: string }
export interface OfficePlan { title: string; assignments: OfficeAssignment[]; reviewer: OfficeProviderId | null; summarizer: OfficeProviderId }
export interface OfficeReply { id: string; title: string; provider: OfficeProviderId; phase: 'work' | 'review' | 'summary'; text: string; model: string; usage: { input: number; output: number }; completedAt: string }
export interface OfficeSession { taskId: string; ticket: string; title: string; members: OfficeProviderId[]; convener: OfficeProviderId; plan: OfficePlan | null; results: OfficeReply[]; status: 'planning' | 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled'; nextStep: number; usedCalls: number; maxCalls: number; error: string | null; expiresAt: number; steps: { id: string; title: string; provider: OfficeProviderId; phase: 'work' | 'review' | 'summary' }[] }
export interface OfficeStatus { providers: { id: OfficeProviderId; name: string; configured: boolean; model: string }[]; ready: boolean; canConfigure?: boolean; dailyLimit: number; usedCalls: number; message: string }
export interface OfficePlanInput { task: string; template: OfficeTemplate; convener: OfficeProviderId; members: OfficeProviderId[]; maxCalls: number; materials: { id: string; title: string; description?: string; source?: string; fetchedAt: string; channel: string; kind: string }[]; includeNotes: boolean; noteText: string; watchSymbols: string[] }
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
  let result: T & { error?: string };
  try { result = await response.json(); } catch { throw new Error('办公室服务暂时无法连接，请在私密办公室页面中重试。'); }
  if (!response.ok) throw new Error(result.error || '办公室暂时无法完成这项操作。');
  return result;
}
export const getOfficeStatus = (signal?: AbortSignal) => request<OfficeStatus>('/api/status', undefined, signal);
export const planOfficeTask = (input: OfficePlanInput, signal?: AbortSignal) => request<OfficeSession>('/api/office/plan', input, signal);
export const approveOfficeTask = (ticket: string, plan: OfficePlan, signal?: AbortSignal) => request<OfficeSession>('/api/office/approve', { ticket, plan }, signal);
export const runOfficeStep = (ticket: string, signal?: AbortSignal) => request<OfficeSession>('/api/office/run', { ticket }, signal);
export const resumeOfficeTask = (ticket: string) => request<OfficeSession>('/api/office/resume', { ticket });
export const cancelOfficeTask = (ticket: string) => request<OfficeSession>('/api/office/cancel', { ticket });
export async function getOfficeFeed(signal?: AbortSignal) {
  return request<unknown>('/api/feed', undefined, signal);
}
export async function configureOfficeProvider(provider: OfficeProviderId, key: string) {
  const intent = await request<{ configurationToken: string }>('/api/providers/configure-intent', { provider });
  return request<{ configured: boolean; provider: OfficeProviderId; message: string }>('/api/providers/configure', { provider, key, configurationToken: intent.configurationToken });
}
/** Read only supported one-line key assignments; never evaluate a shell file or expand variables. */
export function parseOfficeEnvironment(text: string): Partial<Record<OfficeProviderId, string>> {
  if (text.length > 25_000) throw new Error('配置文件太大，请只选择专用于模型连接的小型 .env 文件。');
  const names: Record<string, OfficeProviderId> = { DEEPSEEK_API_KEY: 'deepseek', OPENAI_API_KEY: 'openai', GEMINI_API_KEY: 'gemini' };
  const found: Partial<Record<OfficeProviderId, string>> = {};
  for (const line of text.split(/\r?\n/)) {
    const assignment = /^\s*(?:export\s+)?(DEEPSEEK_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if (!assignment) continue;
    let value = assignment[2];
    if (!value) continue;
    if (value.startsWith('"') || value.startsWith("'")) {
      const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(value);
      if (!quoted) throw new Error('检测到的模型密钥格式有误，请选择原始配置文件。');
      value = quoted[2];
    } else value = value.replace(/\s+#.*$/, '').trim();
    if (!/^[!-~]{12,1000}$/.test(value) || value.includes('${') || value.includes('$(')) throw new Error('检测到的模型密钥格式有误，请选择原始配置文件。');
    const provider = names[assignment[1]];
    if (found[provider] && found[provider] !== value) throw new Error('同一模型有多个不同的密钥，请先在本机保留一个明确配置。');
    found[provider] = value;
  }
  return found;
}
/** Balance source variety instead of treating one platform's popularity as a cross-platform score. */
export function chooseOfficeMaterials(items: ContentItem[], sources: Source[], template: OfficeTemplate) {
  const labels = new Map(sources.map(source => [source.id, source.label]));
  const relevant = items.filter(item => template !== 'market' || item.channel === '财经');
  const buckets = new Map<string, ContentItem[]>();
  const score = (item: ContentItem) => template === 'curation' ? item.kind === 'video' || item.kind === 'post' ? 2 : item.channel === '趣事' ? 1 : 0 : 0;
  for (const item of [...relevant].sort((a, b) => score(b) - score(a))) buckets.set(item.sourceId, [...(buckets.get(item.sourceId) || []), item]);
  const selected: ContentItem[] = [];
  while (selected.length < 40) {
    let found = false;
    for (const bucket of buckets.values()) { const item = bucket.shift(); if (item) { selected.push(item); found = true; if (selected.length === 40) break; } }
    if (!found) break;
  }
  return selected.map(item => ({ id: item.id, title: item.title, description: item.description?.slice(0, 250), source: labels.get(item.sourceId) || item.sourceId, fetchedAt: item.fetchedAt, channel: item.channel, kind: item.kind }));
}

import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Check, FileKey2, KeyRound, LoaderCircle, Save, ShieldCheck, X } from 'lucide-react';
import { configureOfficeProvider, OFFICE_ROSTER, parseOfficeEnvironment } from '../lib/office-client';
import type { OfficeProviderId, OfficeStatus } from '../lib/office-client';

const blank = (): Record<OfficeProviderId, string> => ({ deepseek: '', openai: '', gemini: '' });
type Props = { status: OfficeStatus | null; onConnected: () => Promise<void> | void; disabled?: boolean };
export default function OfficeConnections({ status, onConnected, disabled = false }: Props) {
  const [keys, setKeys] = useState(blank);
  const [fileKeys, setFileKeys] = useState<Partial<Record<OfficeProviderId, string>>>({});
  const [selected, setSelected] = useState<OfficeProviderId[]>([]);
  const [busy, setBusy] = useState<OfficeProviderId | 'file' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const blocked = Boolean(disabled || busy || !status?.canConfigure);
  function clearDrafts() {
    setKeys(blank()); setFileKeys({}); setSelected([]);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function saveOne(event: FormEvent, provider: OfficeProviderId) {
    event.preventDefault(); if (blocked || !keys[provider].trim()) return;
    setBusy(provider); setMessage(''); setError('');
    try {
      await configureOfficeProvider(provider, keys[provider].trim());
      setMessage(`${OFFICE_ROSTER.find(member => member.id === provider)?.name} 连接已加密保存。实际可用性会在发起任务时验证。`);
      await onConnected();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '连接暂时无法保存，请重新输入后再试。'); }
    finally { setKeys(current => ({ ...current, [provider]: '' })); setBusy(null); }
  }
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFileKeys({}); setSelected([]); setMessage(''); setError('');
    if (!file) return;
    if (file.size > 25_000) { setError('请选择小于 25KB、专用于模型连接的 .env 配置文件。'); event.target.value = ''; return; }
    try {
      const found = parseOfficeEnvironment(await file.text());
      const providers = Object.keys(found) as OfficeProviderId[];
      if (!providers.length) throw new Error('没有检测到 OPENAI_API_KEY、DEEPSEEK_API_KEY 或 GEMINI_API_KEY。文件内容没有发送。');
      setFileKeys(found); setSelected(providers);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '配置文件无法读取。'); event.target.value = ''; }
  }
  async function saveSelected() {
    if (blocked || !selected.length) return;
    setBusy('file'); setMessage(''); setError('');
    const saved: string[] = [];
    try {
      for (const provider of selected) {
        const key = fileKeys[provider]; if (!key) continue;
        await configureOfficeProvider(provider, key);
        saved.push(OFFICE_ROSTER.find(member => member.id === provider)?.name || provider);
        setFileKeys(current => { const next = { ...current }; delete next[provider]; return next; });
      }
      setMessage(`已加密保存：${saved.join('、')}。选择的密钥已清空；实际可用性会在发起任务时验证。`);
      await onConnected();
    } catch (cause) { setError((saved.length ? `已保存 ${saved.join('、')}；` : '') + (cause instanceof Error ? cause.message : '其余连接暂时无法保存。') + ' 请重新选择文件后再试。'); await onConnected(); }
    finally { clearDrafts(); setBusy(null); }
  }
  return <details className="office-connections">
    <summary><KeyRound size={16} /><span>连接模型</span><small>密钥只发给当前私密办公室，保存后清空输入</small></summary>
    <div className="office-connections-inner"><p className="office-connections-intro"><ShieldCheck size={14} />这里配置模型服务密钥。仅当前登录账号可使用，服务端加密保存；不会写进浏览器存储、公开新闻快照或公开源码。不要把密钥发到聊天或任务正文中。</p>
      {!status?.canConfigure && <p className="office-connection-message">私密服务的安全配置或数据库尚未就绪，暂不能提交密钥。</p>}
      <div className="office-key-forms">{OFFICE_ROSTER.map(member => { const configured = status?.providers.find(row => row.id === member.id)?.configured; return <form key={member.id} onSubmit={event => void saveOne(event, member.id)}>
        <header><strong>{member.name}</strong><span>{configured ? '已配置 · 可替换' : '未配置'}</span></header>
        <label htmlFor={'office-key-' + member.id}>{member.name} API 密钥</label><input id={'office-key-' + member.id} type="password" value={keys[member.id]} onChange={event => setKeys(current => ({ ...current, [member.id]: event.target.value }))} disabled={blocked} autoComplete="off" spellCheck={false} autoCapitalize="off" maxLength={1000} placeholder="粘贴完整服务密钥" />
        <button className="button" type="submit" disabled={blocked || !keys[member.id].trim()}>{busy === member.id ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}{configured ? '保存替换连接' : '加密保存连接'}</button>
      </form>; })}</div>
      <section className="office-env-import"><div><FileKey2 size={18} /><div><h3>也可以选择本机的 .env 文件</h3><p>只在此页面读取三种模型密钥字段；不会上传整个文件，也不会读取其他配置字段。</p></div></div><input ref={fileInput} type="file" accept=".env,.local,.txt" disabled={blocked} aria-label="选择包含模型密钥的本地配置文件" onChange={event => void chooseFile(event)} />
        {Object.keys(fileKeys).length > 0 && <div className="office-env-preview"><p>仅检测到以下连接，尚未发送：</p><div>{OFFICE_ROSTER.filter(member => fileKeys[member.id]).map(member => <label key={member.id}><input type="checkbox" checked={selected.includes(member.id)} disabled={Boolean(busy)} onChange={event => setSelected(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} /><Check size={12} />{member.name}</label>)}</div><button className="button primary" disabled={blocked || !selected.length} onClick={() => void saveSelected()}>{busy === 'file' ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}保存选中模型到私密办公室</button></div>}
      </section>
      {message && <p className="office-connection-message success" role="status">{message}</p>}{error && <p className="office-connection-message warning" role="alert">{error}</p>}
      <button className="text-button office-clear-keys" disabled={Boolean(busy)} onClick={() => { clearDrafts(); setMessage('尚未保存的密钥输入已清空。'); setError(''); }}><X size={12} />清空尚未保存的输入</button>
    </div>
  </details>;
}

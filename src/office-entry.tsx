import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Check, Moon, ShieldCheck, Sun, TrendingUp } from 'lucide-react';
import AiOffice from './features/AiOffice';
import FeatureBoundary from './components/FeatureBoundary';
import './styles.css';
import './glass.css';

const watchKey = 'information-study.private-office.watchlist.v1';
const themeKey = 'information-study.private-office.theme.v1';
const isSymbol = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9_]{2,20}:[A-Z0-9][A-Z0-9._/!-]{0,39}$/.test(value) && !/^(?:HTTP|HTTPS|JAVASCRIPT|DATA|FILE|BLOB|FTP|VBSCRIPT):/.test(value);
function loadSymbols() {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(watchKey) || '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter(isSymbol))].slice(0, 30) : [];
  } catch { return []; }
}
function loadTheme(): 'light' | 'dark' {
  try { const saved = localStorage.getItem(themeKey); if (saved === 'light' || saved === 'dark') return saved; } catch { /* Theme persistence is optional. */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function PrivateOffice() {
  const [theme, setTheme] = useState(loadTheme);
  const [watchSymbols, setWatchSymbols] = useState<string[]>(loadSymbols);
  const [watchDraft, setWatchDraft] = useState(() => loadSymbols().join('、'));
  const [watchMessage, setWatchMessage] = useState('');
  const [watchError, setWatchError] = useState('');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(themeKey, theme); } catch { /* Theme persistence is optional. */ }
  }, [theme]);
  function saveWatchlist(event: FormEvent) {
    event.preventDefault(); setWatchMessage(''); setWatchError('');
    const values = watchDraft.trim() ? [...new Set(watchDraft.trim().toUpperCase().split(/[\s,，;；、]+/).filter(Boolean))] : [];
    if (values.length > 30 || values.some(value => !isSymbol(value))) { setWatchError('最多保存 30 个标的。请使用交易所:代码，例如 NASDAQ:NVDA、SSE:600519。'); return; }
    try {
      localStorage.setItem(watchKey, JSON.stringify(values)); setWatchSymbols(values); setWatchDraft(values.join('、'));
      setWatchMessage(values.length ? `已在这个浏览器保存 ${values.length} 个关注标的。选择“自选观察”后，才会随任务发给参与模型。` : '已清空这个浏览器的关注标的。');
    } catch { setWatchError('浏览器暂时无法保存，请允许此站点使用本地存储后重试。'); }
  }
  return <div className="office-private-shell">
    <style>{shellStyles}</style>
    <a className="office-private-skip" href="#private-office-content">跳到办公室</a>
    <header className="office-private-topbar"><a className="office-private-back" href="https://qmysu11.github.io/information-hub/" target="_blank" rel="noopener noreferrer"><ArrowLeft size={16} /><span>返回信息书房</span></a><span className="office-private-title"><ShieldCheck size={14} />小队的私密空间</span><button className="office-private-theme" aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'} onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button></header>
    <main id="private-office-content" tabIndex={-1}>
      <details className="office-private-watch"><summary><TrendingUp size={15} /><span>这间办公室关注哪些标的？</span><small>{watchSymbols.length ? watchSymbols.length + ' 个已保存' : '可选'}</small></summary><form onSubmit={saveWatchlist}><p>在这里填写你愿意交给小队关注的证券代码。新闻网站与这间私密办公室分别保存资料，自选不会自动跨站传送。</p><label htmlFor="office-watch-codes">关注标的代码</label><textarea id="office-watch-codes" value={watchDraft} onChange={event => setWatchDraft(event.target.value)} maxLength={2000} rows={2} placeholder="NASDAQ:NVDA、NASDAQ:AAPL、SSE:600519" spellCheck={false} autoComplete="off" /><div><span>可以用逗号、空格或换行分隔。这里只存标的，不填 API 密钥。</span><button className="button" type="submit"><Check size={14} />保存关注</button></div>{watchMessage && <p className="office-private-watch-message" role="status">{watchMessage}</p>}{watchError && <p className="office-private-watch-error" role="alert">{watchError}</p>}</form></details>
      <FeatureBoundary name="私密 AI 办公室"><AiOffice items={[]} sources={[]} watchSymbols={watchSymbols} standalone /></FeatureBoundary>
    </main>
    <footer className="office-private-footer">信息书房 · 认真做事，也留一点好奇心。<span>新闻材料按需附入，模型连接由当前私密服务处理。</span></footer>
  </div>;
}

const shellStyles = `
.office-private-shell{max-width:1400px;margin:0 auto;padding:24px 30px 0;min-height:100dvh}.office-private-topbar{position:sticky;top:18px;z-index:20;display:flex;align-items:center;gap:18px;min-height:61px;padding:12px 20px;margin-bottom:28px;border:1px solid var(--glass-edge,var(--line));border-radius:18px;background:var(--sidebar);backdrop-filter:blur(28px) saturate(145%);-webkit-backdrop-filter:blur(28px) saturate(145%);box-shadow:var(--shadow)}.office-private-back{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--accent)}.office-private-title{display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-left:auto;font-size:10px;letter-spacing:.5px;color:var(--muted)}.office-private-title svg{color:var(--positive)}.office-private-theme{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;color:var(--muted);margin-left:5px}.office-private-theme:hover{background:var(--accent-soft);color:var(--accent)}.office-private-shell main{outline:none;scroll-margin-top:96px}.office-private-watch{margin-bottom:27px;padding:0 20px;border:1px solid var(--glass-edge,var(--line));border-radius:15px;background:var(--panel);box-shadow:var(--shadow);backdrop-filter:blur(22px)}.office-private-watch summary{display:flex;align-items:center;gap:9px;padding:14px 0;cursor:pointer;font-size:11px;color:var(--text);list-style:none}.office-private-watch summary::-webkit-details-marker{display:none}.office-private-watch summary>svg{color:var(--accent)}.office-private-watch summary>small{margin-left:auto;font-size:9px;color:var(--muted);border:1px solid var(--line);border-radius:6px;background:var(--panel-2);padding:2px 6px}.office-private-watch form{border-top:1px solid var(--line);padding:14px 0 17px}.office-private-watch form>p{font-size:11px;color:var(--muted);line-height:1.9;margin:0 0 12px}.office-private-watch label{display:block;font-size:11px;color:var(--muted);margin-bottom:7px}.office-private-watch textarea{display:block;resize:vertical;width:100%;font-size:12px;line-height:1.8;background:var(--panel-2);border-radius:10px}.office-private-watch form>div{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:11px}.office-private-watch form>div>span{font-size:10px;color:var(--muted);line-height:1.8}.office-private-watch .button{font-size:11px;gap:5px;min-height:33px;white-space:nowrap}.office-private-watch form>.office-private-watch-message{color:var(--positive);font-size:11px;margin:12px 0 0}.office-private-watch form>.office-private-watch-error{color:var(--warning);font-size:11px;margin:12px 0 0}.office-private-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap;padding:24px 1px 27px;border-top:1px solid var(--line);margin-top:22px;color:var(--muted);font-size:10px;line-height:1.8}.office-private-skip{position:fixed;top:-100px;left:25px;z-index:1000;background:var(--panel-2);color:var(--accent);border:1px solid var(--line);border-radius:8px;padding:10px 15px;font-size:12px}.office-private-skip:focus{top:20px}
@media(max-width:760px){.office-private-shell{padding:12px 14px 0}.office-private-topbar{top:10px;min-height:54px;padding:10px 13px;gap:10px;border-radius:15px;margin-bottom:21px}.office-private-back{font-size:11px;gap:5px}.office-private-back svg{width:14px;height:14px}.office-private-title{font-size:9px;letter-spacing:0;gap:4px}.office-private-title svg{width:12px;height:12px}.office-private-theme{margin-left:0;width:27px;height:27px}.office-private-watch{padding:0 14px;border-radius:13px;margin-bottom:22px}.office-private-watch summary{font-size:10px;gap:7px}.office-private-watch summary>small{font-size:8px}.office-private-watch form>p,.office-private-watch label{font-size:10px}.office-private-watch textarea{font-size:11px}.office-private-watch form>div{align-items:flex-start;flex-direction:column;gap:10px}.office-private-watch form>div>span{font-size:9px}.office-private-watch .button{font-size:10px}.office-private-footer{font-size:9px;padding-top:21px;gap:6px}.office-private-shell main{scroll-margin-top:80px}}
@media(prefers-reduced-motion:reduce){.office-private-shell *{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
`;

const root = document.getElementById('root');
if (!root) throw new Error('Office root is missing');
createRoot(root).render(<PrivateOffice />);

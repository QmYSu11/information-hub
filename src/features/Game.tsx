import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, Check, ChevronRight, CircleHelp, Crosshair, Expand, Flame, GitFork, Heart,
  Hexagon, Orbit, Pause, Play, Radio, Shield, Sparkles, Target, Timer, TrendingUp, Wind, Zap,
} from 'lucide-react';
import { personal, usePersonal } from '../lib/personal-store';
import {
  autoChoose, buyPermanent, chooseUpgrade, claimOffline, createGameSave, GameCheckpointGuard, isGameSave, LAST_WAVE,
  packGameSave, permanentCost, ROUTES, settleRun, startRun, stats, stepRun, UPGRADES, WAVE_SECONDS, WORLD,
  type Expedition, type GameSave, type Route, type UpgradeId,
} from '../lib/game-engine';
import './game.css';

type Props = { onToast: (message: string) => void };
const icons = { damage: Flame, haste: Zap, split: GitFork, crit: Crosshair, reach: Radio, mobility: Wind, ward: Shield, regen: Heart, vigor: Hexagon, orbit: Orbit, pulse: Sparkles, poison: Target };
const timeLabel = (seconds: number) => Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + Math.floor(seconds % 60).toString().padStart(2, '0');

export default function Game({ onToast }: Props) {
  const { data, status } = usePersonal();
  const [session, setSession] = useState(0);
  if (status === 'loading') return <div className="game-loading"><Orbit /><span>正在接续你的远征…</span></div>;
  if (data.gameSave != null && !isGameSave(data.gameSave)) return <div className="game-recovery"><Shield /><h1>这份远征暂时无法接续</h1><p>存档格式不受支持。你可以先到偏好设置导出完整备份，再建立新存档。</p><button className="game-primary" onClick={() => { personal.setGameSave(createGameSave()); onToast('新的远征存档已建立。'); }}>建立新存档 <ArrowUpRight /></button></div>;
  return <GameSession key={session} initial={data.gameSave} onToast={onToast} saveStatus={status} onReload={() => setSession(n => n + 1)} />;
}

function GameSession({ initial, onToast, saveStatus, onReload }: Props & { initial: unknown; saveStatus: string; onReload: () => void }) {
  const [boot] = useState(() => claimOffline(isGameSave(initial) ? structuredClone(initial) : createGameSave()));
  const saveRef = useRef<GameSave>(boot.save);
  const guardRef = useRef(new GameCheckpointGuard(initial));
  const observedRef = useRef(initial);
  const persistTimerRef = useRef<number | undefined>(undefined);
  const conflictNotifiedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const autoWaitRef = useRef(0);
  const [route, setRoute] = useState<Route>(saveRef.current.current?.route || 'spark');
  const [paused, setPaused] = useState(false);
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [visible, setVisible] = useState(!document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [, render] = useState(0);
  const [help, setHelp] = useState(false);
  const [conflict, setConflict] = useState(false);
  const refresh = () => render(n => n + 1);
  const freezeForConflict = () => {
    clearInterval(persistTimerRef.current);
    cancelAnimationFrame(frameRef.current);
    setConflict(true); setPaused(true);
    if (!conflictNotifiedRef.current) {
      conflictNotifiedRef.current = true;
      onToast('另一处已更新游戏存档。当前远征已停靠，请载入最新存档。');
    }
  };
  const ensureCurrent = () => {
    if (guardRef.current.blocked) return false;
    const current = personal.getData().gameSave;
    if (current !== observedRef.current) {
      if (!guardRef.current.observe(current)) { freezeForConflict(); return false; }
      observedRef.current = current;
    }
    return true;
  };
  const persist = () => {
    // Check the live store before every write, including cleanup and pagehide.
    if (!ensureCurrent()) return false;
    const now = Date.now();
    saveRef.current.lastClaimAt = Math.max(saveRef.current.lastClaimAt, now);
    const previous = personal.getData().gameSave;
    try {
      const checkpoint = packGameSave(saveRef.current, now);
      guardRef.current.rememberWrite(checkpoint);
      personal.setGameSave(checkpoint);
      observedRef.current = personal.getData().gameSave;
      return true;
    } catch {
      // A failed synchronous mutation did not replace the observed checkpoint.
      guardRef.current = new GameCheckpointGuard(previous);
      onToast('存档暂时没有写入，请保留页面并在设置中导出备份。');
      return false;
    }
  };

  useEffect(() => {
    if (boot.earned > 0) onToast('离线补给已送达：' + boot.earned + ' 枚晶屑');
    if (persist()) persistTimerRef.current = window.setInterval(persist, 5000);
    const visibility = () => { if (document.hidden) persist(); setVisible(!document.hidden); };
    const externalConflict = () => { ensureCurrent(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', persist);
    window.addEventListener('personal-game-conflict', externalConflict);
    return () => {
      clearInterval(persistTimerRef.current);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('personal-game-conflict', externalConflict);
      persist();
    };
    // Session owns its mutable simulation; remounting computes offline rewards exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { ensureCurrent(); }, [initial]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!visible || conflict) return;
    let last = performance.now(), lastUI = 0;
    const frame = (now: number) => {
      if (!ensureCurrent()) return;
      const delta = Math.max(0, Math.min((now - last) / 1000, .05));
      last = now;
      const save = saveRef.current, run = save.current;
      if (run && !paused) {
        if (run.phase === 'choice' && auto) {
          autoWaitRef.current += delta;
          if (autoWaitRef.current > 1.3) { autoChoose(run); autoWaitRef.current = 0; persist(); refresh(); }
        } else if (run.phase === 'fighting') {
          autoWaitRef.current = 0;
          stepRun(run, delta * speed);
          if (['victory', 'defeat'].includes(run.phase)) {
            settleRun(save); persist(); refresh();
          }
        }
      }
      if (canvasRef.current) paint(canvasRef.current, run, now / 1000, reducedMotion || document.documentElement.dataset.motion === 'reduced');
      if (now - lastUI > 110) { refresh(); lastUI = now; }
      frameRef.current = requestAnimationFrame(frame);
    };
    frameRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, auto, speed, visible, reducedMotion, conflict]);

  const save = saveRef.current, run = save.current;
  const active = !!run && (run.phase === 'fighting' || run.phase === 'choice');
  const attributes = run ? stats(run) : null;
  const begin = () => {
    if (!ensureCurrent()) return;
    saveRef.current = startRun(saveRef.current, route);
    setPaused(false); autoWaitRef.current = 0; persist(); refresh();
  };
  const select = (id: UpgradeId) => {
    if (!ensureCurrent()) return;
    if (saveRef.current.current && chooseUpgrade(saveRef.current.current, id)) { autoWaitRef.current = 0; persist(); refresh(); }
  };
  const purchase = (kind: keyof GameSave['permanent']) => {
    if (!ensureCurrent()) return;
    const upgraded = buyPermanent(saveRef.current, kind);
    if (!upgraded) return;
    saveRef.current = upgraded; persist(); refresh();
    onToast(kind === 'income' ? '补给效率已提升。' : '舱室已升级，将在下次远征生效。');
  };
  const endEarly = () => {
    if (!ensureCurrent()) return;
    const r = saveRef.current.current;
    if (r && active) { r.phase = 'defeat'; settleRun(saveRef.current); persist(); refresh(); setPaused(false); }
  };
  const expand = async () => {
    if (!document.fullscreenEnabled) { onToast('当前浏览器不支持全屏，请使用浏览器的全屏功能。'); return; }
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await arenaRef.current?.requestFullscreen(); }
    catch { onToast('未能进入全屏，仍可在当前窗口继续。'); }
  };

  return <section className="game-page">
    {conflict && <div className="game-conflict-banner" role="alert"><Shield /><div><strong>另一处的远征已更新</strong><p>当前会话已暂停并停止保存，避免覆盖最新进度。载入后即可继续。</p></div><button className="game-primary" onClick={onReload}>载入最新存档 <ArrowUpRight /></button></div>}
    <header className="game-heading">
      <div>
        <span className="game-eyebrow"><span /> 暂时离开信息流</span>
        <h1>信号远征<span className="game-title-mark">休息室</span></h1>
        <p>让飞船自己探索。你来决定，它将成为怎样的一束光。</p>
      </div>
      <div className="game-wallet"><Hexagon /><div><strong>{Math.floor(save.crystals).toLocaleString()}</strong><span>可用晶屑</span></div></div>
    </header>

    <div className="game-layout">
      <div className="game-main">
        <div className="game-arena" ref={arenaRef}>
          <div className="game-arena-top">
            <span className="game-sector"><Radio /> 低轨信号场</span>
            <div className="game-arena-actions">
              <button className={help ? 'is-active' : ''} onClick={() => setHelp(v => !v)} aria-label="查看玩法" aria-expanded={help}><CircleHelp /></button>
              <button onClick={expand} aria-label="切换游戏全屏"><Expand /></button>
            </div>
          </div>
          <canvas ref={canvasRef} width={1000} height={620} aria-label="自动战斗场景，战斗数据与升级操作可在下方和侧栏查看" />
          {help && <div className="game-help"><strong>一场轻松的自动远征</strong><p>飞船会自动移动与攻击。升级时选择一种强化，或打开自动构筑。第 4、8 波出现精英，第 12 波击败核心守卫即可返航；守卫阶段最多持续 3 分钟，信号耗尽则结束远征。</p><p>离开页面即暂停战斗，返回后可续玩；离线最多获得 8 小时补给，不会替你进行战斗与选择。</p><button onClick={() => setHelp(false)}>知道了 <Check /></button></div>}
          {!run && !conflict && <div className="game-start-overlay">
            <div className="game-orbit-emblem"><Orbit /></div>
            <span className="game-eyebrow">一场属于你的短途旅行</span>
            <h2>下一束信号，<br />正在等待出发。</h2>
            <p>自动战斗 · 随机构筑 · 随时停靠</p>
            <button className="game-primary" onClick={begin}>开始远征 <ArrowUpRight /></button>
          </div>}
          {run?.phase === 'choice' && !conflict && <div className="game-choice-overlay">
            <div className="game-choice-title"><Sparkles /><span>等级 {run.level}<strong>选择下一次进化</strong></span>{auto && <small>将按路线偏好自动选择</small>}</div>
            <div className="game-upgrade-grid">{run.choices.map(id => {
              const upgrade = UPGRADES.find(v => v.id === id)!; const Icon = icons[id];
              return <button key={id} className={'game-upgrade game-family-' + upgrade.family} onClick={() => select(id)}>
                <span className="game-upgrade-icon"><Icon /></span><span className="game-upgrade-family">{upgrade.family} · {(run.upgrades[id] || 0) + 1} / {upgrade.max}</span>
                <strong>{upgrade.name}</strong><p>{upgrade.description}</p><span className="game-upgrade-select">选择强化 <ChevronRight /></span>
              </button>;
            })}</div>
          </div>}
          {run && !conflict && (run.phase === 'victory' || run.phase === 'defeat') && <div className="game-result-overlay">
            <div className="game-result-icon">{run.phase === 'victory' ? <Sparkles /> : <Orbit />}</div>
            <span className="game-eyebrow">{run.phase === 'victory' ? '已穿过最后的信号' : '短暂休整，再次启航'}</span>
            <h2>{run.phase === 'victory' ? '欢迎返航。' : '这束光，还会继续。'}</h2>
            <p>{run.phase === 'victory' ? '核心守卫已清除，远征顺利完成。' : '本次远征已结束，收集的晶屑已存入舱室。'}</p>
            <div className="game-result-stats"><span><strong>{run.wave}<small> / {LAST_WAVE}</small></strong>抵达波次</span><span><strong>{run.kills}</strong>清除目标</span><span><strong>+{run.reward}</strong>获得晶屑</span></div>
            <button className="game-primary" onClick={begin}>再出发一次 <ArrowUpRight /></button>
          </div>}
          {conflict ? <div className="game-pause-overlay"><Shield /><strong>已保护最新进度</strong><button className="game-primary" onClick={onReload}>载入最新存档 <ArrowUpRight /></button></div> : paused && active && run.phase !== 'choice' && <div className="game-pause-overlay"><Pause /><strong>已停靠</strong><button className="game-primary" onClick={() => setPaused(false)}>继续远征 <Play /></button></div>}
          <div className="game-arena-bottom"><span><span className={'game-live-dot' + (active && !paused ? ' active' : '')} />{active ? paused ? '已暂停' : run.phase === 'choice' ? '等待进化' : '自动探索中' : '等待下一次远征'}</span><span><Timer /> {timeLabel(run?.elapsed || 0)}</span></div>
        </div>

        <div className="game-control-strip">
          <div className="game-toggle-wrap"><button className={'game-switch' + (auto ? ' on' : '')} role="switch" aria-checked={auto} onClick={() => setAuto(v => !v)} aria-label="自动选择强化"><span /></button><div><strong>自动构筑</strong><small>优先选择当前路线的强化</small></div></div>
          <div className="game-controls"><button disabled={conflict} className="game-speed" onClick={() => setSpeed(v => v === 1 ? 2 : 1)} aria-label={'当前速度 ' + speed + ' 倍，点击切换'}>{speed}× 速度</button><button disabled={!active || conflict} onClick={() => setPaused(v => !v)} className="game-pause-button">{paused ? <Play /> : <Pause />}{paused ? '继续' : '暂停'}</button></div>
        </div>

        <div className="game-growth">
          <div className="game-section-head"><h2><TrendingUp /> 舱室成长</h2><span>带到下一次远征</span></div>
          <div className="game-growth-grid">{([
            { key: 'power' as const, icon: Zap, name: '火力晶核', detail: '每级基础伤害 +2' },
            { key: 'hull' as const, icon: Shield, name: '生命舱室', detail: '每级初始生命 +12' },
            { key: 'income' as const, icon: Hexagon, name: '补给信标', detail: '每级离线补给 +1 / 分钟' },
          ]).map(({ key, icon: Icon, name, detail }) => {
            const cost = permanentCost(save, key), maxed = save.permanent[key] >= 10;
            return <div className="game-growth-card" key={key}><span className="game-growth-icon"><Icon /></span><strong>{name}<small>Lv.{save.permanent[key]}</small></strong><p>{detail}</p><button disabled={conflict || maxed || save.crystals < cost} onClick={() => purchase(key)}>{maxed ? '已达上限' : <><Hexagon /> {cost}<span>升级</span></>}</button></div>;
          })}</div>
        </div>
        <p className="game-save-note"><Shield />{saveStatus === 'error' ? '存档写入遇到问题，请在设置中导出备份。' : '进度保存在此浏览器。离开时停靠，回来继续。'}{boot.earned > 0 && <span>本次离线补给 +{boot.earned}</span>}</p>
      </div>

      <aside className="game-sidebar">
        <div className="game-session-card">
          <div className="game-section-head"><h2>远征状态</h2><span className="game-level">Lv.{run?.level || 1}</span></div>
          <div className="game-wave"><span>当前波次</span><strong>{String(run?.wave || 1).padStart(2, '0')}<small>/ {LAST_WAVE}</small></strong></div>
          <div className="game-wave-track"><span style={{ width: ((run?.waveElapsed || 0) / WAVE_SECONDS * 100) + '%' }} /></div>
          <div className="game-vitals"><div><span><Heart /> 舱室生命</span><strong>{Math.ceil(run?.player.hp ?? 110 + save.permanent.hull * 12)}<small> / {attributes?.maxHp ?? 110 + save.permanent.hull * 12}</small></strong></div><div className="game-hp-track"><span style={{ width: run && attributes ? Math.max(0, run.player.hp / attributes.maxHp * 100) + '%' : '100%' }} /></div></div>
          <div className="game-vitals"><div><span><Shield /> 护盾</span><strong>{Math.ceil(run?.player.shield || 0)}<small> / {attributes?.maxShield || 0}</small></strong></div><div className="game-shield-track"><span style={{ width: attributes?.maxShield ? (run!.player.shield / attributes.maxShield * 100) + '%' : '0%' }} /></div></div>
          <div className="game-exp"><span>进化进度</span><span>{Math.floor(run?.xp || 0)} / {run?.xpNeeded || 16}</span><div><span style={{ width: run ? Math.min(100, run.xp / run.xpNeeded * 100) + '%' : '0%' }} /></div></div>
          <div className="game-combat-stats"><span>清除目标<strong>{run?.kills || 0}</strong></span><span>累计伤害<strong>{Math.floor(run?.damageDealt || 0).toLocaleString()}</strong></span></div>
        </div>

        <div className="game-route-card">
          <div className="game-section-head"><h2>探索路线</h2><span>{active ? '下次远征可更换' : '选择初始构筑'}</span></div>
          <div className="game-routes">{ROUTES.map((v, index) => {
            const Icon = [Flame, Orbit, Shield][index];
            return <button key={v.id} onClick={() => setRoute(v.id)} disabled={active} className={'game-route' + (route === v.id ? ' selected' : '')}><Icon /><span><strong>{v.title}</strong><small>{v.detail}</small></span>{route === v.id && <Check />}</button>;
          })}</div>
          <p className="game-route-caption">{ROUTES.find(v => v.id === route)?.label} · 升级时可自由混搭</p>
        </div>

        <div className="game-build-card">
          <div className="game-section-head"><h2>已装配强化</h2><span>{run ? Object.values(run.upgrades).reduce((sum, n) => sum + (n || 0), 0) : 0} 次进化</span></div>
          {!run ? <div className="game-empty-build"><Orbit /><p>每一次选择，<br />都会让这趟旅程不同。</p></div> : <div className="game-build-list">{UPGRADES.filter(u => run.upgrades[u.id]).map(u => {
            const Icon = icons[u.id]; return <div key={u.id}><span><Icon />{u.name}</span><strong>{run.upgrades[u.id]}<small> / {u.max}</small></strong></div>;
          })}</div>}
        </div>
        <div className="game-record"><span>累计出发 <strong>{save.runs}</strong></span><span>成功返航 <strong>{save.wins}</strong></span><span>最远波次 <strong>{save.bestWave} / {LAST_WAVE}</strong></span></div>
        {active && !conflict && <button className="game-end" onClick={endEarly}>提前结算本次远征 <ArrowUpRight /></button>}
      </aside>
    </div>
  </section>;
}

function polygon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, points: number, angle = 0) {
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = angle + i / points * Math.PI * 2;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    else ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  ctx.closePath();
}
function paint(canvas: HTMLCanvasElement, run: Expedition | null, time: number, reducedMotion: boolean) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) { canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); }
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a151b'; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / WORLD.width, height / WORLD.height);
  ctx.translate((width - WORLD.width * scale) / 2, (height - WORLD.height * scale) / 2);
  ctx.scale(scale, scale);
  const glow = ctx.createRadialGradient(500, 310, 0, 500, 310, 540);
  glow.addColorStop(0, '#17332f'); glow.addColorStop(.45, '#10252a'); glow.addColorStop(1, '#0a151b');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  ctx.strokeStyle = '#80b4a00d'; ctx.lineWidth = 1;
  for (let x = 20; x < WORLD.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke(); }
  for (let y = 10; y < WORLD.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke(); }
  for (let i = 0; i < 100; i++) {
    const x = (Math.sin(i * 37.8 + 7) * .5 + .5) * WORLD.width, y = (Math.sin(i * 19.1 + 4) * .5 + .5) * WORLD.height;
    ctx.fillStyle = 'rgba(190,224,215,' + (reducedMotion ? .2 : .11 + (Math.sin(time * .6 + i) + 1) * .13) + ')';
    ctx.beginPath(); ctx.arc(x, y, i % 8 === 0 ? 1.5 : .8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#8cc2ae12'; ctx.setLineDash([4, 9]);
  for (const radius of [160, 270, 390]) { ctx.beginPath(); ctx.arc(500, 310, radius, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
  const player = run?.player || { x: 500, y: 310, hp: 110, shield: 30 };
  if (run) {
    if (run.pulseFlash > 0) {
      const radius = (1 - run.pulseFlash / .45) * (190 + (run.upgrades.pulse || 0) * 12);
      ctx.strokeStyle = 'rgba(126,222,201,' + run.pulseFlash / .45 * .7 + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(player.x, player.y, radius, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of run.projectiles) {
      ctx.strokeStyle = p.critical ? '#f4e6b2' : '#87e3c6'; ctx.lineWidth = p.critical ? 3.5 : 2.5; ctx.shadowBlur = 10; ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(p.x - p.vx * .018, p.y - p.vy * .018); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.shadowBlur = 0;
    }
    for (const e of run.enemies) {
      const color = e.type === 'boss' ? '#d498d5' : e.type === 'elite' ? '#f4b67f' : '#c78c70';
      ctx.shadowColor = color; ctx.shadowBlur = e.type === 'normal' ? 9 : 17;
      ctx.strokeStyle = color; ctx.fillStyle = e.type === 'boss' ? '#472747' : '#3e3029'; ctx.lineWidth = e.type === 'normal' ? 1.5 : 2;
      polygon(ctx, e.x, e.y, e.radius, e.type === 'boss' ? 8 : e.type === 'elite' ? 6 : 4, time * (e.id % 2 ? .4 : -.4));
      ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(e.x, e.y, e.type === 'boss' ? 7 : 2.5, 0, Math.PI * 2); ctx.fill();
      if (e.poison > 0) { ctx.strokeStyle = '#a8d99b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 4, 0, Math.PI * 2); ctx.stroke(); }
      if (e.hp < e.maxHp) { ctx.fillStyle = '#081012'; ctx.fillRect(e.x - e.radius, e.y - e.radius - 10, e.radius * 2, 3); ctx.fillStyle = color; ctx.fillRect(e.x - e.radius, e.y - e.radius - 10, Math.max(0, e.hp / e.maxHp) * e.radius * 2, 3); }
    }
    if (!reducedMotion) for (const p of run.sparks) { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color === 'mint' ? '#94ebc9' : p.color === 'white' ? '#fff0be' : '#ecb38e'; ctx.fillRect(p.x, p.y, 2.4, 2.4); }
    ctx.globalAlpha = 1;
  }
  const orbitCount = run?.upgrades.orbit || (!run ? 2 : 0);
  if (orbitCount) {
    ctx.strokeStyle = '#94d5c226'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(player.x, player.y, 80 + orbitCount * 4, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < orbitCount; i++) {
      const a = (run?.elapsed || time) * 2 + i / orbitCount * Math.PI * 2;
      const x = player.x + Math.cos(a) * (80 + orbitCount * 4), y = player.y + Math.sin(a) * (80 + orbitCount * 4);
      ctx.fillStyle = '#b7ead9'; ctx.shadowColor = '#9ce6cc'; ctx.shadowBlur = 18; polygon(ctx, x, y, 5, 4, a); ctx.fill(); ctx.shadowBlur = 0;
    }
  }
  if (player.shield > 0) {
    ctx.strokeStyle = '#8ad6e573'; ctx.fillStyle = '#7ecbd908'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(player.x, player.y, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.save(); ctx.translate(player.x, player.y);
  const nearest = run?.enemies.reduce<{ x: number; y: number } | null>((best, e) => !best || Math.hypot(e.x - player.x, e.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y) ? e : best, null);
  ctx.rotate(nearest ? Math.atan2(nearest.y - player.y, nearest.x - player.x) + Math.PI / 2 : -.3 + Math.sin(time * .7) * .2);
  ctx.fillStyle = '#8cd6ba'; ctx.shadowColor = '#73d8b4'; ctx.shadowBlur = 22;
  ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(12, 12); ctx.lineTo(0, 7); ctx.lineTo(-12, 12); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#dbfff1'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#72bca28c'; ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(0, 25 + Math.sin(time * 12) * 5); ctx.lineTo(4, 12); ctx.fill(); ctx.restore();
  const boss = run?.enemies.find(e => e.type === 'boss');
  if (boss) {
    ctx.font = '500 13px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#e2c0e0'; ctx.fillText('核心守卫', 500, 82);
    ctx.fillStyle = '#352936'; ctx.fillRect(350, 92, 300, 5); ctx.fillStyle = '#c88dc5'; ctx.fillRect(350, 92, 300 * Math.max(0, boss.hp / boss.maxHp), 5);
  }
}

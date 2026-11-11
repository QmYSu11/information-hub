/** Deterministic, browser-independent rules for Signal Expedition. */
export const WORLD = { width: 1000, height: 620 };
export const WAVE_SECONDS = 36;
export const LAST_WAVE = 12;
export const BOSS_TIMEOUT_SECONDS = 180;
export const OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export type Route = 'spark' | 'echo' | 'bastion';
export type UpgradeId = 'damage' | 'haste' | 'split' | 'crit' | 'reach' | 'mobility' | 'ward' | 'regen' | 'vigor' | 'orbit' | 'pulse' | 'poison';
export type RunPhase = 'fighting' | 'choice' | 'victory' | 'defeat';
export interface Upgrade {
  id: UpgradeId; name: string; description: string; family: '星火' | '回响' | '壁垒'; max: number;
}
export const UPGRADES: Upgrade[] = [
  { id: 'damage', name: '聚焦晶核', description: '弹体伤害 +22%，让每次命中更有分量。', family: '星火', max: 5 },
  { id: 'haste', name: '超频驱动', description: '发射频率提升 18%。', family: '星火', max: 5 },
  { id: 'split', name: '分形弹道', description: '每次额外发射一枚散射弹体。', family: '星火', max: 3 },
  { id: 'crit', name: '弱点扫描', description: '暴击率 +10%，暴击造成双倍伤害。', family: '星火', max: 5 },
  { id: 'reach', name: '深空雷达', description: '索敌范围 +45，弹体飞得更远。', family: '回响', max: 4 },
  { id: 'mobility', name: '轻量推进', description: '移动速度 +16，提高自动闪避能力。', family: '壁垒', max: 4 },
  { id: 'ward', name: '棱镜护盾', description: '获得 30 点护盾，脱战后缓慢恢复。', family: '壁垒', max: 5 },
  { id: 'regen', name: '自愈回路', description: '每秒额外恢复 0.5 点生命。', family: '壁垒', max: 5 },
  { id: 'vigor', name: '扩容舱室', description: '生命上限 +30，并恢复 30 点生命。', family: '壁垒', max: 5 },
  { id: 'orbit', name: '环轨卫星', description: '生成环绕卫星，持续打击近身敌人。', family: '回响', max: 5 },
  { id: 'pulse', name: '引力脉冲', description: '周期释放范围冲击，击退附近敌人。', family: '回响', max: 5 },
  { id: 'poison', name: '余辉侵蚀', description: '弹体使敌人受到持续侵蚀伤害。', family: '回响', max: 5 },
];
export interface Enemy { id: number; x: number; y: number; hp: number; maxHp: number; speed: number; radius: number; type: 'normal' | 'elite' | 'boss'; attack: number; poison: number; }
export interface Projectile { id: number; x: number; y: number; vx: number; vy: number; damage: number; life: number; critical: boolean; }
export interface Spark { x: number; y: number; life: number; maxLife: number; color: 'mint' | 'orange' | 'white'; vx: number; vy: number; }
export interface Expedition {
  id: string; seed: number; random: number; route: Route; phase: RunPhase; elapsed: number; wave: number; waveElapsed: number;
  player: { x: number; y: number; hp: number; shield: number; lastHit: number };
  level: number; xp: number; xpNeeded: number; kills: number; damageDealt: number;
  upgrades: Partial<Record<UpgradeId, number>>; choices: UpgradeId[];
  enemies: Enemy[]; projectiles: Projectile[]; sparks: Spark[];
  spawnClock: number; shootClock: number; pulseClock: number; orbitClock: number; bossSpawned: boolean; entityId: number;
  permanentPower: number; permanentHull: number; settled: boolean; reward: number; pulseFlash: number;
}
export interface GameSave {
  version: 1; savedAt: number; lastClaimAt: number; crystals: number; runs: number; wins: number; bestWave: number;
  permanent: { power: number; hull: number; income: number }; current: Expedition | null;
}
/** A session must stop writing once another tab replaces its checkpoint. */
export class GameCheckpointGuard {
  private expected: string;
  blocked = false;
  constructor(initial: unknown) { this.expected = checkpointFingerprint(initial); }
  observe(current: unknown): boolean {
    if (this.blocked) return false;
    if (checkpointFingerprint(current) !== this.expected) { this.blocked = true; return false; }
    return true;
  }
  rememberWrite(next: unknown) {
    if (this.blocked) throw new Error('This expedition checkpoint has been replaced');
    this.expected = checkpointFingerprint(next);
  }
}
function checkpointFingerprint(value: unknown): string {
  try { return value == null ? 'null' : JSON.stringify(value); }
  catch { return 'unsupported-checkpoint'; }
}
export const ROUTES: { id: Route; title: string; detail: string; label: string }[] = [
  { id: 'spark', title: '星火', detail: '高频弹幕 · 集中火力', label: '超频驱动开局' },
  { id: 'echo', title: '回响', detail: '环轨卫星 · 范围清场', label: '环轨卫星开局' },
  { id: 'bastion', title: '壁垒', detail: '护盾回复 · 持久生存', label: '棱镜护盾开局' },
];
export function createGameSave(now = Date.now()): GameSave {
  return { version: 1, savedAt: now, lastClaimAt: now, crystals: 0, runs: 0, wins: 0, bestWave: 0, permanent: { power: 0, hull: 0, income: 0 }, current: null };
}
const finite = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
function validRun(v: unknown): v is Expedition {
  if (!v || typeof v !== 'object') return false;
  const r = v as Expedition;
  if (!['spark', 'echo', 'bastion'].includes(r.route) || !['fighting', 'choice', 'victory', 'defeat'].includes(r.phase)) return false;
  if (typeof r.id !== 'string' || !finite(r.random, 0, 4294967295) || !finite(r.seed, 0, 4294967295)) return false;
  if (!finite(r.wave, 1, LAST_WAVE) || !finite(r.elapsed) || !finite(r.waveElapsed) || !finite(r.level, 1, 200) || !finite(r.xp) || !finite(r.xpNeeded, 1)) return false;
  if (!r.player || !finite(r.player.x, 0, WORLD.width) || !finite(r.player.y, 0, WORLD.height) || !finite(r.player.hp, 0, 100000) || !finite(r.player.shield, 0, 100000) || !finite(r.player.lastHit, -100)) return false;
  if (!r.upgrades || typeof r.upgrades !== 'object' || !Object.entries(r.upgrades).every(([id, n]) => UPGRADES.some(u => u.id === id && finite(n, 0, u.max)))) return false;
  if (!Array.isArray(r.choices) || r.choices.length > 3 || !r.choices.every(id => UPGRADES.some(u => u.id === id))) return false;
  if (!Array.isArray(r.enemies) || r.enemies.length > 60 || !r.enemies.every(e => finite(e.id) && finite(e.x, -100, WORLD.width + 100) && finite(e.y, -100, WORLD.height + 100) && finite(e.hp, -100000, 100000) && finite(e.maxHp, 1, 100000) && finite(e.speed, 0, 500) && finite(e.radius, 1, 100) && finite(e.attack, 0, 1000) && finite(e.poison) && ['normal', 'elite', 'boss'].includes(e.type))) return false;
  if (!Array.isArray(r.projectiles) || r.projectiles.length > 180 || !r.projectiles.every(p => finite(p.id) && finite(p.x, -100, WORLD.width + 100) && finite(p.y, -100, WORLD.height + 100) && finite(p.vx, -2000, 2000) && finite(p.vy, -2000, 2000) && finite(p.damage, 0, 100000) && finite(p.life, 0, 20))) return false;
  if (!Array.isArray(r.sparks) || r.sparks.length > 150 || !r.sparks.every(p => finite(p.x, -500, WORLD.width + 500) && finite(p.y, -500, WORLD.height + 500) && finite(p.life, 0, 2) && finite(p.maxLife, .01, 2) && finite(p.vx, -500, 500) && finite(p.vy, -500, 500) && ['mint', 'orange', 'white'].includes(p.color))) return false;
  return ['kills', 'damageDealt', 'spawnClock', 'shootClock', 'pulseClock', 'orbitClock', 'entityId', 'permanentPower', 'permanentHull', 'reward', 'pulseFlash'].every(k => finite(r[k as keyof Expedition], 0, 1e12)) && typeof r.bossSpawned === 'boolean' && typeof r.settled === 'boolean';
}
export function isGameSave(value: unknown): value is GameSave {
  if (!value || typeof value !== 'object') return false;
  const s = value as GameSave;
  return s.version === 1 && finite(s.savedAt) && finite(s.lastClaimAt) && finite(s.crystals, 0, 1e12) && finite(s.runs, 0, 1e9) && finite(s.wins, 0, s.runs) && finite(s.bestWave, 0, LAST_WAVE)
    && !!s.permanent && [s.permanent.power, s.permanent.hull, s.permanent.income].every(n => finite(n, 0, 10) && Number.isInteger(n))
    && (s.current === null || validRun(s.current));
}
/** Keep only simulation state. Visual particles are intentionally not persisted. */
export function packGameSave(save: GameSave, now = Date.now()): GameSave {
  const copy = structuredClone(save);
  copy.savedAt = now;
  if (copy.current) copy.current.sparks = [];
  return copy;
}
/** Claims are cursor-based; recomputing after persistence cannot grant the same minutes twice. */
export function claimOffline(save: GameSave, now = Date.now()): { save: GameSave; earned: number; seconds: number } {
  const copy = structuredClone(save);
  const elapsed = Math.max(0, Math.floor((now - copy.lastClaimAt) / 1000));
  const seconds = Math.min(OFFLINE_CAP_SECONDS, elapsed);
  const minutes = Math.floor(seconds / 60);
  const earned = minutes * (1 + copy.permanent.income);
  if (elapsed >= OFFLINE_CAP_SECONDS) copy.lastClaimAt = now;
  else if (minutes > 0) copy.lastClaimAt += minutes * 60000;
  copy.crystals += earned;
  copy.savedAt = now;
  return { save: copy, earned, seconds };
}
function random(r: Expedition): number {
  let x = r.random | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  r.random = x >>> 0;
  return r.random / 4294967296;
}
export function stats(r: Expedition) {
  const u = (id: UpgradeId) => r.upgrades[id] || 0;
  return {
    damage: (12 + r.permanentPower * 2) * (1 + u('damage') * .22),
    interval: .66 / (1 + u('haste') * .18),
    range: 360 + u('reach') * 45,
    pellets: 1 + u('split'), critical: .06 + u('crit') * .1,
    speed: 112 + u('mobility') * 16,
    maxHp: 110 + r.permanentHull * 12 + u('vigor') * 30,
    maxShield: u('ward') * 30, regen: .18 + u('regen') * .5,
    orbit: u('orbit'), pulse: u('pulse'), poison: u('poison'),
  };
}
export function startRun(save: GameSave, route: Route, now = Date.now(), seed = Math.floor(Math.random() * 4294967295) || 1): GameSave {
  const next = structuredClone(save);
  if (next.current && !['victory', 'defeat'].includes(next.current.phase)) return next;
  const upgrades: Partial<Record<UpgradeId, number>> = route === 'spark' ? { haste: 1 } : route === 'echo' ? { orbit: 1 } : { ward: 1 };
  const r: Expedition = {
    id: 'run-' + now + '-' + seed, seed, random: seed || 1, route, phase: 'fighting', elapsed: 0, wave: 1, waveElapsed: 0,
    player: { x: 500, y: 310, hp: 110 + next.permanent.hull * 12, shield: route === 'bastion' ? 30 : 0, lastHit: -10 },
    level: 1, xp: 0, xpNeeded: 16, kills: 0, damageDealt: 0, upgrades, choices: [],
    enemies: [], projectiles: [], sparks: [], spawnClock: .4, shootClock: 0, pulseClock: 0, orbitClock: 0, bossSpawned: false, entityId: 1,
    permanentPower: next.permanent.power, permanentHull: next.permanent.hull, settled: false, reward: 0, pulseFlash: 0,
  };
  next.current = r; next.savedAt = now; next.runs += 1;
  return next;
}
function makeEnemy(r: Expedition, type: Enemy['type']) {
  const side = Math.floor(random(r) * 4);
  const x = side === 0 ? 8 : side === 1 ? WORLD.width - 8 : 20 + random(r) * (WORLD.width - 40);
  const y = side === 2 ? 8 : side === 3 ? WORLD.height - 8 : 20 + random(r) * (WORLD.height - 40);
  const hp = type === 'boss' ? 1500 : type === 'elite' ? 100 + r.wave * 15 : 18 + r.wave * 5;
  r.enemies.push({ id: r.entityId++, x, y, hp, maxHp: hp, speed: type === 'boss' ? 38 : type === 'elite' ? 56 : 40 + r.wave * 2.4 + random(r) * 12, radius: type === 'boss' ? 35 : type === 'elite' ? 19 : 10 + random(r) * 4, type, attack: type === 'boss' ? 25 : type === 'elite' ? 18 : 10, poison: 0 });
}
function sparkle(r: Expedition, x: number, y: number, color: Spark['color'], count = 5) {
  for (let i = 0; i < count; i++) {
    const a = random(r) * Math.PI * 2, speed = 15 + random(r) * 65;
    r.sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: .35 + random(r) * .35, maxLife: .7, color });
  }
  if (r.sparks.length > 150) r.sparks.splice(0, r.sparks.length - 150);
}
function hit(r: Expedition, e: Enemy, damage: number) {
  const actual = Math.min(Math.max(e.hp, 0), damage);
  e.hp -= damage; r.damageDealt += actual;
}
function offer(r: Expedition) {
  const available = UPGRADES.filter(u => (r.upgrades[u.id] || 0) < u.max).map(u => u.id);
  r.choices = [];
  while (r.choices.length < 3 && available.length) {
    const index = Math.floor(random(r) * available.length);
    r.choices.push(available.splice(index, 1)[0]);
  }
  if (r.choices.length) r.phase = 'choice';
}
export function chooseUpgrade(r: Expedition, id: UpgradeId): boolean {
  if (r.phase !== 'choice' || !r.choices.includes(id)) return false;
  const spec = UPGRADES.find(u => u.id === id);
  if (!spec || (r.upgrades[id] || 0) >= spec.max) return false;
  r.upgrades[id] = (r.upgrades[id] || 0) + 1;
  if (id === 'vigor') r.player.hp += 30;
  if (id === 'ward') r.player.shield += 30;
  r.choices = []; r.phase = 'fighting';
  if (r.xp >= r.xpNeeded) { r.xp -= r.xpNeeded; r.level++; r.xpNeeded = Math.floor(r.xpNeeded * 1.2 + 5); offer(r); }
  return true;
}
export function autoChoose(r: Expedition): UpgradeId | null {
  if (r.phase !== 'choice') return null;
  const family = ROUTES.find(v => v.id === r.route)?.title;
  const preferred = r.choices.find(id => UPGRADES.find(u => u.id === id)?.family === family);
  const pick = preferred || r.choices[0];
  return pick && chooseUpgrade(r, pick) ? pick : null;
}
/** Mutates a run to avoid allocating the combat world every animation frame. */
export function stepRun(r: Expedition, seconds: number) {
  if (r.phase !== 'fighting' || !Number.isFinite(seconds) || seconds <= 0) return;
  const dt = Math.min(seconds, .1);
  const s = stats(r);
  r.elapsed += dt; r.waveElapsed += dt; r.pulseFlash = Math.max(0, r.pulseFlash - dt);
  r.player.hp = Math.min(s.maxHp, r.player.hp + s.regen * dt);
  if (r.elapsed - r.player.lastHit > 5) r.player.shield = Math.min(s.maxShield, r.player.shield + (2 + s.maxShield * .04) * dt);
  if (r.waveElapsed >= WAVE_SECONDS && r.wave < LAST_WAVE) {
    r.wave++; r.waveElapsed = 0;
    if (r.wave === 4 || r.wave === 8) makeEnemy(r, 'elite');
  }
  if (r.wave === LAST_WAVE && !r.bossSpawned) { makeEnemy(r, 'boss'); r.bossSpawned = true; }
  if (r.wave === LAST_WAVE && r.waveElapsed >= BOSS_TIMEOUT_SECONDS) { r.player.hp = 0; r.phase = 'defeat'; return; }
  r.spawnClock = Math.max(0, r.spawnClock - dt);
  if (r.spawnClock <= 0 && r.enemies.length < 46) {
    makeEnemy(r, 'normal'); r.spawnClock = Math.max(.45, 1.8 - r.wave * .09);
  }
  // A gentle patrol with a separation force: no keyboard input is required.
  let ax = Math.cos(r.elapsed * .27) * .35 + (500 - r.player.x) / 600;
  let ay = Math.sin(r.elapsed * .23) * .35 + (310 - r.player.y) / 400;
  for (const e of r.enemies) {
    const dx = r.player.x - e.x, dy = r.player.y - e.y, distance = Math.hypot(dx, dy);
    if (distance < 160 && distance > 0) { const force = (160 - distance) / 90; ax += dx / distance * force; ay += dy / distance * force; }
  }
  const move = Math.hypot(ax, ay);
  if (move > 0) { r.player.x += ax / Math.max(1, move) * s.speed * dt; r.player.y += ay / Math.max(1, move) * s.speed * dt; }
  r.player.x = Math.max(45, Math.min(WORLD.width - 45, r.player.x));
  r.player.y = Math.max(45, Math.min(WORLD.height - 45, r.player.y));
  r.shootClock -= dt;
  if (r.shootClock <= 0) {
    let closest: Enemy | undefined; let nearest = s.range;
    for (const e of r.enemies) { const d = Math.hypot(e.x - r.player.x, e.y - r.player.y); if (e.hp > 0 && d < nearest) { nearest = d; closest = e; } }
    if (closest && r.projectiles.length < 160) {
      const angle = Math.atan2(closest.y - r.player.y, closest.x - r.player.x);
      for (let i = 0; i < s.pellets; i++) {
        const a = angle + (i - (s.pellets - 1) / 2) * .15;
        const critical = random(r) < s.critical;
        r.projectiles.push({ id: r.entityId++, x: r.player.x, y: r.player.y, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500, damage: s.damage * (critical ? 2 : 1), life: s.range / 400, critical });
      }
      r.shootClock = s.interval;
    } else r.shootClock = .08;
  }
  for (const p of r.projectiles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    for (const e of r.enemies) {
      if (e.hp <= 0 || p.life <= 0) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 5) {
        hit(r, e, p.damage); e.poison = Math.max(e.poison, s.poison ? 3 : 0);
        p.life = 0; sparkle(r, p.x, p.y, p.critical ? 'white' : 'mint', 3); break;
      }
    }
  }
  r.projectiles = r.projectiles.filter(p => p.life > 0 && p.x > -30 && p.x < WORLD.width + 30 && p.y > -30 && p.y < WORLD.height + 30);
  r.orbitClock += dt; r.pulseClock += dt;
  const orbitTick = s.orbit > 0 && r.orbitClock > .3;
  if (orbitTick) r.orbitClock = 0;
  const pulse = s.pulse > 0 && r.pulseClock >= 5 / (1 + s.pulse * .16);
  if (pulse) { r.pulseClock = 0; r.pulseFlash = .45; }
  for (const e of r.enemies) {
    const dx = r.player.x - e.x, dy = r.player.y - e.y, distance = Math.hypot(dx, dy);
    if (e.poison > 0) { hit(r, e, s.poison * 4 * dt); e.poison = Math.max(0, e.poison - dt); }
    if (orbitTick && distance < 93 + s.orbit * 5) hit(r, e, 5 + s.orbit * 4);
    if (pulse && distance < 190 + s.pulse * 12) { hit(r, e, 18 + s.pulse * 12); e.x -= dx / Math.max(1, distance) * 26; e.y -= dy / Math.max(1, distance) * 26; }
    if (distance > 0) { e.x += dx / distance * e.speed * dt; e.y += dy / distance * e.speed * dt; }
    e.x = Math.max(-50, Math.min(WORLD.width + 50, e.x)); e.y = Math.max(-50, Math.min(WORLD.height + 50, e.y));
    if (e.hp > 0 && distance < e.radius + 15) {
      const damage = e.attack * dt;
      const shieldDamage = Math.min(r.player.shield, damage);
      r.player.shield -= shieldDamage; r.player.hp -= damage - shieldDamage; r.player.lastHit = r.elapsed;
    }
    if (e.hp <= 0) {
      r.kills++; r.xp += e.type === 'boss' ? 100 : e.type === 'elite' ? 24 : 5;
      sparkle(r, e.x, e.y, 'orange', e.type === 'normal' ? 6 : 16);
      if (e.type === 'boss') r.phase = 'victory';
    }
  }
  r.enemies = r.enemies.filter(e => e.hp > 0);
  for (const p of r.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  r.sparks = r.sparks.filter(p => p.life > 0);
  if (r.player.hp <= 0) { r.player.hp = 0; r.phase = 'defeat'; }
  if (r.phase === 'fighting' && r.xp >= r.xpNeeded) { r.xp -= r.xpNeeded; r.level++; r.xpNeeded = Math.floor(r.xpNeeded * 1.2 + 5); offer(r); }
}
export function settleRun(save: GameSave, now = Date.now()): number {
  const r = save.current;
  if (!r || r.settled || !['victory', 'defeat'].includes(r.phase)) return 0;
  const reward = r.wave * 5 + Math.floor(r.kills / 3) + (r.phase === 'victory' ? 100 : 0);
  r.reward = reward; r.settled = true;
  save.crystals += reward; save.bestWave = Math.max(save.bestWave, r.wave);
  if (r.phase === 'victory') save.wins++;
  save.savedAt = now;
  return reward;
}
export function permanentCost(save: GameSave, kind: keyof GameSave['permanent']): number {
  return 40 + save.permanent[kind] * 35;
}
export function buyPermanent(save: GameSave, kind: keyof GameSave['permanent']): GameSave | null {
  if (save.permanent[kind] >= 10) return null;
  const cost = permanentCost(save, kind);
  if (save.crystals < cost) return null;
  const next = structuredClone(save);
  next.crystals -= cost; next.permanent[kind]++;
  return next;
}

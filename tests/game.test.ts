import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoChoose, BOSS_TIMEOUT_SECONDS, buyPermanent, chooseUpgrade, claimOffline, createGameSave, GameCheckpointGuard, isGameSave, LAST_WAVE, OFFLINE_CAP_SECONDS,
  packGameSave, permanentCost, settleRun, startRun, stats, stepRun, UPGRADES, type Expedition,
} from '../src/lib/game-engine';

const origin = Date.UTC(2026, 10, 11);
function tick(run: Expedition, steps: number) {
  for (let i = 0; i < steps; i++) {
    if (run.phase === 'choice') autoChoose(run);
    stepRun(run, .05);
  }
}

test('offline rewards claim only whole minutes, preserving remainder without duplicate credit', () => {
  const original = createGameSave(origin);
  const a = claimOffline(original, origin + 90000);
  assert.equal(a.earned, 1);
  assert.equal(a.save.lastClaimAt, origin + 60000);
  assert.equal(original.crystals, 0, 'the source save remains unchanged');
  const b = claimOffline(a.save, origin + 90000);
  assert.equal(b.earned, 0);
  assert.equal(b.save.crystals, 1);
  const c = claimOffline(b.save, origin + 120000);
  assert.equal(c.earned, 1);
  assert.equal(c.save.crystals, 2);
});

test('offline rewards cap at eight hours and discard time beyond the cap', () => {
  const save = createGameSave(origin);
  save.permanent.income = 2;
  const now = origin + 48 * 3600000;
  const result = claimOffline(save, now);
  assert.equal(result.seconds, OFFLINE_CAP_SECONDS);
  assert.equal(result.earned, 480 * 3);
  assert.equal(claimOffline(result.save, now).earned, 0);
  assert.equal(claimOffline(result.save, now - 3600000).earned, 0, 'backwards time cannot create resources');
  assert.equal(result.save.current, null, 'offline time never simulates combat');
});

test('an active expedition cannot be silently replaced and its permanent stats are snapshotted', () => {
  const save = createGameSave(origin);
  save.crystals = 1000;
  const active = startRun(save, 'spark', origin, 7);
  const id = active.current!.id;
  const upgraded = buyPermanent(active, 'power')!;
  assert.equal(upgraded.current!.permanentPower, 0);
  assert.equal(upgraded.permanent.power, 1);
  assert.equal(startRun(upgraded, 'echo', origin + 1000, 9).current!.id, id);
  upgraded.current!.phase = 'defeat';
  settleRun(upgraded, origin + 1000);
  const next = startRun(upgraded, 'echo', origin + 2000, 9);
  assert.equal(next.current!.permanentPower, 1);
  assert.equal(next.runs, 2);
  assert.ok(next.current!.upgrades.orbit);
  assert.equal(stats(next.current!).damage, 14);
});

test('permanent growth cannot spend unavailable crystals or exceed the level cap', () => {
  const save = createGameSave(origin);
  assert.equal(buyPermanent(save, 'hull'), null);
  save.crystals = 40;
  const next = buyPermanent(save, 'hull')!;
  assert.equal(next.crystals, 0);
  assert.equal(permanentCost(next, 'hull'), 75);
  next.permanent.hull = 10;
  next.crystals = 10000;
  assert.equal(buyPermanent(next, 'hull'), null);
  assert.equal(save.permanent.hull, 0);
});

test('level choices pause combat and accept only a currently offered upgrade', () => {
  const save = startRun(createGameSave(origin), 'bastion', origin, 12);
  const r = save.current!;
  r.xp = r.xpNeeded;
  stepRun(r, .05);
  assert.equal(r.phase, 'choice');
  assert.equal(r.choices.length, 3);
  const elapsed = r.elapsed;
  stepRun(r, 10);
  assert.equal(r.elapsed, elapsed);
  const absent = UPGRADES.find(u => !r.choices.includes(u.id))!.id;
  assert.equal(chooseUpgrade(r, absent), false);
  const choice = r.choices[0], before = r.upgrades[choice] || 0;
  assert.equal(chooseUpgrade(r, choice), true);
  assert.equal(r.upgrades[choice], before + 1);
  assert.equal(r.phase, 'fighting');
  assert.equal(chooseUpgrade(r, choice), false, 'one upgrade cannot be purchased twice from the same selection');
});

test('victory and defeat settle exactly once, including after save and restore', () => {
  const save = startRun(createGameSave(origin), 'echo', origin, 50);
  const r = save.current!;
  r.phase = 'victory'; r.wave = LAST_WAVE; r.kills = 60;
  assert.equal(settleRun(save, origin + 1000), 180);
  assert.equal(save.crystals, 180);
  assert.equal(save.wins, 1);
  const restored = packGameSave(save, origin + 2000);
  assert.equal(settleRun(restored, origin + 3000), 0);
  assert.equal(restored.crystals, 180);
  assert.equal(restored.wins, 1);
});

test('saved simulation resumes deterministically and rejects broken or unsupported saves', () => {
  const first = startRun(createGameSave(origin), 'echo', origin, 1234);
  tick(first.current!, 1500);
  const checkpoint = packGameSave(first, origin + 1000);
  assert.ok(isGameSave(checkpoint), 'a real combat checkpoint must be restorable');
  const second = structuredClone(checkpoint);
  tick(first.current!, 2000);
  tick(second.current!, 2000);
  const a = packGameSave(first, origin + 2000), b = packGameSave(second, origin + 2000);
  assert.deepEqual(a, b);
  assert.equal(isGameSave({ ...checkpoint, version: 999 }), false);
  assert.equal(isGameSave({ ...checkpoint, crystals: NaN }), false);
  assert.equal(isGameSave({ ...checkpoint, current: { ...checkpoint.current, sparks: {} } }), false);
});

test('background gaps are not simulated and boss defeat is a complete victory path', () => {
  const save = startRun(createGameSave(origin), 'spark', origin, 42);
  const r = save.current!;
  stepRun(r, 1000);
  assert.equal(r.elapsed, .1);
  r.wave = LAST_WAVE; r.bossSpawned = true;
  r.enemies = [{ id: 999, x: 510, y: 310, hp: 1, maxHp: 1, speed: 0, radius: 35, type: 'boss', attack: 0, poison: 1 }];
  r.upgrades.poison = 1;
  for (let i = 0; i < 10; i++) stepRun(r, .1);
  assert.equal(r.phase, 'victory');
  assert.ok(settleRun(save) > 100);
  assert.ok(isGameSave(packGameSave(save)));
});

test('a defensive build cannot leave the final boss phase running forever', () => {
  const save = startRun(createGameSave(origin), 'bastion', origin, 99);
  const r = save.current!;
  r.wave = LAST_WAVE; r.waveElapsed = BOSS_TIMEOUT_SECONDS - .05;
  stepRun(r, .1);
  assert.equal(r.phase, 'defeat');
  assert.equal(r.player.hp, 0);
  assert.ok(settleRun(save) > 0);
  assert.equal(settleRun(save), 0);
});

test('an old session cannot overwrite an externally imported or advanced checkpoint', () => {
  const original = startRun(createGameSave(origin), 'echo', origin, 51);
  const guard = new GameCheckpointGuard(original);
  assert.equal(guard.observe(structuredClone(original)), true, 'unrelated personal edits clone but do not change the checkpoint');
  const own = packGameSave(original, origin + 5000);
  guard.rememberWrite(own);
  assert.equal(guard.observe(structuredClone(own)), true, 'the session recognizes its own completed write');
  const imported = createGameSave(origin + 6000);
  imported.crystals = 900;
  assert.equal(guard.observe(imported), false, 'an import freezes the old session before its next write');
  assert.equal(guard.blocked, true);
  assert.throws(() => guard.rememberWrite(own), /replaced/);
  assert.equal(guard.observe(own), false, 'a frozen session cannot revive itself using an old checkpoint');
  const reloaded = new GameCheckpointGuard(imported);
  assert.equal(reloaded.observe(structuredClone(imported)), true, 'only an explicit reload starts a new eligible session');
  assert.equal(new GameCheckpointGuard(own).observe(null), false, 'an external reset is also protected');
});

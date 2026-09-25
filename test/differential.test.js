// Plays the original program (rebuilt from the disassembly, run in a Z80
// core) and src/game side by side with the same input and checks that their
// RAM and tile map agree every frame. Needs reference/program.bin (run
// `npm run rom`); skipped when it is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { available } from '../tools/emu/host.mjs';

const skip = !available();
const load = () => import('../tools/emu/diff.mjs');

function check(r) {
  assert.equal(r.mismatch, null, JSON.stringify(r.mismatch, null, 1));
}

test('a whole game from the intro to GAME OVER matches', { skip }, async () => {
  const { runDiff, randomInput } = await load();
  const r = runDiff({ input: randomInput(1), maxFrames: 20000, stopWhen: (h) => h.mem[0x600a] === 0x14 });
  check(r);
  assert.ok(r.stopped, 'reached game over');
});

for (const [screen, name] of [[1, 'girders'], [2, 'conveyors'], [3, 'elevators'], [4, 'rivets']]) {
  test(`random play on the ${name} matches`, { skip }, async () => {
    const { runDiff, randomInput, onStage } = await load();
    for (const seed of [11, 12]) check(runDiff({ input: randomInput(seed * screen), maxFrames: 6000, ...onStage(screen) }));
  });

  test(`clearing the ${name} and going on to the next stage matches`, { skip }, async () => {
    const { runDiff, onStage } = await load();
    const opts = onStage(screen, { lives: 5 });
    // once play starts, finish the stage: put Mario at the top, or pull every rivet
    opts.steps.push({ at: 0x0c, setup(h) {
      const m = h.mem;
      if (screen === 4) m[0x6290] = 0;
      else m[0x6205] = screen === 2 ? 0x50 : 0x30;
    } });
    check(runDiff({ maxFrames: 3000, ...opts }));
  });
}

// Where a jump from a standstill grabs a hammer (found with the engine by search).
const HAMMERS = { 1: [[0x24, 0x6c], [0xbb, 0xcc]], 2: [[0x23, 0x9c], [0x7b, 0xc4]], 4: [[0x7c, 0x74]] };

for (const [screen, spots] of Object.entries(HAMMERS)) {
  test(`grabbing a hammer and smashing things on screen ${screen} matches`, { skip }, async () => {
    const { runDiff, randomInput, onStage } = await load();
    for (const [x, y] of spots) {
      const opts = onStage(Number(screen));
      opts.steps.push({ at: 0x0c, setup(h) { h.mem[0x6203] = x; h.mem[0x6205] = y; } });
      const rnd = randomInput(x + y);
      let grabbed = false;
      const stop = opts.stopWhen;
      const r = runDiff({
        ...opts,
        maxFrames: 4000,
        input: (f) => (f < 3 ? 0x10 : rnd()),
        stopWhen: (h, g) => { if (g.m[0x6217]) grabbed = true; return stop(h); },
      });
      check(r);
      assert.ok(grabbed, `hammer at ${x.toString(16)},${y.toString(16)} was grabbed`);
    }
  });
}

test('running out of time matches', { skip }, async () => {
  const { runDiff, onStage } = await load();
  for (const screen of [1, 2, 3, 4]) {
    const opts = onStage(screen, { lives: 2 });
    opts.steps.push({ at: 0x0c, setup(h) { h.mem[0x62b1] = 1; } });
    check(runDiff({ ...opts, maxFrames: 3000 }));
  }
});

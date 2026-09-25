// Differential runner: plays the original program (in the emulator) and
// src/game side by side from the same RAM state with the same joystick
// input, and reports the first frame where their memory differs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Host } from './host.mjs';
import { Machine } from '../../src/game/machine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));

// RAM compared every frame: all of work RAM below the stack, the sprite list,
// and the tile map. $6019 is left out: it counts idle passes of the main
// loop, so it depends on CPU timing; the engine is fed the emulator's value.
const RANGES = [[0x6000, 0x6b00], [0x7400, 0x7800]];

/** Deterministic PRNG for generated input. */
export function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Random joystick input: runs of held directions with jump taps. */
export function randomInput(seed) {
  const r = lcg(seed);
  let held = 0, left = 0;
  return () => {
    if (left-- <= 0) {
      left = 5 + Math.floor(r() * 60);
      const d = [0, 0x01, 0x02, 0x04, 0x08, 0x01, 0x02][Math.floor(r() * 7)];
      held = d;
    }
    return held | (r() < 0.04 ? 0x10 : 0);
  };
}

/**
 * Boot the original, start a one-player game, optionally tweak its RAM
 * (setup(host) is called once when GameMode2 reaches `at`), then copy its
 * RAM into a fresh engine and run both for up to maxFrames.
 * Returns {frames, mismatch: null | {...}, host, game}.
 */
export function runDiff({ input = () => 0, maxFrames = 5000, at = null, setup = null, steps = [], stopWhen = null, dsw } = {}) {
  const host = new Host({ dsw });
  host.startOnePlayerGame = host.startOnePlayerGame.bind(host);
  // coin up and start, then run until the game proper begins
  host.runUntil((h) => h.mem[0x6005] === 1, 2000);
  host.in2 = 0x80; host.runFrames(4); host.in2 = 0; host.runFrames(8);
  host.in2 = 0x04; host.runFrames(4); host.in2 = 0;
  host.runUntil((h) => h.mem[0x6005] === 3, 100);
  if (at !== null) steps = [{ at, setup }, ...steps];
  for (const st of steps) {
    host.runUntil((h) => h.mem[0x600a] === st.at, 20000);
    if (st.setup) st.setup(host);
  }

  let emuRng2 = 0;
  const game = new Machine(tables, { rng2: () => emuRng2 });
  sync(host, game);

  let resyncs = 0;
  for (let f = 0; f < maxFrames; f++) {
    const in0 = input(f, host);
    host.in0 = in0;
    emuRng2 = host.mem[0x6019];
    // Where did this NMI interrupt the main loop? That decides two things the
    // engine can't know because they depend on CPU timing:
    // - if the idle pass had already bumped $6019 ($02D1/$02D4), the oil can
    //   flicker after this NMI sees it without the extra +1;
    // - if it landed inside the once-a-frame work ($02D7-$02E1 and the
    //   routines called there), the original finishes or repeats that work
    //   after the NMI. Those frames are not checked; the engine is resynced.
    const sp = host.cpu.regs.sp;
    const ret = host.mem[sp] | (host.mem[sp + 1] << 8);
    const racy = [0x02d7, 0x02da, 0x02db, 0x02de, 0x02e1].includes(ret) || (ret >= 0x037f && ret < 0x03fb);
    const rngStep = ret === 0x02d1 || ret === 0x02d4 ? 0 : 1;
    host.runTick();
    game.frame(in0, { rngStep });
    if (racy) { resyncs++; sync(host, game); continue; }
    const bad = compare(host, game);
    if (bad) return { frames: f + 1, resyncs, mismatch: { frame: f, ...bad, mode: host.mem[0x600a], screen: host.mem[0x6227] }, host, game };
    if (stopWhen && stopWhen(host, game)) return { frames: f + 1, resyncs, mismatch: null, host, game, stopped: true };
  }
  return { frames: maxFrames, resyncs, mismatch: null, host, game };
}

function sync(host, game) {
  for (const [a, b] of RANGES) game.m.set(host.mem.subarray(a, b), a);
}

function compare(host, game) {
  const diffs = [];
  for (const [a, b] of RANGES) {
    for (let i = a; i < b; i++) {
      if (host.mem[i] !== game.m[i] && i !== 0x6019) diffs.push(i);
    }
  }
  if (!diffs.length) return null;
  const hex = (v, n = 2) => v.toString(16).padStart(n, '0');
  return {
    addrs: diffs.slice(0, 12).map((i) => `${hex(i, 4)}: emu ${hex(host.mem[i])} js ${hex(game.m[i])}`),
    count: diffs.length,
  };
}

/**
 * Options for runDiff that start play on a given stage (1 girders, 2 conveyors,
 * 3 elevators, 4 rivets) of a given level, with plenty of lives, and stop at
 * game over.
 */
export function onStage(screen, { level = 3, lives = 20 } = {}) {
  // level 3's stage list at $3A6A is 1 2 3 4, so the pointer can sit on any of them
  return {
    steps: [{ at: 0x0a, setup(h) {
      const m = h.mem;
      m[0x6227] = screen;
      m[0x622a] = 0x6a + screen - 1; m[0x622b] = 0x3a;
      m[0x6229] = level;
      m[0x6228] = lives;
    } }],
    stopWhen: (h) => h.mem[0x600a] === 0x14,
  };
}

// CLI: node tools/emu/diff.mjs [seed] [frames] [screen]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seed = Number(process.argv[2] || 1);
  const frames = Number(process.argv[3] || 5000);
  const screen = Number(process.argv[4] || 0);
  const r = runDiff({ input: randomInput(seed), maxFrames: frames, ...(screen ? onStage(screen) : { stopWhen: (h) => h.mem[0x600a] === 0x14 }) });
  console.log(r.mismatch ? { frames: r.frames, resyncs: r.resyncs, ...r.mismatch } : `ok: ${r.frames} frames (${r.resyncs} resyncs), mode ${r.host.mem[0x600a].toString(16)} screen ${r.host.mem[0x6227]} level ${r.host.mem[0x6229]}`);
}

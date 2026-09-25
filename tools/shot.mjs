#!/usr/bin/env node
// Renders game frames to PNG for checking the art: plays the engine from the
// start (or onto a stage) and saves the frames asked for.
// node tools/shot.mjs <out-prefix> [--screen N] [--frames a,b,c] [--seed S] [--scale K]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/game/machine.js';
import { startGame } from '../src/game/flow.js';
import { Screen, SCREEN_W, SCREEN_H } from '../src/render/screen.js';
import { Raster } from './png.js';
import { randomInput } from './emu/diff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] || 'shot';
const screenNo = Number(opt('--screen', 0));
const frames = opt('--frames', '100').split(',').map(Number);
const scale = Number(opt('--scale', 3));
const input = randomInput(Number(opt('--seed', 1)));
const idle = args.includes('--idle');

const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));
const g = new Machine(tables);
startGame(g, { lives: 5 });
const screen = new Screen();
let f = 0;
if (screenNo) {
  while (g.m[0x600a] !== 0x0a) { g.frame(0); f++; }
  g.m[0x6227] = screenNo; g.m[0x622a] = 0x6a + screenNo - 1; g.m[0x622b] = 0x3a; g.m[0x6229] = 3;
  f = 0;
}
const last = Math.max(...frames);
for (; f <= last; f++) {
  if (frames.includes(f)) {
    const rgba = screen.draw(g);
    const r = new Raster(SCREEN_W, SCREEN_H);
    for (let i = 0; i < SCREEN_W * SCREEN_H; i++) r.data.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    fs.writeFileSync(`${out}-${f}.png`, r.encode(scale));
  }
  g.frame(idle ? 0 : input());
}

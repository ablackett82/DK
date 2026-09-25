#!/usr/bin/env node
// Renders the home-screen icons from this project's Kong face sprite:
// icons/icon-180.png (iOS), icon-192.png, icon-512.png.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster, hexToRgb } from './png.js';
import { SPRITES } from '../src/render/sprites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAL = [null, '#a4521e', '#f2b16e', '#ffffff'].map((h) => h && hexToRgb(h));
const face = SPRITES[0x23];

function icon(size, scale) {
  const r = new Raster(size, size);
  r.fill(0, 0, size, size, [0, 0, 0]);
  const off = (size - 16) >> 1;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = face[y].charCodeAt(x) - 48;
    if (v >= 1 && v <= 3) r.set(off + x, off + y, PAL[v]);
  }
  return r.encode(scale);
}

fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'icons/icon-180.png'), icon(20, 9));
fs.writeFileSync(path.join(ROOT, 'icons/icon-192.png'), icon(24, 8));
fs.writeFileSync(path.join(ROOT, 'icons/icon-512.png'), icon(32, 16));
console.log('wrote icons/icon-{180,192,512}.png');

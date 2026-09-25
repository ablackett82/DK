#!/usr/bin/env node
// Writes data/tables.json: the data tables of the arcade program (stage
// layouts, animation scripts, text, score values...), i.e. every byte the
// dkdasm listing presents as data rather than as an instruction. The game
// engine in src/game loads them at their original addresses so its table
// lookups read exactly what the original did. No code bytes are exported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRom } from './buildrom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = buildRom();
if (!r.chips.every((c) => c.ok)) throw new Error('program rebuild does not match the MAME checksums; run tools/buildrom.mjs');

const runs = [];
for (let a = 0, s = -1; a <= 0x4000; a++) {
  const d = a < 0x4000 && r.isData[a];
  if (d && s < 0) s = a;
  if (!d && s >= 0) { runs.push([s, r.bin.subarray(s, a).toString('hex')]); s = -1; }
}
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'tables.json'), JSON.stringify({ runs }) + '\n');
console.log(`data/tables.json: ${runs.length} runs, ${runs.reduce((n, [, h]) => n + h.length / 2, 0)} bytes`);

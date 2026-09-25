#!/usr/bin/env node
// Rebuilds the Donkey Kong program ROM ($0000-$3FFF) from the byte columns of
// the dkdasm listing (reference/dkdasm/dkong.asm) and checks each 4K chip
// against the SHA1 that MAME publishes for the "dkong" set. Writes
// reference/program.bin (gitignored: it is Nintendo's code, used only by the
// local emulator tests and the extractor).
//
// The listing is hand-edited, so a handful of lines carry typo'd addresses or
// sit unaddressed; FIXES below corrects them, each one justified by the
// surrounding table layout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASM = path.join(ROOT, 'reference', 'dkdasm', 'dkong.asm');
const OUT = path.join(ROOT, 'reference', 'program.bin');

// MAME src/mame/nintendo/dkong.cpp, ROM_START( dkong )
const CHIPS = [
  ['c_5et_g.bin', 0x0000, 'd76ebecfea1af098d843ee7e578e480cd658ac1a'],
  ['c_5ct_g.bin', 0x1000, 'acb11a8fbdbb3ab46068385fe465f681e3c824bd'],
  ['c_5bt_g.bin', 0x2000, 'c7966261f3a1d3296927e0b6ee1c58039fc53c1f'],
  ['c_5at_g.bin', 0x3000, '3fe3599f6fa7c496f782053ddf7bacb453d197c4'],
];

// line number (1-based) -> corrected start address, or bytes for unaddressed lines
const FIXES = {
  10426: 0x35ed, // 5th high-score entry: entries are 34 bytes apart ($3565 + 4*$22)
  10516: 0x3844, // 25m layout: "long ladder (right)" follows $383F
  10600: 0x392b, // end code after the 5-byte entry at $3926
  10669: 0x39db, // 4-byte records from $39CF
  10673: 0x39eb,
  10754: 0x3aee, // 75m layout: 5-byte girder records from $3AE4
  10832: 0x3c44, // 50m layout: 5-byte girder records from $3C26
  10833: 0x3c49,
};
// unaddressed instructions: [address, bytes]
const EXTRA = [
  [0x0000, [0x3e, 0x00, 0x32, 0x84, 0x7d, 0xc3, 0x66, 0x02]], // LD A,0 / LD (REG_VBLANK_ENABLE),A / JP Init ($0266)
  [0x00c9, [0xef]], // RST #28
];
// the listing ends with notes about a fan hack; stop before them
const LAST_LINE = 11190;

export function buildRom({ verbose = false } = {}) {
  const lines = fs.readFileSync(ASM, 'latin1').split(/\r?\n/).slice(0, LAST_LINE);
  const rom = new Int16Array(0x4000).fill(-1);
  const src = new Int32Array(0x4000);
  const isData = new Uint8Array(0x4000); // 1 where the listing presents the byte as data, not an instruction
  const problems = [];
  const put = (a, v, ln) => {
    if (a < 0 || a >= 0x4000) { problems.push(`line ${ln}: address ${a.toString(16)} out of range`); return; }
    if (rom[a] >= 0 && rom[a] !== v) problems.push(`line ${ln}: $${a.toString(16)} = ${v.toString(16)} but line ${src[a]} says ${rom[a].toString(16)}`);
    rom[a] = v; src[a] = ln;
  };
  const dataLines = [];
  lines.forEach((line, i) => {
    const ln = i + 1;
    // code: "ADDR  HEX  MNEMONIC", or a word table "ADDR  C3 01   ; comment"; may be indented
    let m = /^\s*([0-9A-Fa-f]{4})  ((?:[0-9A-Fa-f]{2} ?)+?)(?:\s{2,}|\s*;|\s*$)/.exec(line);
    if (m) {
      const a = FIXES[ln] ?? parseInt(m[1], 16);
      const h = m[2].replace(/ /g, '');
      // an instruction is one unbroken hex group followed by a mnemonic; anything else is a table
      const rest = line.slice(m.index + m[0].length).trim();
      const data = m[2].trim().includes(' ') || rest === '' || rest.startsWith(';');
      for (let k = 0; k < h.length; k += 2) { put(a + k / 2, parseInt(h.slice(k, k + 2), 16), ln); if (data) isData[a + k / 2] = 1; }
      return;
    }
    // data: "ADDR:  B B B ...", column-aligned to a 16-byte grid when it starts mid-row
    m = /^([0-9A-Fa-f]{4}):( +)((?:[0-9A-Fa-f]{2}(?: (?=[0-9A-Fa-f]{2}\b))?)+)/.exec(line);
    if (m) {
      const stated = parseInt(m[1], 16);
      const bytes = m[3].split(' ').map((b) => parseInt(b, 16));
      // a row starting mid-way is padded to its column on a 16-byte grid
      const a = FIXES[ln] ?? (m[2].length > 2 ? (stated & ~15) + (m[2].length - 2) / 3 : stated);
      dataLines.push({ ln, a, n: bytes.length, pad: m[2].length });
      bytes.forEach((b, k) => { put(a + k, b, ln); isData[a + k] = 1; });
    }
  });
  for (const [a, bytes] of EXTRA) bytes.forEach((b, k) => put(a + k, b, -1));

  const missing = [];
  for (let a = 0; a < 0x4000; a++) if (rom[a] < 0) missing.push(a);
  const bin = Buffer.from(Array.from(rom, (v) => Math.max(0, v)));
  const chips = CHIPS.map(([name, base, sha]) => {
    const got = crypto.createHash('sha1').update(bin.subarray(base, base + 0x1000)).digest('hex');
    return { name, base, ok: got === sha };
  });
  return { bin, missing, problems, chips, dataLines, isData };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = buildRom();
  for (const p of r.problems) console.log(p);
  const runs = [];
  for (const a of r.missing) { const last = runs.at(-1); if (last && last[1] === a - 1) last[1] = a; else runs.push([a, a]); }
  console.log('missing:', runs.map(([a, b]) => `$${a.toString(16)}-${b.toString(16)}`).join(' ') || 'none');
  if (process.argv.includes('--gaps')) {
    let prev = null;
    for (const d of r.dataLines) {
      if (prev && d.a !== prev.a + prev.n && Math.abs(d.a - (prev.a + prev.n)) < 16) console.log(`data gap/overlap: line ${prev.ln} ends $${(prev.a + prev.n).toString(16)}, line ${d.ln} starts $${d.a.toString(16)} (pad ${d.pad})`);
      prev = d;
    }
  }
  for (const c of r.chips) console.log(`${c.name} $${c.base.toString(16).padStart(4, '0')}: ${c.ok ? 'OK' : 'MISMATCH'}`);
  if (r.chips.every((c) => c.ok)) { fs.writeFileSync(OUT, r.bin); console.log(`wrote ${path.relative(ROOT, OUT)}`); }
  else process.exitCode = 1;
}

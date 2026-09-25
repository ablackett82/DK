// Stages: drawing the girders, ladders and conveyors from the layout tables
// ($0DA7), setting up each stage's objects ($0F56), the ladder table ($2441),
// and the per-frame difficulty and oil-can fire timers run from the main loop.
import { rst10, rst30 } from './core.js';

/** $2FF0: tile map address of the pixel (h = x, l = y). */
export function vramAddr(h, l) {
  return 0x7400 + (((~h) & 0xf8) << 2) + ((l >> 3) & 0x1f);
}

/** $0874: blank the playfield tiles and all sprites. */
export function clearScreen(g) {
  const m = g.m;
  let hl = 0x7404;
  for (let c = 0; c < 0x20; c++) {
    for (let b = 0; b < 0x1c; b++) m[hl++] = 0x10;
    hl += 4;
  }
  for (let c = 0; c < 2; c++) for (let b = 0, hl2 = 0x7522 + c; b < 0x0e; b++, hl2 += 0x20) m[hl2] = 0x10;
  m.fill(0, 0x6900, 0x6a80);
}

/** $0852: blank every tile and the sprite list. */
export function clearAll(g) {
  const m = g.m;
  m.fill(0x10, 0x7400, 0x7800);
  m.fill(0, 0x6900, 0x6a80);
}

/** $0DA7: draw a stage layout table: records of (type, x1, y1, x2, y2), ended by $AA. */
export function drawStage(g, de) {
  const m = g.m;
  const put = (hl, a) => { m[hl] = a & 0xff; };
  const incL = (hl) => (hl & 0xff00) | ((hl + 1) & 0xff);
  const decL = (hl) => (hl & 0xff00) | ((hl - 1) & 0xff);
  for (;;) {
    const type = m[de];
    m[0x63b3] = type;
    if (type === 0xaa) return;
    de++;
    const b = m[de]; de++;
    const c = m[de];
    g.sw(0x63ab, vramAddr(b, c));
    m[0x63b4] = b & 7;
    m[0x63af] = c & 7;
    de++;
    const h = m[de];
    m[0x63b1] = h >= b ? h - b : b - h;
    de++;
    const l = m[de];
    m[0x63b2] = (l - c) & 0xff;
    m[0x63b0] = l & 7;
    g.sw(0x63ad, vramAddr(h, l));

    if (type < 2) {
      // ladder (1 = broken): girder-with-ladder top, ladder, girder-with-ladder bottom
      m[0x63b2] = (m[0x63af] + ((m[0x63b2] - 0x10) & 0xff)) & 0xff;
      let a = (m[0x63af] + 0xf0) & 0xff;
      let hl = g.w(0x63ab);
      put(hl, a);
      hl = incL(hl);
      put(hl, a - 0x30);
      if (type === 1) m[0x63b2] = 0;
      for (;;) {
        const r = m[0x63b2] - 8;
        m[0x63b2] = r & 0xff;
        if (r < 0) break;
        hl = incL(hl);
        put(hl, 0xc0);
      }
      hl = g.w(0x63ad);
      put(hl, m[0x63b0] + 0xd0);
      if (type === 1) { hl = decL(hl); put(hl, 0xc0); hl = incL(hl); }
      if (m[0x63b0] !== 0) { hl = incL(hl); put(hl, m[0x63b0] + 0xe0); }
    } else if (type === 2) {
      drawGirder(g);
    } else if (type === 3) {
      // conveyor
      let hl = g.w(0x63ab);
      put(hl, 0xb3);
      hl += 0x20;
      let r = m[0x63b1] - 0x10;
      while (r >= 0) {
        m[0x63b1] = r;
        put(hl, 0xb1);
        hl += 0x20;
        r = m[0x63b1] - 8;
      }
      put(hl, 0xb2);
    } else if (type < 7) {
      // 4 = girder edge (rivets), 5 = rivet-stage girder, 6 = the X pattern: a straight row
      const tile = type === 4 ? 0xe0 : type === 5 ? 0xb0 : 0xfe;
      m[0x63b5] = tile;
      let hl = g.w(0x63ab);
      for (;;) {
        put(hl, m[0x63b5]);
        hl += 0x20;
        const r = m[0x63b1] - 8;
        m[0x63b1] = r & 0xff;
        if (r < 0) break;
      }
    }
    de++;
  }
}

/** $0E57: a girder, stepping one pixel up or down every other column when sloped. */
function drawGirder(g) {
  const m = g.m;
  m[0x63b5] = (m[0x63af] + 0xf0) & 0xff;
  let hl = g.w(0x63ab);
  const col = () => {
    m[hl] = m[0x63b5];
    hl = (hl + 1) & 0xffff;
    if ((hl & 0x1f) !== 0 && m[0x63b5] !== 0xf0) m[hl] = (m[0x63b5] - 0x10) & 0xff;
    hl = (hl + 0x1f) & 0xffff;
  };
  const step8 = () => {
    const r = m[0x63b1] - 8;
    if (r < 0) return false;
    m[0x63b1] = r;
    return true;
  };
  // $0E62
  for (;;) {
    col();
    if (!step8()) return;
    if (m[0x63b2] === 0) continue;
    // $0E8F: second column of the pair, then the one-pixel step
    m[hl] = m[0x63b5];
    hl = (hl + 1) & 0xffff;
    if ((hl & 0x1f) !== 0) m[hl] = (m[0x63b5] - 0x10) & 0xff;
    hl = (hl + 0x1f) & 0xffff;
    if (!step8()) return;
    if (m[0x63b2] & 0x80) {
      // $0ED3: rising
      m[0x63b5] = (m[0x63b5] - 1) & 0xff;
      if (m[0x63b5] < 0xf0) { hl = (hl - 1) & 0xffff; m[0x63b5] = 0xf7; }
      continue;
    }
    m[0x63b5] = (m[0x63b5] + 1) & 0xff;
    if (m[0x63b5] === 0xf8) { hl = (hl + 1) & 0xffff; m[0x63b5] = 0xf0; }
    if ((hl & 0x1f) === 0) return;
  }
}

// ---------------------------------------------------------------------------
// Stage setup
// ---------------------------------------------------------------------------

/** $122A: copy the 4-byte record at hl to b slots starting at de, each c + 4 apart (within de's page). */
export function copyRecords(g, hl, de, b, c) {
  const m = g.m;
  const page = de & 0xff00;
  let e = de & 0xff;
  for (; b > 0; b--) {
    for (let i = 0; i < 4; i++) { m[page | e] = m[hl + i]; e = (e + 1) & 0xff; }
    e = (e + c) & 0xff;
  }
}

/** $11EC: pairs of bytes from hl into (de, de+2), slots c + 2 apart. */
function copyPairs(g, hl, de, b, c) {
  const m = g.m;
  const page = de & 0xff00;
  let e = de & 0xff;
  for (; b > 0; b--) {
    m[page | e] = m[hl++];
    e = (e + 2) & 0xff;
    m[page | e] = m[hl++];
    e = (e + c) & 0xff;
  }
}

/** $11D3: copy b objects' X, graphic, colour, Y (+3, +7, +8, +5) from ix (stride de) into sprites at hl. */
export function objectsToSprites(g, ix, hl, b, de) {
  const m = g.m;
  const page = hl & 0xff00;
  let l = hl & 0xff;
  for (; b > 0; b--) {
    for (const o of [3, 7, 8, 5]) { m[page | l] = m[ix + o]; l = (l + 1) & 0xff; }
    ix += de;
  }
}

/** $11FA: the oil can fire object ($66A0) and its sprite ($6A28) from a 6-byte record. */
function setOilFire(g, hl) {
  const m = g.m;
  m[0x66a0] = 1;
  m[0x66a3] = m[0x6a28] = m[hl];
  m[0x66a7] = m[0x6a29] = m[hl + 1];
  m[0x66a8] = m[0x6a2a] = m[hl + 2];
  m[0x66a5] = m[0x6a2b] = m[hl + 3];
  m[0x66a9] = m[hl + 4];
  m[0x66aa] = m[hl + 5];
}

/** $11A6: the two hammers, positions from hl. */
function setHammers(g, hl) {
  const m = g.m;
  copyPairs(g, hl, 0x6683, 2, 0x0e);
  copyRecords(g, 0x3e08, 0x6687, 2, 0x0c);
  m[0x6680] = 1;
  m[0x6690] = 1;
  objectsToSprites(g, 0x6680, 0x6a18, 2, 0x10);
}

/** $1186: the ten bouncer/spring slots. */
function setBouncers(g) {
  copyRecords(g, 0x11a2, 0x6507, 0x0a, 0x0c);
  objectsToSprites(g, 0x6500, 0x6980, 0x0a, 0x10);
}

/** $0F56: clear Mario and the object tables, work out the timers, place the stage's objects. */
export function initStage(g) {
  const m = g.m;
  m.fill(0, 0x6200, 0x6227);
  m.fill(0, 0x6280, 0x6b00);
  m.copyWithin(0x6280, 0x3d9c, 0x3d9c + 0x40);
  // bonus: 10 x level + 40 hundred, at most 8000 (8-bit arithmetic, as the original)
  const lv = m[0x6229];
  let a = ((lv * 8) & 0xff) + lv + lv & 0xff;
  a = (a + 0x28) & 0xff;
  if (a >= 0x51) a = 0x50;
  m[0x62b0] = m[0x62b1] = m[0x62b2] = a;
  a = (0xdc - ((a * 2) & 0xff)) & 0xff;
  if (a < 0x28) a = 0x28;
  m[0x62b3] = m[0x62b4] = a;
  m[0x6209] = 4;
  m[0x620a] = 8;
  const s = m[0x6227];
  if (!(s & 4)) {
    // black squares over the top of Kong's ladder
    for (let i = 0; i < 3; i++) m.set([0x4f + i * 0x10, 0x3a, 0x0f, 0x18], 0x6a00 + i * 4);
  }
  switch (s) {
    case 1: {
      m.copyWithin(0x69a8, 0x3ddc, 0x3ddc + 0x10);   // barrel pile
      copyRecords(g, 0x3dec, 0x6407, 5, 0x1c);
      setOilFire(g, 0x3df4);
      m.copyWithin(0x69fc, 0x3e00, 0x3e04);           // oil can
      setHammers(g, 0x3e0c);
      copyRecords(g, 0x101b, 0x6707, 8, 0x1c);
      copyRecords(g, 0x101b, 0x6807, 2, 0x1c);
      return;
    }
    case 2: {
      copyRecords(g, 0x3dec, 0x6407, 5, 0x1c);
      setBouncers(g);
      copyRecords(g, 0x3e18, 0x65a7, 6, 0x0c);
      objectsToSprites(g, 0x65a0, 0x69b8, 6, 0x10);
      setOilFire(g, 0x3dfa);
      m.copyWithin(0x69fc, 0x3e04, 0x3e08);           // oil can
      m.copyWithin(0x6944, 0x3e1c, 0x3e24);           // retractable ladders
      m.copyWithin(0x69e4, 0x3e24, 0x3e3c);           // pulleys
      setHammers(g, 0x3e10);
      m.copyWithin(0x6a0c, 0x3e3c, 0x3e48);           // bonus items
      m[0x62b9] = 1;
      return;
    }
    case 3: {
      copyRecords(g, 0x3dec, 0x6407, 5, 0x1c);
      setBouncers(g);
      for (let i = 0; i < 6; i++) m[0x6600 + i * 0x10] = 1;
      for (let i = 0; i < 3; i++) m[0x660d + i * 0x10] = 8;
      copyPairs(g, 0x3e64, 0x6603, 6, 0x0e);
      copyRecords(g, 0x3e60, 0x6607, 6, 0x0c);
      objectsToSprites(g, 0x6600, 0x6958, 6, 0x10);
      m.copyWithin(0x6a0c, 0x3e48, 0x3e54);           // bonus items
      m[0x6400] = 1;
      m[0x6403] = m[0x640e] = 0x58;
      m[0x6405] = m[0x640f] = 0x80;
      m[0x6420] = 1;
      m[0x6423] = m[0x642e] = 0xeb;
      m[0x6425] = m[0x642f] = 0x60;
      m.copyWithin(0x6970, 0x1121, 0x1131);           // shaft tops and bottoms
      return;
    }
    default: {
      copyRecords(g, 0x3df0, 0x6407, 5, 0x1c);
      setHammers(g, 0x3e14);
      m.copyWithin(0x6a0c, 0x3e54, 0x3e60);           // bonus items
      copyPairs(g, 0x1182, 0x64a3, 2, 0x1e);
      copyRecords(g, 0x117e, 0x64a7, 2, 0x1c);
      m[0x64a0] = 1;
      m[0x64c0] = 1;
      objectsToSprites(g, 0x64a0, 0x6950, 2, 0x20);
    }
  }
}

/** $2441: the ladder table at $6300: X at +0, top Y at +$15, bottom Y at +$2A; broken ladders from $6310. */
export function buildLadderTable(g) {
  const m = g.m;
  let hl = [0, 0x3ae4, 0x3b5d, 0x3be5, 0x3c8b][m[0x6227]] ?? 0x3c8b;
  let ix = 0x6300, iy = 0x6310;
  for (;;) {
    const a = m[hl];
    if (a === 0xaa) return;
    if (a > 1) { hl += 5; continue; }
    const p = a === 0 ? ix : iy;
    m[p] = m[hl + 1];
    m[p + 0x15] = m[hl + 2];
    m[p + 0x2a] = m[hl + 4];
    if (a === 0) ix++; else iy++;
    hl += 5;
  }
}

// ---------------------------------------------------------------------------
// Main-loop timers
// ---------------------------------------------------------------------------

/** $037F: every 2048 frames, difficulty := level + minutes-ish elapsed, at most 5. */
export function difficultyTick(g) {
  const m = g.m;
  const t = m[0x6384];
  m[0x6384] = (t + 1) & 0xff;
  if (t !== 0) return;
  const b = m[0x6381];
  m[0x6381] = (b + 1) & 0xff;
  if (b & 7) return;
  let a = (((b >> 3) | (b << 5)) & 0xff) + m[0x6229] & 0xff;
  if (a >= 5) a = 5;
  m[0x6380] = a;
}

/** $03A2: every 4 frames, flicker the oil can fire and count down to releasing a fireball. */
export function oilFireTick(g) {
  const m = g.m;
  if (!rst30(g, 3)) return;
  if (!rst10(g)) return;
  if (m[0x6350] & 1) return;
  m[0x62b8] = (m[0x62b8] - 1) & 0xff;
  if (m[0x62b8] !== 0) return;
  m[0x62b8] = 4;
  const a = m[0x62b9];
  if (!(a & 1)) return;
  let b = 0x40;
  if (a & 2) {
    // a fire is due: bigger flames, then release after 16 ticks
    m[0x66a9] = 2; m[0x66aa] = 2;
    b += 2;
    flicker(g, b);
    m[0x62ba] = (m[0x62ba] - 1) & 0xff;
    if (m[0x62ba] !== 0) return;
    m[0x62b9] = 1;
    m[0x63a0] = 1;
  } else {
    m[0x66a9] = 2; m[0x66aa] = 0;
    flicker(g, b);
  }
  m[0x62ba] = 0x10;
}

/** $03F2: oil can fire graphic b or b + 1 at random. */
function flicker(g, b) {
  const m = g.m;
  m[0x6a29] = b;
  if (m[0x6019] & 1) return;
  m[0x6a29] = b + 1;
}

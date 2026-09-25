// The main routine run every frame of play ($197A), and the smaller checks
// it calls: bonus scores and items, hammer smashes, the rivets, the end of
// the stage, collisions, the timer running out, and Kong's idle animation.
import { rst30, addEvery, setKong, addTask, clearSounds } from './core.js';
import { moveMario, checkFooting, startFall, hostileHit, bonusSound } from './mario.js';
import { rollBarrels, chooseBarrel, deployBarrel } from './barrels.js';
import { fires, releaseFires, pies, conveyors, retractLadders, elevators, springs, hammer } from './hazards.js';
import { writeDown3 } from './flow.js';

/** $197A */
export function mainRoutine(g) {
  const m = g.m;
  bonusCheck(g);
  if (m[0x6350]) { smashing(g); return; }
  moveMario(g);
  rollBarrels(g);
  deployBarrel(g);
  chooseBarrel(g);
  fires(g);
  springs(g);
  pies(g);
  releaseFires(g);
  hammer(g);
  retractLadders(g);
  rivets(g);
  checkFooting(g);
  startFall(g);
  elevators(g);
  conveyors(g);
  bonusItems(g);
  kongIdle(g);
  collisions(g);
  hammerHits(g);
  if (stageDone(g)) return;
  if (timeUp(g)) return marioDied(g);
  bonusTimer(g);
  if (m[0x6200]) return;
  clearSounds(g);
  m[0x6082] = 3;
  marioDied(g);
}

/** $19D2 */
function marioDied(g) {
  const m = g.m;
  m[0x600a]++;
  m[0x6009] = 0x40;
}

// ---------------------------------------------------------------------------
// Bonus scores ($1DBD)
// ---------------------------------------------------------------------------

export function bonusCheck(g) {
  const m = g.m;
  switch (m[0x6340]) {
    case 1: return awardBonus(g);
    case 2: {
      m[0x6341] = (m[0x6341] - 1) & 0xff;
      if (m[0x6341] !== 0) return;
      m[0x6a30] = 0;
      m[0x6340] = 0;
    }
  }
}

/** $1DC9: score the thing just jumped, smashed or picked up, and show the points. */
function awardBonus(g) {
  const m = g.m;
  m[0x6341] = 0x40;
  m[0x6340] = 2;
  const kind = m[0x6342];
  let e, b, x, c;
  if (kind & 1) {
    // jumped: 1 -> 100, 3 -> 300, 7 -> 500 (shown as 800)
    [e, b] = !(kind & 2) ? [1, 0x7b] : !(kind & 4) ? [3, 0x7d] : [5, 0x7f];
    addTask(g, 0, e);
    c = (m[0x6205] + 0x14) & 0xff;
    x = m[0x6203];
  } else {
    if (kind & 2) [e, b] = [3, 0x7d];
    else if (kind & 4) {
      const r = m[0x6018];
      [e, b] = r & 1 ? [5, 0x7e] : r & 2 ? [8, 0x7f] : [3, 0x7d];
    } else {
      m[0x6085] = 3;
      const lv = m[0x6229];
      [e, b] = lv === 1 ? [3, 0x7d] : lv === 2 ? [5, 0x7e] : [8, 0x7f];
    }
    addTask(g, 0, e);
    // $1E18: the points replace the item
    const hl = g.w(0x6343);
    x = m[hl];
    m[hl] = 0;
    c = m[(hl & 0xff00) | ((hl + 3) & 0xff)];
  }
  m[0x6a30] = x;
  m[0x6a31] = b;
  m[0x6a32] = 7;
  m[0x6a33] = c;
  if (rst30(g, 5)) m[0x6085] = 3;
}

// ---------------------------------------------------------------------------
// Hammer smashes ($1E96)
// ---------------------------------------------------------------------------

function smashing(g) {
  const m = g.m;
  switch (m[0x6345]) {
    case 0: {
      const hi = m[0x6352];
      let hl = hi === 0x65 ? 0x69b8 : hi < 0x65 ? 0x69d0 : 0x6980;
      let ix = g.w(0x6351);
      const e = m[0x6353];
      for (let n = m[0x6354]; n > 0; n--) { hl += 4; ix += e; }
      m[ix] = 0;
      m[0x6342] = m[ix + 0x15] === 0 ? 2 : 4;
      const page = hl & 0xff00;
      let l = hl & 0xff;
      m[0x6a2c] = m[page | l]; m[page | l] = 0; l = (l + 1) & 0xff;
      m[0x6a2d] = 0x60; l = (l + 1) & 0xff;
      m[0x6a2e] = 0x0c; l = (l + 1) & 0xff;
      m[0x6a2f] = m[page | l];
      m[0x6345]++;
      m[0x6346] = 6;
      m[0x6347] = 5;
      m[0x608a] = 6; m[0x608b] = 3;
      return;
    }
    case 1: {
      m[0x6346] = (m[0x6346] - 1) & 0xff;
      if (m[0x6346]) return;
      m[0x6346] = 6;
      m[0x6347] = (m[0x6347] - 1) & 0xff;
      if (m[0x6347] === 0) { m[0x6347] = 4; m[0x6345]++; return; }
      m[0x6a2d] ^= 1;
      return;
    }
    case 2: {
      m[0x6346] = (m[0x6346] - 1) & 0xff;
      if (m[0x6346]) return;
      m[0x6346] = 0x0c;
      m[0x6347] = (m[0x6347] - 1) & 0xff;
      if (m[0x6347] === 0) {
        m[0x6345] = 0;
        m[0x6350] = 0;
        m[0x6340] = 1;
        g.sw(0x6343, 0x6a2c);
        return;
      }
      m[0x6a2d]++;
    }
  }
}

/** $281D: has a swinging hammer hit something? */
function hammerHits(g) {
  const m = g.m;
  let iy = 0;
  for (let i = 0; i < 2; i++) if (m[0x6681 + i * 0x10] & 1) { iy = 0x6680 + i * 0x10; break; }
  if (!iy) return;
  const r = hostileHit(g, iy, m[iy + 5], m[iy + 9], m[iy + 0x0a]);
  if (!r.a) return;
  m[0x6350] = 1;
  m[0x6354] = (m[0x63b9] - r.b) & 0xff;
  m[0x6353] = r.de & 0xff;
  g.sw(0x6351, r.ix);
}

/** $2808 */
function collisions(g) {
  const m = g.m;
  if (hostileHit(g, 0x6200, m[0x6205], 4, 7).a) m[0x6200] = 0;
}

// ---------------------------------------------------------------------------
// Items, rivets, end of stage, timer
// ---------------------------------------------------------------------------

/** $19DA: walking onto the hat, bag or umbrella. */
function bonusItems(g) {
  const m = g.m;
  const x = m[0x6203];
  for (let i = 0; i < 3; i++) {
    const hl = 0x6a0c + i * 4;
    if (m[hl] !== x) continue;
    if (m[0x6205] !== m[hl + 3]) return;
    if (m[hl + 1] & 8) return;
    g.sw(0x6343, hl);
    m[0x6342] = 0;
    m[0x6340] = 1;
    return;
  }
}

/** $1A33: pulling out rivets by walking over them. */
function rivets(g) {
  const m = g.m;
  if (!rst30(g, 8)) return;
  const x = m[0x6203];
  if (x === 0x4b || x === 0xb3) { m[0x6291] = 1; return; }
  if (m[0x6291] !== 1) return;
  m[0x6291] = 0;
  const y = (m[0x6205] - 1) & 0xff;
  if (y >= 0xd0) return;
  let b = 0;
  if (y & 0x80) b |= 4;
  if (y & 0x20) b |= 2;
  if ((y >> 5) === 6) b |= 2;
  if (x & 0x80) b |= 1;
  const p = 0x6292 + b;
  if (m[p] === 0) return;
  m[p] = 0;
  m[0x6290]--;
  let hl = (b & 1 ? 0x012b : 0x02cb) + 5 * (b >> 1) + 0x7400;
  m[hl] = 0x10;
  hl = (hl & 0xff00) | ((hl - 1) & 0xff); m[hl] = 0x10;
  hl = (hl & 0xff00) | ((hl + 2) & 0xff); m[hl] = 0x10;
  m[0x6340] = 1;
  m[0x6342] = 1;
  m[0x6225] = 1;
  if (m[0x6216] === 0) bonusSound(g, 0);
}

/** $1E57: reached the girl (or pulled the last rivet)? */
function stageDone(g) {
  const m = g.m;
  const s = m[0x6227];
  if (s & 4) {
    if (m[0x6290] !== 0) return false;
  } else {
    const y = m[0x6205];
    // (the girder/elevator test leaves carry set, so Mario always ends up facing left there)
    if (s & 1) { if (y >= 0x31) return false; m[0x694d] = 0; }
    else { if (y >= 0x51) return false; m[0x694d] = m[0x6203] & 0x80 ? 0x00 : 0x80; }
  }
  m[0x600a] = 0x16;
  return true;
}

/** $1A07: after the bonus runs out there's a short grace, then Mario dies (never mid-jump). */
function timeUp(g) {
  const m = g.m;
  switch (m[0x6386]) {
    case 1: m[0x6387] = 0; m[0x6386] = 2; return false;
    case 2:
      m[0x6387] = (m[0x6387] - 1) & 0xff;
      if (m[0x6387] === 0) m[0x6386] = 3;
      return false;
    case 3: return m[0x6216] === 0;
  }
  return false;
}

/** $2FCB: on every stage but the girders the bonus counts down on its own clock. */
function bonusTimer(g) {
  const m = g.m;
  if (!rst30(g, 0x0e)) return;
  m[0x62b4] = (m[0x62b4] - 1) & 0xff;
  if (m[0x62b4] !== 0) return;
  m[0x62b9] = 3;
  m[0x6396] = 3;
  addTask(g, 5, 1);
  m[0x62b4] = m[0x62b3];
  m[0x62b1] = (m[0x62b1] - 1) & 0xff;
  if (m[0x62b1] === 0) m[0x6386] = 1;
}

// ---------------------------------------------------------------------------
// Kong and the girl ($03FB)
// ---------------------------------------------------------------------------

function kongIdle(g) {
  const m = g.m;
  const s = m[0x6227];
  if (s === 2) {
    addEvery(g, 0x6908, m[0x63a3]);
    m[0x63b7] = (m[0x6910] - 0x3b) & 0xff;
  }
  let chest = false;
  if (m[0x6391] !== 0 || m[0x601a] === 0) {
    m[0x6391] = 1;
    m[0x6390]++;
    if (m[0x6390] === 0x80) {
      m[0x6390] = 0;
      m[0x6391] = 0;
      if (!m[0x6393]) { setKong(g, 0x385c); chest = true; }
    } else if (!m[0x6393] && (m[0x6390] & 0x1f) === 0) {
      setKong(g, m[0x6390] & 0x20 ? 0x39cf : 0x39f7);
      m[0x6082] = 3;
      chest = true;
    }
  }
  if (chest) {
    // $0450: put Kong back where this stage keeps him
    if (s & 1) { if (!(s & 2)) addEvery(g, 0x690b, 0xfc); }
    else addEvery(g, 0x6908, s & 4 ? 0x44 : m[0x63b7]);
  }
  // $0486: the girl calls for help
  const c = m[0x6390];
  if (s === 4) {
    const a = writeDown3(g, 0x7623, 0x10);
    writeDown3(g, 0x7583, a);
    const left = m[0x6203] < 0x80;
    if (c & 0x40) {
      if (left) writeDown3(g, 0x7623, 0xdf);
      else writeDown3(g, 0x7583, 0xef);
    }
    let a2;
    if (left) { m[0x6901] |= 0x80; a2 = m[0x6905] | 0x80; }
    else { m[0x6901] &= 0x7f; a2 = m[0x6905] & 0x7f; }
    return girlPose(g, a2, c);
  }
  writeDown3(g, 0x75c4, c !== 0 && (c & 0x40) ? 0xef : 0x10);
  girlPose(g, m[0x6905], c);
}

/** $04AC */
function girlPose(g, a, c) {
  const m = g.m;
  m[0x6905] = a;
  if (!(c & 0x40)) return;
  if (c & 7) return;
  m[0x6905] = a ^ 3;
}

// ---------------------------------------------------------------------------
// Sprite clearing
// ---------------------------------------------------------------------------

/** $30BD: hide the hammers, barrels, fires and pies, and the bonus items. */
export function clearSprites(g) {
  hide(g, 0x6950, 2);
  hide(g, 0x6980, 10);
  hide(g, 0x69b8, 11);
  hide(g, 0x6a0c, 5);
}

/** $30DB: hide Mario and the elevator platforms. */
export function clearMario(g) {
  g.m[0x694c] = 0;
  hide(g, 0x6958, 6);
}

function hide(g, hl, b) {
  const page = hl & 0xff00;
  let l = hl & 0xff;
  for (; b > 0; b--) { g.m[page | l] = 0; l = (l + 4) & 0xff; }
}



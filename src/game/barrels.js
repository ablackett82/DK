// Barrels on the girder stage: rolling, going down ladders, dropping off
// girder ends, the "crazy" barrels that fall straight down, the oil can, and
// Kong picking up and throwing each one ($1F72, $2C03, $2C8F).
import { rst10, rst30, random, addTask, addEvery, setKong, stepper } from './core.js';
import { vramAddr } from './stage.js';
import { ladderAt, slope, arc, speed } from './mario.js';

/** $1F72: move every rolling barrel and copy it to its sprite. */
export function rollBarrels(g) {
  const m = g.m;
  if (m[0x6227] !== 1) return;
  for (let i = 0; i < 10; i++) {
    const ix = 0x6700 + i * 0x20;
    if (m[ix] !== 1) continue;
    moveBarrel(g, ix);
    // $21BA
    const sp = 0x6980 + i * 4;
    m[sp] = m[ix + 3];
    m[sp + 1] = m[ix + 7];
    m[sp + 2] = m[ix + 8];
    m[sp + 3] = m[ix + 5];
  }
}

function moveBarrel(g, ix) {
  const m = g.m;
  if (m[ix + 1] === 1) return crazy(g, ix);
  const dir = m[ix + 2];
  if (dir & 1) return downLadder(g, ix);
  if (dir & 2) { m[ix + 3] = (m[ix + 3] + 1) & 0xff; return along(g, ix, 1, 0); }
  if (dir & 4) { m[ix + 3] = (m[ix + 3] - 1) & 0xff; return along(g, ix, 0xff, 4); }
  return overEdge(g, ix);
}

/** $1FAC */
function downLadder(g, ix) {
  const m = g.m;
  m[ix + 5] = (m[ix + 5] + 1) & 0xff;
  if (m[ix + 0x17] === m[ix + 5]) {
    m[ix + 7] = (m[ix + 0x15] * 4 + 0x15) & 0xff;
    m[ix + 2] ^= 7;
    return;
  }
  ladderSpin(g, ix);
}

/** $1FCE: flip the end-on barrel graphic every 4 frames. */
function ladderSpin(g, ix) {
  const m = g.m;
  let a = (m[ix + 0x0f] - 1) & 0xff;
  if (a === 0) { m[ix + 7] ^= 1; a = 4; }
  m[ix + 0x0f] = a;
}

/** $1FF6: rolling along a girder (b = direction, c = animation sequence select). */
function along(g, ix, b, c) {
  const m = g.m;
  const h = m[ix + 3];
  let l = m[ix + 5];
  if ((h & 7) === 3) {
    // $215F: over a column where a ladder might start
    maybeTakeLadder(g, ix, h, (l + 5) & 0xff);
    return;
  }
  l = (slope(h, (l - 3) & 0xff, b) + 3) & 0xff;
  m[ix + 5] = l;
  roll(g, ix, c);
  if (intoOilCan(g, ix)) return;
  const x = m[ix + 3];
  if (x < 0x1c) {
    m[ix + 0x10] = 0xff;
    m[ix + 0x11] = 0xa0;
  } else if (x >= 0xe4) {
    m[ix + 0x10] = 0;
    m[ix + 0x11] = 0x60;
  } else return;
  // $2038: roll off the end of the girder
  m[ix + 0x12] = 0xff;
  m[ix + 0x13] = 0xf0;
  m[ix + 0x14] = 0;
  m[ix + 0x0e] = 0;
  m[ix + 4] = 0;
  m[ix + 6] = 0;
  m[ix + 2] = 8;
}

/** $216D: at the top of a ladder, decide whether to go down it. */
function maybeTakeLadder(g, ix, x, d) {
  const m = g.m;
  const lad = ladderAt(g, x, d);
  if (!lad || lad.a !== 1) return;
  m[ix + 0x17] = (lad.b - 5) & 0xff;
  if (m[0x6348] !== 0) {
    // once the oil can is lit, only below Mario and on a difficulty-weighted chance, steered by the joystick
    if (((m[0x6205] - 4) & 0xff) < d) return;
    const b = (m[0x6380] >> 1) + 1;
    const c = m[0x6018];
    if ((c & 3) >= b) return;
    const mx = m[0x6203];
    let take;
    if (mx === x) take = true;
    else if (mx > x) take = (m[0x6010] & 2) !== 0;
    else take = (m[0x6010] & 1) !== 0;
    if (!take && (c & 0x18)) return;
  }
  m[ix + 7] = (m[ix + 7] + 1) & 0xff;
  m[ix + 2] |= 1;
}

/** $2053: in the air after rolling off an end. */
function overEdge(g, ix) {
  const m = g.m;
  arc(g, ix);
  if (!landBarrel(g, ix)) {
    if (((m[ix + 3] + 8) & 0xff) < 0x10) { m[ix] = 0; m[ix + 3] = 0; return; }
    if (intoOilCan(g, ix)) return;
    roll(g, ix, (m[ix + 0x10] & 1) << 2);
    return;
  }
  m[ix + 0x0e] = (m[ix + 0x0e] + 1) & 0xff;
  const bounce = m[ix + 0x0e];
  if (bounce === 1) {
    // first landing: normal barrels above Mario reverse; blue ones always do
    if (m[ix + 0x15] === 0 && ((m[ix + 5] - 0x16) & 0xff) >= m[0x6205]) return bounceUp(g, ix);
    if (m[ix + 0x10] !== 0) { m[ix + 0x10] = 1; m[ix + 0x11] = 0; }
    else { m[ix + 0x11] = 0; m[ix + 0x10] = 0xff; }
    return bounceUp(g, ix);
  }
  if (bounce === 2) return bounceUp(g, ix);
  m[ix + 2] = m[ix + 0x10] === 1 ? 2 : 4;
}

/** $20C3: a small bounce: a quarter of the landing speed, upwards. */
function bounceUp(g, ix) {
  const m = g.m;
  const hl = speed(g, ix) >> 2;
  m[ix + 0x12] = hl >> 8;
  m[ix + 0x13] = hl & 0xff;
  m[ix + 0x14] = 0;
  m[ix + 4] = 0;
  m[ix + 6] = 0;
}

/** $20EC: a crazy barrel dropping through the girders. */
function crazy(g, ix) {
  const m = g.m;
  arc(g, ix);
  const below = ((m[ix + 5] - 0x1a) & 0xff) < m[ix + 0x19];
  if (!below) {
    if (landBarrel(g, ix)) return crazyLanded(g, ix);
    if (intoOilCan(g, ix)) return;
  }
  // $2104
  if (((m[ix + 3] + 8) & 0xff) >= 0x10) return ladderSpin(g, ix);
  m[ix] = 0;
  m[ix + 3] = 0;
}

/** $2118 */
function crazyLanded(g, ix) {
  const m = g.m;
  if (m[ix + 5] >= 0xe0) {
    // reached the bottom: an ordinary barrel from now on, rolling left
    m[ix + 7] = (m[ix + 7] & 0xfc) | 1;
    m[ix + 1] = 0;
    m[ix + 2] = 0;
    m[ix + 0x10] = 0xff;
    m[ix + 0x11] = 0;
    m[ix + 0x12] = 0;
    m[ix + 0x13] = 0xb0;
    m[ix + 0x0e] = 1;
  } else {
    crazyAim(g, ix);
    m[ix + 0x19] = m[ix + 5];
  }
  m[ix + 0x14] = 0;
  m[ix + 4] = 0;
  m[ix + 6] = 0;
}

/** $22CB: pick a crazy barrel's sideways drift, aiming at Mario at higher difficulty. */
function crazyAim(g, ix) {
  const m = g.m;
  let a;
  if (m[0x6348] === 0) {
    const lv = m[0x6229];
    a = lv === 1 ? 0x01 : lv === 2 ? 0xb1 : 0xe9;
  } else {
    const d = (m[0x6380] - 1) & 0xff;
    if (d <= 1) a = m[0x6018];
    else if (d <= 3) {
      m[ix + 0x11] = m[0x6018];
      m[ix + 0x10] = m[0x6203] >= m[ix + 3] ? 1 : 0xff;
      return;
    } else if (d === 4) {
      const diff = m[0x6203] - m[ix + 3];
      let c = diff < 0 ? 0xff : 0;
      let v = diff & 0xff;
      for (let i = 0; i < 2; i++) {
        const top = v >> 7;
        v = ((v << 1) | top) & 0xff;
        c = ((c << 1) | top) & 0xff;
      }
      m[ix + 0x10] = c;
      m[ix + 0x11] = v;
      return;
    } else return; // difficulty 0 or above 5 never happens
  }
  m[ix + 0x11] = a;
  m[ix + 0x10] = ((a & 1) - 1) & 0xff;
}

/** $2A2F: has the barrel reached the top of a girder? If so set its Y on it and return true. */
function landBarrel(g, ix) {
  const m = g.m;
  const h = m[ix + 3];
  const e = (m[ix + 5] + 4) & 0xff;
  const t = m[vramAddr(h, e)];
  if (t < 0xb0 || (t & 0x0f) >= 8 || t === 0xc0) return false;
  let c;
  if (t < 0xc0) c = 0xff;
  else if (t < 0xd0 || (t >= 0xe0 && t < 0xf0)) c = ((t & 0x0f) - 9) & 0xff;
  else c = ((t & 0x0f) - 1) & 0xff;
  const a = ((e & 0xf8) + c) & 0xff;
  if (a >= e) return false;
  m[ix + 5] = (a - 4) & 0xff;
  return true;
}

/** $24B4: a barrel rolling into the oil can: gone, boom, and the can lights (blue ones release a fire). */
function intoOilCan(g, ix) {
  const m = g.m;
  if (m[ix + 5] < 0xe8) return false;
  const x = m[ix + 3];
  if (x >= 0x2a || x < 0x20) return false;
  if (m[ix + 0x15] !== 0) m[0x62b9] = 3;
  m[ix] = 0;
  m[ix + 3] = 0;
  m[0x6082] = 3;
  if (m[0x6348] === 0) m[0x6348] = 1;
  return true;
}

/** $23DE: every 4 frames step the barrel's rolling animation (bit 7 of graphic and colour). */
function roll(g, ix, c) {
  const m = g.m;
  let a = (m[ix + 0x0f] - 1) & 0xff;
  if (a === 0) {
    const state = ((m[ix + 7] >> 7) << 1) | (m[ix + 8] >> 7);
    const r = stepper(3 | c, state);
    m[ix + 8] = (m[ix + 8] & 0x7f) | ((r & 1) << 7);
    m[ix + 7] = (m[ix + 7] & 0x7f) | (((r >> 1) & 1) << 7);
    a = 4;
  }
  m[ix + 0x0f] = a;
}

// ---------------------------------------------------------------------------
// Deploying barrels
// ---------------------------------------------------------------------------

/** $2C03: decide the next barrel: crazy (first one, then at random), normal, or blue. */
export function chooseBarrel(g) {
  const m = g.m;
  if (!rst30(g, 1) || !rst10(g)) return;
  if (m[0x6393] & 1) return;
  const c = m[0x62b1];
  if (c === 0) return;
  let kind;
  if (((m[0x62b0] - 2) & 0xff) < c) {
    // the first two barrels of the stage: crazy, then normal
    kind = m[0x62b0] === c ? 1 : 2;
  } else if (m[0x6382] & 2) {
    kind = 0;
  } else {
    const t = m[0x601a] & 0x1f;
    let chance = false;
    for (let b = m[0x6380]; b > 0; b--) if (t === b) { chance = true; break; }
    if (!chance) return;
    if (!((m[0x62b0] >> 1) < c) && !(m[0x6019] & 1)) return;
    kind = (random(g) & 0x0f) === 0 ? 1 : 0;
  }
  m[0x6382] = kind;
  m[0x638f] = kind === 0 ? 3 : kind + 1;
  m[0x6392] = 1;
  if (m[0x62b2] !== c) return;
  m[0x62b2] = (m[0x62b2] - 8) & 0xff;
  for (let i = 0; i < 5; i++) {
    if (m[0x6400 + i * 0x20] === 0) { m[0x6382] |= 0x80; return; }
  }
}

/** $2C8F: Kong grabs the chosen barrel, holds it, and lets it go. */
export function deployBarrel(g) {
  const m = g.m;
  if (!rst30(g, 1) || !rst10(g)) return;
  if (!(m[0x6393] & 1)) {
    if (!(m[0x6392] & 1)) return;
    let ix = 0, b;
    for (b = 10; b > 0; b--) {
      const p = 0x6700 + (10 - b) * 0x20;
      if (!(m[p] & 3)) { ix = p; break; }
    }
    if (!ix) return;
    g.sw(0x62aa, ix);
    m[ix] = 2;
    g.sw(0x62ac, 0x6980 + (10 - b) * 4);
    m[0x6393] = 1;
    addTask(g, 5, 1);
    m[0x62b1] = (m[0x62b1] - 1) & 0xff;
    if (m[0x62b1] === 0) m[0x6386] = 1;
    const left = m[0x62b1];
    if (left < 4) m[0x69a8 + left * 4] = 0;   // one fewer barrel in the pile
    m[ix + 7] = 0x15;
    m[ix + 8] = 0x0b;
    m[ix + 0x15] = 0;
    if (m[0x6382] & 0x80) { m[ix + 7] = 0x19; m[ix + 8] = 0x0c; m[ix + 0x15] = 1; }
  }
  // $2D15: Kong's grab-and-hold animation, a step every $18 frames
  m[0x62af] = (m[0x62af] - 1) & 0xff;
  if (m[0x62af] !== 0) return;
  m[0x62af] = 0x18;
  let hl;
  const step = m[0x638f];
  if (step !== 0) {
    let c = step;
    if (!(m[0x6382] & 1)) c--;
    setKong(g, 0x3932 + ((c * 0x28) & 0xff));
    m[0x638f]--;
    if (m[0x638f] === 0) {
      m[0x62af] = 1;
      if (m[0x6382] & 1) { hl = 0x39cc; g.sw(0x62a8, hl); }
    }
  }
  if (hl === undefined) hl = g.w(0x62a8);
  // $2D54: the barrel follows a path in Kong's hands; $7F lets go
  const a = m[hl];
  const ix = g.w(0x62aa);
  let de = g.w(0x62ac);
  if (a === 0x7f) return release(g, ix, de);
  m[de] = a & 0x7f;
  let s = m[ix + 7];
  if (a & 0x80) s ^= 3;
  m[++de] = s;
  m[ix + 7] = s;
  m[++de] = m[ix + 8];
  m[++de] = m[hl + 1];
  g.sw(0x62a8, hl + 2);
}

/** $2D8C */
function release(g, ix, de) {
  const m = g.m;
  g.sw(0x62a8, 0x39c3);
  m[ix + 1] = 1;
  if (!(m[0x6382] & 1)) { m[ix + 1] = 0; m[ix + 2] = 2; }
  m[ix] = 1;
  m[ix + 0x0f] = 1;
  m.fill(0, ix + 0x10, ix + 0x15);
  m[0x6393] = 0;
  m[0x6392] = 0;
  m[ix + 3] = m[de];
  m[ix + 5] = m[de + 3];
  setKong(g, 0x385c);
  addEvery(g, 0x690b, 0xfc);
}

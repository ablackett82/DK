// Everything else that moves: fireballs and firefoxes ($30ED, $2DDB), pies
// ($24EA), conveyor belts ($25F2), the retractable ladders ($2207), elevators
// ($26FA), springs ($2E04), and Mario's hammer ($2ED4).
import { rst10, rst30, random } from './core.js';
import { vramAddr } from './stage.js';
import { ladderAt, slope, walls } from './mario.js';

// ---------------------------------------------------------------------------
// Fireballs ($6400, five 32-byte slots)
// ---------------------------------------------------------------------------

/** $30ED */
export function fires(g) {
  if (!fireSpeedGate(g)) return;
  if (!countAndDeploy(g)) return;
  moveAllFires(g);
  firesToSprites(g);
}

/** $30FA: skip fire movement on some frames; fewer skips at higher difficulty. */
function fireSpeedGate(g) {
  const m = g.m;
  let d = m[0x6380];
  if (d >= 6) d = 5;
  const t = m[0x601a];
  switch (d) {
    case 0: case 1: return (t & 1) === 1;
    case 2: return (t & 7) < 5;
    case 3: case 4: return (t & 3) < 3;
    default: return (t & 7) < 7;
  }
}

/** $313C: count the fires, colour them for the hammer, release a new one if flagged. False when there are none. */
function countAndDeploy(g) {
  const m = g.m;
  m[0x63a1] = 0;
  for (let i = 0; i < 5; i++) {
    const ix = 0x6400 + i * 0x20;
    if (m[ix] === 0) {
      if (m[0x63a1] === 5) continue;
      if (m[0x6227] === 2 && m[0x63a1] === m[0x6380]) return true;
      if (m[0x63a0] !== 1) continue;
      m[ix] = 1;
      m[ix + 0x18] = 1;
      m[0x63a0] = 0;
      m[0x63a1]++;
      continue;
    }
    m[0x63a1]++;
    m[ix + 8] = m[0x6217] === 1 ? 0 : 1;
  }
  m[0x63a0] = 0;
  return m[0x63a1] !== 0;
}

/** $31B1 */
function moveAllFires(g) {
  const m = g.m;
  // $31DD: from difficulty 3, fires 2 and 4 sometimes become freezers
  if (m[0x6380] >= 3 && (m[0x6018] & 3) === 1 && m[0x601a] === 1) {
    m[0x6439] = 2;
    m[0x6479] = 2;
  }
  m[0x63a2] = 0;
  g.sw(0x63c8, 0x63e0);
  for (let i = 0; i < 5; i++) {
    const ix = (g.w(0x63c8) + 0x20) & 0xffff;
    g.sw(0x63c8, ix);
    if (m[ix]) moveFire(g, ix);
    m[0x63a2]++;
  }
}

/** $3202 */
function moveFire(g, ix) {
  const m = g.m;
  if (m[ix + 0x18] === 1) return spawning(g, ix);
  let mount = true;
  if (m[ix + 0x0d] < 4) {
    let check = true;
    if (m[ix + 0x19] === 2) freezer(g, ix);
    else {
      reverseMaybe(g, ix);
      // only one move in four even looks for a ladder
      if (m[0x6018] & 3) { check = false; mount = false; }
    }
    // $3229: a fire heading left (or frozen) doesn't take ladders
    if (check && m[ix + 0x0d] === 0) return bob(g, ix);
  }
  if (mount) ladders(g, ix);
  // $3233
  if (m[ix + 0x0d] >= 4) {
    ladderMove(g, ix);
    return bob(g, ix);
  }
  lateral(g, ix);
  if (atGirderEnd(g)) {
    // $3297: step back from the edge and head the other way
    if (m[ix + 0x0d] === 1) { m[ix + 0x0e] = (m[ix + 0x0e] - 1) & 0xff; m[ix + 0x0d] = 2; }
    else { m[ix + 0x0e] = (m[ix + 0x0e] + 1) & 0xff; m[ix + 0x0d] = 1; }
    slopeFire(g, ix);
    return bob(g, ix);
  }
  const x = m[ix + 0x0e];
  if (x < 0x10) m[ix + 0x0d] = 1;
  else if (x >= 0xf0) m[ix + 0x0d] = 2;
  bob(g, ix);
}

/** $3257: bob up and down: actual position = effective position + table[$3A7A + counter]. */
function bob(g, ix) {
  const m = g.m;
  let a = m[ix + 0x13];
  a = a !== 0 ? a - 1 : 0x11;
  m[ix + 0x13] = a;
  m[ix + 3] = m[ix + 0x0e];
  m[ix + 5] = (m[0x3a7a + a] + m[ix + 0x0f]) & 0xff;
}

/** $32D6 */
function freezer(g, ix) {
  const m = g.m;
  if (m[ix + 0x1c] !== 0) {
    m[ix + 0x1c]--;
    if (m[ix + 0x1c] !== 0) { m[ix + 0x0d] = 0; return; }
    return unfreeze(g, ix);
  }
  if (m[ix + 0x1d] !== 1) return reverseMaybe(g, ix);
  m[ix + 0x1d] = 0;
  if (m[0x6205] < m[ix + 0x0f]) return unfreeze(g, ix);
  m[ix + 0x1c] = 0xff;
  m[ix + 0x0d] = 0;
}

function unfreeze(g, ix) {
  const m = g.m;
  m[ix + 0x19] = 0;
  m[ix + 0x1c] = 0;
  reverseMaybe(g, ix);
}

/** $330F: every $2B moves pick left or right at random. */
function reverseMaybe(g, ix) {
  const m = g.m;
  if (m[ix + 0x16] === 0) {
    m[ix + 0x16] = 0x2b;
    m[ix + 0x0d] = 0;
    if (m[0x6018] & 1) m[ix + 0x0d] = 1;
  }
  m[ix + 0x16] = (m[ix + 0x16] - 1) & 0xff;
}

/** $333D: get off a ladder at its end, or get on one here. */
function ladders(g, ix) {
  const m = g.m;
  const y8 = (m[ix + 0x0f] + 8) & 0xff;
  const d = m[ix + 0x0d];
  if (d === 8) {
    if (y8 !== m[ix + 0x1f]) return;
    m[ix + 0x0d] = 0;
    if (m[ix + 0x19] === 2) m[ix + 0x1d] = 1;
    return;
  }
  if (d === 4) {
    if (y8 !== m[ix + 0x1f]) return;
    m[ix + 0x0d] = 0;
    return;
  }
  // $33A1: fires that reach the top girder stay there (except on the rivets)
  if (rst30(g, 7) && m[ix + 0x0f] < 0x59) return;
  const lad = ladderAt(g, m[ix + 0x0e], y8);
  if (!lad) return;
  m[ix + 0x1f] = lad.b;
  if (lad.a === 0) { m[ix + 0x0d] = 8; return; }
  if (m[ix + 0x0f] >= m[0x6205]) return; // only go down towards Mario
  m[ix + 0x0d] = 4;
}

/** $33AD */
function lateral(g, ix) {
  const m = g.m;
  if (m[ix + 0x0d] === 1) {
    m[ix + 7] |= 0x80;
    m[ix + 0x0e] = (m[ix + 0x0e] + 1) & 0xff;
  } else {
    m[ix + 7] &= 0x7f;
    m[ix + 0x0e] = (m[ix + 0x0e] - 1) & 0xff;
  }
  animateFire(g, ix);
  slopeFire(g, ix);
}

/** $33C3 */
function slopeFire(g, ix) {
  const m = g.m;
  if (m[0x6227] !== 1) return;
  m[ix + 0x0f] = slope(m[ix + 0x0e], m[ix + 0x0f], m[ix + 0x0d]);
}

/** $33E7: up at a third of the speed of down. */
function ladderMove(g, ix) {
  const m = g.m;
  animateFire(g, ix);
  if (m[ix + 0x0d] !== 8) { m[ix + 0x0f] = (m[ix + 0x0f] + 1) & 0xff; return; }
  if (m[ix + 0x14] !== 0) { m[ix + 0x14]--; return; }
  m[ix + 0x14] = 2;
  m[ix + 0x0f] = (m[ix + 0x0f] - 1) & 0xff;
}

/** $3409 */
function animateFire(g, ix) {
  const m = g.m;
  if (m[ix + 0x15] !== 0) { m[ix + 0x15]--; return; }
  m[ix + 0x15] = 2;
  m[ix + 7] = (m[ix + 7] + 1) & 0xff;
  if ((m[ix + 7] & 0x0f) === 0x0f) m[ix + 7] ^= 2;
}

/** $298C: is the fire (at $63C8) at the end of its girder? */
function atGirderEnd(g) {
  const m = g.m;
  const p = g.w(0x63c8);
  const hl = (p & 0xff00) | ((p + 0x0e) & 0xff);
  const x = m[hl];
  const y = (m[(hl & 0xff00) | ((hl + 1) & 0xff)] + 0x0c) & 0xff;
  const t = m[vramAddr(x, y)];
  return t < 0xb0 || (t & 0x0f) >= 8;
}

/** $32BD: a new fire's entrance. */
function spawning(g, ix) {
  const m = g.m;
  const s = m[0x6227];
  if (s === 1) return oilJump(g, ix, false);
  if (s === 2) return oilJump(g, ix, true);
  // $34B9: rivets: appear on a random platform on the side away from Mario
  if (s === 3) return;
  const hl = (m[0x6203] & 0x80 ? 0x3ad4 : 0x3ac4) + (m[0x6019] & 6);
  m[ix + 3] = m[ix + 0x0e] = m[hl];
  m[ix + 5] = m[ix + 0x0f] = m[hl + 1];
  m[ix + 0x0d] = 0;
  m[ix + 0x18] = 0;
  m[ix + 0x1c] = 0;
}

/** $342C / $3478: hop out of the oil can along the arc at $3A8C (girders) or $3AAC (conveyors). */
function oilJump(g, ix, conveyors) {
  const m = g.m;
  let hl = m[ix + 0x1a] | (m[ix + 0x1b] << 8);
  if (!conveyors) {
    if (hl === 0) { hl = 0x3a8c; m[ix + 3] = 0x26; }
    m[ix + 3] = (m[ix + 3] + 1) & 0xff;
  } else {
    if (hl === 0) {
      hl = 0x3aac;
      if (m[0x6203] & 0x80) { m[ix + 0x0d] = 1; m[ix + 3] = 0x7e; }
      else { m[ix + 0x0d] = 2; m[ix + 3] = 0x80; }
    }
    m[ix + 3] = (m[ix + 3] + (m[ix + 0x0d] === 1 ? 1 : 0xff)) & 0xff;
  }
  // $3445
  const a = m[hl];
  if (a !== 0xaa) {
    m[ix + 5] = a;
    hl++;
    m[ix + 0x1a] = hl & 0xff;
    m[ix + 0x1b] = hl >> 8;
    return;
  }
  m[ix + 0x13] = 0;
  m[ix + 0x18] = 0;
  m[ix + 0x0d] = 0;
  m[ix + 0x1c] = 0;
  m[ix + 0x0e] = m[ix + 3];
  m[ix + 0x0f] = m[ix + 5];
  m[ix + 0x1a] = 0;
  m[ix + 0x1b] = 0;
}

/** $34F3: fire slots to their sprites at $69D0. */
function firesToSprites(g) {
  const m = g.m;
  for (let i = 0; i < 5; i++) {
    const ix = 0x6400 + i * 0x20, sp = 0x69d0 + i * 4;
    if (!m[ix]) continue;
    m[sp] = m[ix + 3];
    m[sp + 1] = m[ix + 7];
    m[sp + 2] = m[ix + 8];
    m[sp + 3] = m[ix + 5];
  }
}

/** $2DDB: on conveyors and rivets, flag a new fire every 256/128/64 frames (halved on conveyors). */
export function releaseFires(g) {
  const m = g.m;
  if (!rst30(g, 0x0a) || !rst10(g)) return;
  let b = (m[0x6380] + 1) >> 1;
  if (m[0x6227] === 2) b++;
  const mask = b > 0 ? (0xff >> (b - 1)) : 0xff;
  if (m[0x601a] & mask) return;
  m[0x63a0] = 1;
  m[0x639a] = 1;
}

// ---------------------------------------------------------------------------
// Pies ($65A0, six 16-byte slots)
// ---------------------------------------------------------------------------

/** $24EA */
export function pies(g) {
  const m = g.m;
  if (!rst30(g, 2)) return;
  newPie(g);
  movePies(g);
  for (let i = 0; i < 6; i++) {
    const ix = 0x65a0 + i * 0x10, sp = 0x69b8 + i * 4;
    if (!m[ix]) continue;
    m[sp] = m[ix + 3];
    m[sp + 1] = m[ix + 7];
    m[sp + 2] = m[ix + 8];
    m[sp + 3] = m[ix + 5];
  }
}

/** $2523 */
function newPie(g) {
  const m = g.m;
  if (m[0x639b] !== 0) { m[0x639b]--; return; }
  if (m[0x639a] === 0) return;
  let ix = 0;
  for (let i = 0; i < 6; i++) if (!(m[0x65a0 + i * 0x10] & 1)) { ix = 0x65a0 + i * 0x10; break; }
  if (!ix) return;
  let left;
  m[ix + 5] = 0x7c;
  if (random(g) < 0x60 || m[0x62a3] === 1) {
    // bottom tray, entering from the end it moves away from
    m[ix + 5] = 0xcc;
    left = (m[0x62a6] & 0x80) === 0;
  } else {
    left = random(g) >= 0x68;
  }
  m[ix + 3] = left ? 0x07 : 0xf8;
  m[ix] = 1;
  m[ix + 7] = 0x4b;
  m[ix + 9] = 8;
  m[ix + 0x0a] = 3;
  m[0x639b] = 0x7c;
  m[0x639a] = 0;
  // $258F decrements (HL) meaning the pie timer, but the random number call
  // left HL pointing at $6019
  m[0x6019] = (m[0x6019] - 1) & 0xff;
}

/** $2591: carry the pies along their trays; drop them in the fire or off the ends. */
function movePies(g) {
  const m = g.m;
  for (let i = 0; i < 6; i++) {
    const ix = 0x65a0 + i * 0x10;
    if (!(m[ix] & 1)) continue;
    const h = m[ix + 3];
    let gone = ((h + 7) & 0xff) < 0x0e;
    if (!gone) {
      if (m[ix + 5] === 0x7c) {
        if (h === 0x80) gone = true;
        else m[ix + 3] = (h + m[h < 0x80 ? 0x63a4 : 0x63a5]) & 0xff;
      } else m[ix + 3] = (h + m[0x63a6]) & 0xff;
    }
    if (gone) {
      m[ix] = 0;
      m[ix + 3] = 0;
      m[0x69b8 + i * 4] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Conveyors
// ---------------------------------------------------------------------------

/** $25F2 */
export function conveyors(g) {
  if (!rst30(g, 2)) return;
  conveyorTop(g);
  conveyorMiddle(g);
  conveyorBottom(g);
  rideBelt(g);
}

/** $2602: the top belt, reversing every 256 frames. */
export function conveyorTop(g) {
  const m = g.m;
  if (!(m[0x601a] & 1)) {
    m[0x62a0] = (m[0x62a0] - 1) & 0xff;
    if (m[0x62a0] === 0) { m[0x62a0] = 0x80; reverse(g, 0x62a1); }
  }
  m[0x63a3] = beltStep(g, 0x62a1);
  if ((m[0x601a] & 0x1f) !== 1) return;
  pulleys(g, 0x69e4, 0x62a1);
}

/** $262F: the middle trays move outwards or inwards together; always left while Mario is on the bottom. */
function conveyorMiddle(g) {
  const m = g.m;
  if (m[0x6205] < 0xc0) {
    if (!(m[0x62a3] & 0x80)) m[0x62a3] = 0xff;
  } else if (!(m[0x601a] & 1)) {
    m[0x62a2] = (m[0x62a2] - 1) & 0xff;
    if (m[0x62a2] === 0) { m[0x62a2] = 0xc0; reverse(g, 0x62a3); }
  }
  const a = beltStep(g, 0x62a3);
  m[0x63a5] = a;
  m[0x63a4] = (-a) & 0xff;
  if (m[0x601a] & 0x1f) return;
  const s = pulleys(g, 0x69ec, 0x62a2);
  m[0x69ed] = s & 0x7f;
}

/** $2679 */
function conveyorBottom(g) {
  const m = g.m;
  if (!(m[0x601a] & 1)) {
    m[0x62a5] = (m[0x62a5] - 1) & 0xff;
    if (m[0x62a5] === 0) { m[0x62a5] = 0xff; reverse(g, 0x62a6); }
  }
  m[0x63a6] = beltStep(g, 0x62a6);
  if ((m[0x601a] & 0x1f) !== 2) return;
  pulleys(g, 0x69f4, 0x62a6);
}

/** $26A6: turn a belt's end pulleys (sprites hl+1 and hl+5) with the belt at de. */
function pulleys(g, hl, de) {
  const m = g.m;
  const a1 = hl + 1, a2 = hl + 5;
  if (m[de] & 0x80) {
    let a = (m[a1] - 1) & 0xff; if (a === 0x4f) a = 0x52; m[a1] = a;
    a = (m[a2] + 1) & 0xff; if (a === 0xd3) a = 0xd0; m[a2] = a;
    return a;
  }
  let a = (m[a1] + 1) & 0xff; if (a === 0x53) a = 0x50; m[a1] = a;
  a = (m[a2] - 1) & 0xff; if (a === 0xcf) a = 0xd2; m[a2] = a;
  return a;
}

/** $26DE */
function reverse(g, p) {
  g.m[p] = g.m[p] & 0x80 ? 0x02 : 0xfe;
}

/** $26E9: this frame's belt movement: 0 on even frames, else +1 / -1. */
function beltStep(g, p) {
  const m = g.m;
  if (!(m[0x601a] & 1)) return 0;
  const a = m[p] & 0x80 ? 0xff : 0x01;
  m[p] = a;
  return a;
}

/** $2AD3: Mario standing on a belt is carried along it. */
function rideBelt(g) {
  const m = g.m;
  const x = m[0x6203];
  let a;
  switch (m[0x6205]) {
    case 0x50: a = m[0x63a3]; break;
    case 0x78: a = m[x >= 0x80 ? 0x63a5 : 0x63a4]; break;
    case 0xc8: a = m[0x63a6]; break;
    default: return;
  }
  m[0x6203] = m[0x694c] = (x + a) & 0xff;
  const [d, e] = walls(g);
  if (e === 1) m[0x6203]--;
  else if (d === 1) m[0x6203]++;
}

// ---------------------------------------------------------------------------
// Retractable ladders on the conveyor stage ($6280 left, $6288 right)
// ---------------------------------------------------------------------------

/** $2207 */
export function retractLadders(g) {
  const m = g.m;
  if (!rst30(g, 2)) return;
  const hl = m[0x601a] & 1 ? 0x6280 : 0x6288;
  switch (m[hl]) {
    case 0: {
      // up: count down, then start moving
      m[hl + 1] = (m[hl + 1] - 1) & 0xff;
      if (m[hl + 1] !== 0) { if (marioOn(g, hl + 2)) m[0x621a] = 0; return; }
      m[hl]++;
      if (marioOn(g, hl + 2)) m[0x621a] = 1;
      return;
    }
    case 1: {
      // moving down a pixel every 4 frames, carrying Mario with it
      m[hl + 4] = (m[hl + 4] - 1) & 0xff;
      if (m[hl + 4] !== 0) return;
      m[hl + 4] = 4;
      m[hl + 3]++;
      ladderSprite(g, hl + 3);
      if (m[hl + 3] === 0x78) m[hl]++;
      if (!marioOn(g, hl + 2)) return;
      const y = m[0x6205];
      if (y < 0x68 || (y & 1)) {
        m[0x6205]++;
        m[0x694d] = 3;
        m[0x694f]++;
        return;
      }
      m[0x6222] = y & 2 ? 1 : 0;
      return;
    }
    case 2:
      if (m[0x6018] & 0x3c) return;
      m[hl]++;
      return;
    case 3: {
      m[hl + 4] = (m[hl + 4] - 1) & 0xff;
      if (m[hl + 4] !== 0) return;
      m[hl + 4] = 2;
      m[hl + 3]--;
      ladderSprite(g, hl + 3);
      if (m[hl + 3] !== 0x68) return;
      m[hl + 1] = 0x80;
      m[hl] = 0;
    }
  }
}

/** $2243: is Mario (not jumping, high enough) lined up with the ladder whose X is at p? */
function marioOn(g, p) {
  const m = g.m;
  if (m[0x6205] >= 0x7a) return false;
  if (m[0x6216]) return false;
  return m[0x6203] === m[p];
}

/** $22BD */
function ladderSprite(g, p) {
  g.m[p & 8 ? 0x694b : 0x6947] = g.m[p];
}

// ---------------------------------------------------------------------------
// Elevators ($6600, six 16-byte slots)
// ---------------------------------------------------------------------------

/** $26FA */
export function elevators(g) {
  const m = g.m;
  if (!rst30(g, 4)) return;
  if (m[0x6205] >= 0xf0) return killMario(g);
  const t = m[0x601a];
  let move;
  if (m[0x6229] === 1) {
    const a = t & 3;
    if (a === 1) move = false;
    else if (a === 0) move = true;
    else return;
  } else move = (t & 1) === 1;
  if (!move) return ride(g);
  moveElevators(g);
  newElevator(g);
  for (let i = 0; i < 6; i++) {
    m[0x6958 + i * 4] = m[0x6603 + i * 0x10];
    m[0x695b + i * 4] = m[0x6605 + i * 0x10];
  }
}

/** $2745: carry Mario up (left shaft) or down (right shaft). */
function ride(g) {
  const m = g.m;
  if (m[0x6398] === 0 || m[0x6216]) return;
  const x = m[0x6203];
  if (x >= 0x2c && x < 0x43) {
    if (m[0x6205] < 0x71) return killMario(g);
    m[0x6205]--;
    m[0x694f] = m[0x6205];
    return;
  }
  if (x >= 0x6c && x < 0x83) {
    if (m[0x6205] >= 0xe8) return killMario(g);
    m[0x6205]++;
    m[0x694f] = m[0x6205];
    return;
  }
  m[0x6398] = 0;
  m[0x6221] = 1;
}

function killMario(g) {
  g.m[0x6200] = 0;
  g.m[0x6398] = 0;
}

/** $2797 */
function moveElevators(g) {
  const m = g.m;
  for (let i = 0; i < 6; i++) {
    const ix = 0x6600 + i * 0x10;
    if (!(m[ix] & 1)) continue;
    if (m[ix + 0x0d] & 8) {
      m[ix + 5] = (m[ix + 5] - 1) & 0xff;
      if (m[ix + 5] === 0x60) { m[ix + 3] = 0x77; m[ix + 0x0d] = 4; }
    } else {
      m[ix + 5] = (m[ix + 5] + 1) & 0xff;
      if (m[ix + 5] === 0xf8) m[ix] = 0;
    }
  }
}

/** $27DA: a new platform at the bottom of the left shaft every $34 moves. */
function newElevator(g) {
  const m = g.m;
  if (m[0x62a7] !== 0) { m[0x62a7]--; return; }
  for (let i = 0; i < 6; i++) {
    const ix = 0x6600 + i * 0x10;
    if (m[ix] & 1) continue;
    m[ix] = 1;
    m[ix + 3] = 0x37;
    m[ix + 5] = 0xf8;
    m[ix + 0x0d] = 8;
    m[0x62a7] = 0x33;
    return;
  }
}

// ---------------------------------------------------------------------------
// Springs on the elevator stage ($6500, ten 16-byte slots)
// ---------------------------------------------------------------------------

/** $2E04 */
export function springs(g) {
  const m = g.m;
  if (!rst30(g, 4) || !rst10(g)) return;
  for (let i = 0; i < 10; i++) {
    const ix = 0x6500 + i * 0x10, iy = 0x6980 + i * 4;
    if (!(m[ix] & 1)) {
      if (!(m[0x6396] & 1)) continue;
      m[0x6396] = 0;
      m[ix + 5] = 0x50;
      m[ix + 0x0d] = 1;
      m[ix + 3] = ((random(g) & 0x0f) + 0xf8) & 0xff;
      m[ix] = 1;
      m[ix + 0x0e] = 0xaa;
      m[ix + 0x0f] = 0x39;
      continue;
    }
    if ((m[0x601a] & 0x0f) === 0) m[iy + 1] ^= 7;
    if (m[ix + 0x0d] === 4) {
      // dropping down the right-hand side
      m[ix + 5] = (m[ix + 5] + 3) & 0xff;
      if (m[ix + 5] >= 0xf8) { m[ix + 3] = 0; m[ix] = 0; }
    } else {
      m[ix + 3] = (m[ix + 3] + 2) & 0xff;
      let hl = m[ix + 0x0e] | (m[ix + 0x0f] << 8);
      const c = m[hl];
      if (c === 0x7f) { hl = 0x39aa; m[0x6083] = 3; }
      else { hl++; m[ix + 5] = (c + m[ix + 5]) & 0xff; }
      m[ix + 0x0e] = hl & 0xff;
      m[ix + 0x0f] = hl >> 8;
      if (m[ix + 3] >= 0xb7 && c === 0x7f) {
        m[ix + 0x0d] = 4;
        m[0x6083] = 0;
        m[0x6084] = 3;
      }
    }
    m[iy] = m[ix + 3];
    m[iy + 3] = m[ix + 5];
  }
}

// ---------------------------------------------------------------------------
// Hammer ($6680 and $6690)
// ---------------------------------------------------------------------------

/** $2ED4 */
export function hammer(g) {
  const m = g.m;
  if (!rst30(g, 0x0b) || !rst10(g)) return;
  let de = 0x6a18, ix = 0x6680;
  if (!(m[0x6681] & 1)) { de = 0x6a1c; ix = 0x6690; }
  m[ix + 0x0e] = 0;
  m[ix + 0x0f] = 0xf0;
  let b, c;
  if (!(m[0x6217] & 1)) {
    // $2F97: just grabbed: held up
    if (!(m[0x6218] & 1)) return;
    m[ix + 9] = 6;
    m[ix + 0x0a] = 3;
    b = m[0x6207] & 0x80 ? 0x9e : 0x1e;
    c = 7;
    m[0x6389] = m[0x6089];
  } else {
    m[0x6218] = 0;
    m[0x6089] = 4;
    m[ix + 9] = 6;
    m[ix + 0x0a] = 3;
    b = 0x1e;
    let a = (m[0x6207] << 1) & 0xff;
    if (m[0x6207] & 0x80) { a |= 0x80; b |= 0x80; }
    c = a | 8;
    if (m[0x6394] & 8) {
      // swung down, in front of Mario
      b |= 1; c |= 1;
      m[ix + 9] = 5;
      m[ix + 0x0a] = 6;
      m[ix + 0x0f] = 0;
      m[ix + 0x0e] = c & 0x80 ? 0x10 : 0xf0;
    }
    m[0x694d] = c;
    c = 7;
    m[0x6394] = (m[0x6394] + 1) & 0xff;
    let flash;
    if (m[0x6394] !== 0) flash = m[0x6395] !== 0;
    else {
      m[0x6395]++;
      if (m[0x6395] === 2) {
        // worn out
        m[0x6395] = 0;
        m[0x6217] = 0;
        m[ix + 1] = 0;
        m[ix + 0x0e] = (-m[0x6203]) & 0xff;
        m[0x694d] = m[0x6207];
        m[ix] = 0;
        m[0x6089] = m[0x6389];
        flash = false;
      } else flash = true;
    }
    if (flash && (m[0x601a] & 8)) c = 1;
  }
  // $2F7C
  const x = (m[0x6203] + m[ix + 0x0e]) & 0xff;
  m[de] = x; m[ix + 3] = x;
  m[de + 1] = b;
  m[de + 2] = c;
  const y = (m[0x6205] + m[ix + 0x0f]) & 0xff;
  m[de + 3] = y; m[ix + 5] = y;
}


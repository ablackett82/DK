// Mario: walking, ladders, jumping, landing and falling ($1AC3 and the
// routines it uses), plus the shared helpers for ladders ($236E), slopes
// ($2333), jump arcs ($239C) and collision boxes ($2913).
import { rst30, stepper } from './core.js';
import { vramAddr } from './stage.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * $236E: look for a ladder at column x whose top or bottom is at y (= d).
 * Returns null when there is none (the original returned to its caller's
 * caller), else {a: 1 at the top / 0 at the bottom, b: Y of the other end,
 * c: slots left after the match (<= 4 for the broken ladders at $6310+)}.
 */
export function ladderAt(g, x, d) {
  const m = g.m;
  let hl = 0x6300, bc = 0x15;
  while (bc > 0) {
    // CPIR
    const hit = m[hl] === x;
    hl++; bc--;
    if (!hit) continue;
    const top = hl + 0x14, bottom = top + 0x15;
    if (m[top] === d) return { a: 1, b: m[bottom], c: bc };
    if (m[bottom] === d) return { a: 0, b: m[top], c: bc };
  }
  return null;
}

/** $2333: follow a sloped girder: new Y for (h = x, l = y) moving in direction b (1 or $FF). */
export function slope(h, l, b) {
  const a = h & 0x0f;
  if (b === 1) { if (a >= 1) return l; }
  else if (a < 0x0f) return l;
  b = b === 1 ? 1 : 0xff;
  if (l === 0xf0) return h & 0x80 ? (l - b) & 0xff : l;
  if (l === 0x4c) return h < 0x98 ? l : (l + b) & 0xff;
  return l & 0x20 ? (l - b) & 0xff : (l + b) & 0xff;
}

/** $239C: advance an object along its jump/fall arc (X += +$10/$11, Y -= +$12/$13 then += gravity). */
export function arc(g, ix) {
  const m = g.m;
  let a = m[ix + 4] + m[ix + 0x11];
  m[ix + 4] = a & 0xff;
  a = m[ix + 3] + m[ix + 0x10] + (a > 0xff ? 1 : 0);
  m[ix + 3] = a & 0xff;
  let l = m[ix + 6] - m[ix + 0x13];
  const borrow = l < 0 ? 1 : 0;
  l &= 0xff;
  const h = (m[ix + 5] - m[ix + 0x12] - borrow) & 0xff;
  const t = m[ix + 0x14];
  const bc = ((((t << 1) & 0x1ff) | 1) << 3) & 0xffff;
  const hl = (((h << 8) | l) + bc) & 0xffff;
  m[ix + 5] = hl >> 8;
  m[ix + 6] = hl & 0xff;
  m[ix + 0x14] = (t + 1) & 0xff;
}

/** $2407: +$14 << 4 minus the 16-bit (+$12, +$13): the current vertical speed. */
export function speed(g, ix) {
  const m = g.m;
  return ((m[ix + 0x14] << 4) - ((m[ix + 0x12] << 8) | m[ix + 0x13])) & 0xffff;
}

/** $241F: [d, e]: d = 1 at the left wall (or Kong's platform edge), e = 1 at the right wall. */
export function walls(g) {
  const m = g.m;
  const x = m[0x6203];
  if (x < 0x16) return [1, 0];
  if (x >= 0xea) return [0, 1];
  if (!(m[0x6227] & 1)) return [0, 0];
  if (m[0x6205] >= 0x58) return [0, 0];
  if (x >= 0x6c) return [0, 0];
  return [1, 0];
}

/**
 * $2913: does the box around iy (X at +3) with Y c and half-sizes h, l hit any
 * of b active objects from ix, de apart (their half-sizes at +9, +$A)?
 * Returns {a: 1, b: count left at the hit} or {a: 0, b: 0}.
 */
export function collide(g, iy, c, h, l, ix, b, de) {
  const m = g.m;
  for (; b > 0; b--, ix += de) {
    if (!(m[ix] & 1)) continue;
    let d = absDiff(c, m[ix + 5]);
    let r = ((d + 1) & 0xff) - l;
    if (r >= 0 && r - m[ix + 0x0a] >= 0) continue;
    d = absDiff(m[iy + 3], m[ix + 3]);
    r = d - h;
    if (r >= 0 && r - m[ix + 0x09] >= 0) continue;
    return { a: 1, b };
  }
  return { a: 0, b: 0 };
}

export function absDiff(a, b) {
  return a >= b ? a - b : b - a;
}

// ---------------------------------------------------------------------------
// Mario's movement ($1AC3)
// ---------------------------------------------------------------------------

export function moveMario(g) {
  const m = g.m;
  if (m[0x6216] === 1) return jumping(g);
  if (m[0x621e] !== 0) return landingPause(g);
  if (m[0x6217] !== 1) {
    if (m[0x6215] === 1) return onLadder(g);
    if (m[0x6010] & 0x80) return startJump(g);
  }
  const [d, e] = walls(g);
  const input = m[0x6010];
  if (e !== 1 && (input & 1)) return walk(g, 1, 5);
  if (d !== 1 && (input & 2)) return walk(g, 0xff, 1);
  if (m[0x6217] === 1) return;
  // standing still: is there a ladder to get on?
  const y = (m[0x6205] + 8) & 0xff;
  const x = (m[0x6203] | 3) & ~4;
  const lad = ladderAt(g, x, y);
  if (!lad) return;
  m[0x6207] = (m[0x6207] & 0x80) | 0x06;
  m[0x621a] = lad.c <= 4 ? 1 : 0;
  if (lad.a === 0) {
    m[0x621b] = lad.b;
    m[0x621c] = y;
    return ladderUp(g);
  }
  if (m[0x621a]) return; // can't go down a broken ladder
  m[0x621b] = y;
  m[0x621c] = lad.b;
  return onLadder(g);
}

/** $1B38 */
function onLadder(g) {
  const m = g.m;
  if (m[0x6010] & 0x08) return climbDown(g);
  if (m[0x6215] === 0) return;
  return ladderUp(g);
}

/** $1B45 */
function ladderUp(g) {
  if (g.m[0x6010] & 0x04) return climbUp(g);
}

/** $1B55: the four frames of crouch after a landing. */
function landingPause(g) {
  const m = g.m;
  m[0x621e] = (m[0x621e] - 1) & 0xff;
  if (m[0x621e] !== 0) return;
  m[0x6217] = m[0x6218];
  m[0x6207] &= 0x80;
  m[0x6202] = 0;
  updateSprite(g);
}

/** $1B6E */
function startJump(g) {
  const m = g.m;
  m[0x6216] = 1;
  const input = m[0x6010];
  let b = 0, c = 0;
  if (input & 1) { b = 0; c = 0x80; }
  else if (input & 2) { b = 0xff; c = 0x80; }
  m[0x6210] = b;
  m[0x6211] = c;
  m[0x6212] = 1;
  m[0x6213] = 0x48;
  m[0x6214] = 0;
  m[0x6204] = 0;
  m[0x6206] = 0;
  m[0x6207] = (m[0x6207] & 0x80) | 0x0e;
  m[0x620e] = m[0x6205];
  m[0x6081] = 3;
}

/** $1BB2 */
function jumping(g) {
  const m = g.m;
  const ix = 0x6200;
  m[0x620b] = m[0x6203];
  m[0x620c] = m[0x6205];
  arc(g, ix);
  const [d, e] = walls(g);
  if (d === 1 || e === 1) {
    // bounce off the wall
    m[0x6210] = d === 1 ? 0 : 0xff;
    m[0x6211] = 0x80;
    if (d === 1) m[0x6207] |= 0x80; else m[0x6207] &= 0x7f;
    if (m[0x6220] !== 1) {
      const hl = speed(g, ix);
      m[0x6212] = hl >> 8;
      m[0x6213] = hl & 0xff;
      m[0x6214] = 0;
    }
    arc(g, ix);
  }
  // $1C05
  const [a, b] = landing(g);
  if (a === 1) {
    if (b !== 1) {
      // hit a wall or the underside of something: drop straight down
      m[0x621f] = 1;
      m.fill(0, 0x6210, 0x6215);
      return updateSprite(g);
    }
    m[0x6216] = 0;
    m[0x6200] = m[0x6220] ^ 1;       // fell too far: dead
    m[0x6207] = (m[0x6207] & 0x80) | 0x0f;
    m[0x621e] = 4;
    m[0x621f] = 0;
    if (m[0x6225] === 1) bonusSound(g, 0);
    return updateSprite(g);
  }
  if (m[0x621f] === 1) {
    // $1C76: coming down: too far below the take-off height?
    if (((m[0x6205] - 0x0f) & 0xff) >= m[0x620e]) {
      m[0x6220] = 1;
      m[0x6084] = 3;
    }
    return updateSprite(g);
  }
  let t = (m[0x6214] - 0x14) & 0xff;
  if (t === 0) {
    // apex: score anything jumped over
    m[0x621f] = 1;
    const j = jumpedOver(g);
    if (j === 0) return updateSprite(g);
    m[0x6342] = j;
    m[0x6340] = 1;
    m[0x6225] = 1;
    t = 1;
  }
  if (((t + 1) & 0xff) === 0) hammerGrab(g);
  updateSprite(g);
}

/** $1C8F / $1CAB: walk one step right (b = 1) or left (b = $FF). */
function walk(g, b, seq) {
  const m = g.m;
  if (m[0x620f] !== 0) {
    // $1CD2: move a pixel
    m[0x6203] = (m[0x6203] + b) & 0xff;
    if (m[0x6227] === 1) m[0x6205] = slope(m[0x6203], m[0x6205], b);
    m[0x620f] = (m[0x620f] - 1) & 0xff;
    return updateSprite(g);
  }
  // animate
  let a = stepper(seq, m[0x6202]);
  m[0x6202] = a;
  a &= 3;
  if (b === 1) a |= 0x80;
  m[0x6207] = a;
  if (a & 1) m[0x6080] = 3;
  m[0x620f] = 2;
  updateSprite(g);
}

/** $1CF2 */
function climbDown(g) {
  const m = g.m;
  if (m[0x620f] !== 0) { m[0x620f]--; return; }
  m[0x620f] = 3;
  climb(g, 2);
}

/** $1D03 */
function climbUp(g) {
  const m = g.m;
  if (m[0x620f] !== 0) {
    // $1D76: on a retracting or broken ladder, stop short of the top
    if (m[0x621a] !== 0) {
      m[0x6219] = m[0x621a];
      if (((m[0x621c] - 0x13) & 0xff) >= m[0x6205]) return;
    }
    m[0x620f]--;
    return;
  }
  m[0x620f] = 4;
  climb(g, 0xfe);
}

/** $1D11 */
function climb(g, dy) {
  const m = g.m;
  m[0x6205] = (m[0x6205] + dy) & 0xff;
  const y = m[0x6205];
  m[0x6222] ^= 1;
  if (m[0x6222] !== 0) {
    // $1D51: snap to the ladder, footstep every other move
    m[0x6203] = (m[0x6203] | 3) & ~4;
    m[0x6224] ^= 1;
    if (m[0x6224] === 0) m[0x6080] = 3;
  } else {
    let a = (y + 8) & 0xff;
    if (a === m[0x621c] || a === m[0x621b]) {
      // $1D67: off the ladder
      m[0x6207] = 6;
      m[0x6219] = 0;
      m[0x6215] = 0;
      return updateSprite(g);
    }
    a = (a - m[0x621b]) & 0xff;
    let b = 5;
    a = (a - 8) & 0xff;
    if (a !== 0) { b = 4; a = (a - 4) & 0xff; if (a !== 0) b = 3; }
    m[0x6207] = ((m[0x6207] & 0x80) ^ 0x80) | b;
  }
  m[0x6215] = 1;
  updateSprite(g);
}

/** $1D95: bonus jingle (not on the girders); a is stored in the bonus-sound flag. */
export function bonusSound(g, a) {
  const m = g.m;
  m[0x6225] = a;
  if (m[0x6227] === 1) return;
  m[0x608a] = 0x0d;
  m[0x608b] = 3;
}

/** $1DA6: copy Mario's position, pose and colour to his sprite. */
export function updateSprite(g) {
  const m = g.m;
  m[0x694c] = m[0x6203];
  m[0x694d] = m[0x6207];
  m[0x694e] = m[0x6208];
  m[0x694f] = m[0x6205];
}

// ---------------------------------------------------------------------------
// Landing ($2B1C)
// ---------------------------------------------------------------------------

/** Returns [a, b]: a = 1 when the jump ends (b = 1 landed, 0 blocked). */
function landing(g) {
  const m = g.m;
  const r = landOnGirder(g);
  if (r) return r;
  // $29AF: elevators
  if (!rst30(g, 4)) return [0, 0];
  const hit = collide(g, 0x6200, m[0x6205], 4, 8, 0x6600, 6, 0x10);
  if (hit.a === 0) return [0, 0];
  const ix = 0x6600 + (6 - hit.b) * 0x10;
  const d = (m[ix + 5] - 4) & 0xff;
  if (((m[0x620c] + 5) & 0xff) < d) {
    m[0x6205] = (d - 8) & 0xff;
    m[0x6398] = 1;
    return [1, 1];
  }
  if (((m[0x620c] - 0x0e) & 0xff) >= d) { m[0x6200] = 0; return [0, 0]; }
  snapToEdge(g);
  return [1, 0];
}

/** $2B7A / $29F7: push Mario back out of the thing he jumped into the side of. */
function snapToEdge(g) {
  const m = g.m;
  const x = m[0x6203];
  const a = m[0x6210] === 0 ? ((((x - 8) & 0xff) | 7) + 4) & 0xff : (((x | 7) - 4) & 0xff);
  m[0x6203] = m[0x694c] = a;
}

/** $2B29: land on (or bump into) the tile under Mario's feet. Returns [a, b] to end the call early, else null. */
function landOnGirder(g) {
  const m = g.m;
  const x = m[0x6203], y = m[0x6205];
  if (m[0x6227] === 1) {
    const r = footTile(g, x, (y + 7) & 0xff);
    if (r.land) return [1, 1];
    if (r.a === 0) return [0, 0];
    if (((r.e - r.c) & 0xff) >= 4) return [0, 0];
    m[0x6205] = (r.c - 7) & 0xff;
    return [1, 1];
  }
  const h = (x - 3) & 0xff, l = (y + 7) & 0xff;
  let r = footTile(g, h, l);
  if (r.land) return [1, 1];
  if (r.a !== 2) {
    r = footTile(g, (h + 7) & 0xff, l);
    if (r.land) return [1, 1];
    if (r.a === 0) return null;
  }
  snapToEdge(g);
  return [1, 0];
}

/**
 * $2B9B: the girder tile at pixel (h, l). {land: true} when Mario lands on it
 * (his Y is set); {a: 2} when his head is passing up through it; {a: 0} when clear.
 * c is the girder's top line.
 */
function footTile(g, h, l) {
  const m = g.m;
  const e = l;
  const t = m[vramAddr(h, l)];
  if (t < 0xb0 || (t & 0x0f) >= 8 || t === 0xc0) return { a: 0, c: 0, e };
  let c;
  if (t < 0xc0) c = ((e & 0xf8) - 1) & 0xff;
  else {
    c = t < 0xd0 || (t >= 0xe0 && t < 0xf0) ? ((t & 0x0f) - 9) & 0xff : ((t & 0x0f) - 1) & 0xff;
    c = ((e & 0xf8) + c) & 0xff;
    if (c >= e) return { a: 0, c, e };
  }
  const a = (m[0x620c] - m[0x6205] + e) & 0xff;
  if (a > c) return { a: 2, c, e };
  m[0x6205] = (c - 7) & 0xff;
  return { land: true };
}

// ---------------------------------------------------------------------------
// Jumping over things and grabbing hammers
// ---------------------------------------------------------------------------

/** $2853: at the apex: 1/3/7 for one/two/three-plus barrels or fires jumped on the girders, else 1 if anything. */
function jumpedOver(g) {
  const m = g.m;
  const c = (m[0x6205] + 0x0c) & 0xff;
  const h = m[0x6010] & 3 ? 0x13 : 0x05, l = 0x08;
  if (m[0x6227] !== 1) return hostileHit(g, 0x6200, c, h, l).a;
  // $3E99
  m[0x6060] = 0;
  countOver(g, c, h, l, 0x6700, 0x0a);
  countOver(g, c, h, l, 0x6400, 0x05);
  const n = m[0x6060];
  if (n === 0) return 0;
  if (n === 1) return 1;
  return n < 3 ? 3 : 7;
}

/** $3EC3 */
function countOver(g, c, h, l, ix, b) {
  const m = g.m;
  for (; b > 0; b--, ix += 0x20) {
    if (!(m[ix] & 1)) continue;
    let d = absDiff(c, m[ix + 5]);
    let r = ((d + 1) & 0xff) - l;
    if (r >= 0 && r - m[ix + 0x0a] >= 0) continue;
    d = absDiff(m[0x6203], m[ix + 3]);
    r = d - h;
    if (r >= 0 && r - m[ix + 0x09] >= 0) continue;
    m[0x6060]++;
  }
}

/**
 * $286F: test a box against this screen's dangerous objects. Sets $63B9 to
 * the size of the group being tested; returns {a, b, ix, de} for the hit.
 */
export function hostileHit(g, iy, c, h, l) {
  const m = g.m;
  const groups = {
    1: [[0x6700, 0x0a, 0x20], [0x6400, 0x05, 0x20], [0x66a0, 0x01, 0x00]],
    2: [[0x6400, 0x05, 0x20], [0x65a0, 0x06, 0x10], [0x66a0, 0x01, 0x00]],
    3: [[0x6400, 0x05, 0x20], [0x6500, 0x0a, 0x10]],
    4: [[0x6400, 0x07, 0x20]],
  }[m[0x6227]] || [];
  for (const [ix, b, de] of groups) {
    m[0x63b9] = b;
    const r = collide(g, iy, c, h, l, ix, b, de);
    if (r.a) return { a: 1, b: r.b, ix, de };
  }
  return { a: 0, b: 0, ix: 0, de: 0 };
}

/** $2954: one pixel below the apex: grab a hammer if touching one. */
function hammerGrab(g) {
  const m = g.m;
  if (!rst30(g, 0x0b)) return;
  const r = collide(g, 0x6200, m[0x6205], 4, 8, 0x6680, 2, 0x10);
  m[0x6218] = r.a;
  m[0x6085] = r.a ? 0x40 : 0;
  if (r.b === 0) return;
  if (r.b === 1) m[0x6691] = 1; else m[0x6681] = 1;
}

// ---------------------------------------------------------------------------
// Walking off edges
// ---------------------------------------------------------------------------

/** $2A85: start falling when there's no girder under Mario's feet. */
export function checkFooting(g) {
  const m = g.m;
  if (m[0x6215] || m[0x6216] || m[0x6398] === 1) return;
  const d = (m[0x6203] - 3) & 0xff;
  const l = (m[0x6205] + 0x0c) & 0xff;
  let hl = vramAddr(d, l);
  const solid = (t) => t >= 0xb0 && (t & 0x0f) < 8;
  if (solid(m[hl])) return;
  if ((d & 7) !== 0) {
    hl = (hl - 0x20) & 0xffff;
    if (solid(m[hl])) return;
  }
  m[0x6221] = 1;
}

/** $1F46: turn a fall into a jump with no take-off. */
export function startFall(g) {
  const m = g.m;
  if (m[0x6221] === 0) return;
  m[0x6204] = 0;
  m[0x6206] = 0;
  m[0x6221] = 0;
  m.fill(0, 0x6210, 0x6215);
  m[0x6216] = 1;
  m[0x621f] = 1;
  m[0x620e] = m[0x6205];
}

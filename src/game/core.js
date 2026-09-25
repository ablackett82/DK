// Core routines: the NMI and main loop, the RST helpers, sound buffers, the
// task queue and the tasks it runs (score, text, bonus timer, lives).
import { playing } from './flow.js';
import { difficultyTick, oilFireTick } from './stage.js';

// ---------------------------------------------------------------------------
// RST helpers
// ---------------------------------------------------------------------------

/** RST #8: carry on only if credits exist or a game is being played. */
export const rst8 = (g) => (g.m[0x6007] & 1) === 0;

/** RST #10: carry on only if Mario is alive. */
export const rst10 = (g) => (g.m[0x6200] & 1) === 1;

/** RST #18: count down WaitTimerMSB ($6009); carry on only when it reaches 0. */
export function rst18(g) {
  const m = g.m;
  m[0x6009] = (m[0x6009] - 1) & 0xff;
  return m[0x6009] === 0;
}

/** RST #20: count down the 16-bit WaitTimer ($6008/9) MSB-first; carry on when the MSB hits 0. */
export function rst20(g) {
  const m = g.m;
  m[0x6008] = (m[0x6008] - 1) & 0xff;
  if (m[0x6008] !== 0) return false;
  return rst18(g);
}

/** RST #30: carry on only if bit (screen-1) of `mask` is set (1 girders, 2 conveyors, 4 elevators, 8 rivets). */
export const rst30 = (g, mask) => ((mask >> (g.m[0x6227] - 1)) & 1) === 1;

/** RST #38 / $003D: add c to b bytes spaced de apart from hl (default: 10 bytes, 4 apart). */
export function addEvery(g, hl, c, b = 10, de = 4) {
  const m = g.m;
  for (; b > 0; b--) { m[hl] = (m[hl] + c) & 0xff; hl = (hl + de) & 0xffff; }
  return hl;
}

/** $004E: copy $28 bytes of Kong sprite data from hl to $6908; returns hl after the block. */
export function setKong(g, hl) {
  g.m.copyWithin(0x6908, hl, hl + 0x28);
  return hl + 0x28;
}

/** $0057: the random number generator. */
export function random(g) {
  const m = g.m;
  m[0x6018] = (m[0x6018] + m[0x601a] + m[0x6019]) & 0xff;
  return m[0x6018];
}

// ---------------------------------------------------------------------------
// NMI and main loop
// ---------------------------------------------------------------------------

/** $0066: the vblank interrupt, where all game logic runs. */
export function nmi(g) {
  const m = g.m;
  if (m[0x6007] === 0) {
    // $0098: read the joystick; bit 7 of InputState flags a fresh jump press
    const b = g.in0;
    const fresh = (~m[0x6011] & b & 0x10) << 3;
    m[0x6010] = (fresh | (b & 0x0f)) & 0xff;
    m[0x6011] = b;
  }
  m[0x601a] = (m[0x601a] - 1) & 0xff;  // FrameCounter
  random(g);
  updateSounds(g);
  if (m[0x6005] === 3) playing(g);    // GameMode1: the other modes (attract, coins) are not used here
}

/** $02BD: one frame's worth of the main loop. */
export function mainLoop(g, rngStep = 1) {
  const m = g.m;
  runTasks(g);
  flashPlayerUp(g);
  checkExtraLife(g);
  m[0x6019] = (m[0x6019] + rngStep) & 0xff; // the idle pass that notices the new frame
  if (m[0x601a] !== m[0x6383]) {
    m[0x6383] = m[0x601a];
    difficultyTick(g);
    oilFireTick(g);
  }
  runTasks(g);
  flashPlayerUp(g);
  checkExtraLife(g);
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

/** $00E0: write the sound buffer ($6080-$6087) to the sound registers, counting down durations. */
export function updateSounds(g) {
  const m = g.m;
  if (m[0x6007] !== 0) return;
  for (let i = 0; i < 8; i++) {
    let a = m[0x6080 + i];
    if (a) { m[0x6080 + i] = a - 1; a = 1; }
    g.sfx[i] = a;
  }
  if (m[0x608b] === 0) g.music = m[0x6089];
  else { m[0x608b]--; g.music = m[0x608a]; }
  if (m[0x6088]) { m[0x6088]--; g.death = 1; } else g.death = 0;
}

/** $011C: silence everything. */
export function clearSounds(g) {
  const m = g.m;
  g.sfx.fill(0);
  m.fill(0, 0x6080, 0x608c);
  g.death = 0;
  g.music = 0;
}

// ---------------------------------------------------------------------------
// Task queue ($60C0-$60FF, pointers $60B0 write / $60B1 read)
// ---------------------------------------------------------------------------

/** $309F: queue task d with parameter e. */
export function addTask(g, d, e) {
  const m = g.m;
  let l = m[0x60b0];
  if ((m[0x6000 + l] & 0x80) === 0) return; // queue full: slot still holds a task
  m[0x6000 + l] = d;
  m[0x6000 + l + 1] = e;
  l = (l + 2) & 0xff;
  if (l < 0xc0) l = 0xc0;
  m[0x60b0] = l;
}

const TASKS = [addScore, clearScore, showScore, drawText, showCredits, bonusTask, showLives];

/** $02BD-$02E3: run queued tasks until the queue is empty. */
export function runTasks(g) {
  const m = g.m;
  for (;;) {
    let l = m[0x60b1];
    const t = m[0x6000 + l];
    if (t & 0x80) return;
    const n = (t * 2 & 0x1f) >> 1;
    m[0x6000 + l] = 0xff;
    l++;
    const param = m[0x6000 + l];
    m[0x6000 + l] = 0xff;
    l = (l + 1) & 0xff;
    if (l < 0xc0) l = 0xc0;
    m[0x60b1] = l;
    TASKS[n](g, param);
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** BCD add with the Z80's DAA semantics; returns [result, carry]. */
function bcdAdd(a, b, cin) {
  let lo = (a & 0x0f) + (b & 0x0f) + cin;
  let r = a + b + cin;
  const half = lo > 0x0f;
  let carry = r > 0xff;
  r &= 0xff;
  let adj = 0;
  if (half || (r & 0x0f) > 9) adj |= 0x06;
  if (carry || r > 0x99) { adj |= 0x60; carry = true; }
  return [(r + adj) & 0xff, carry ? 1 : 0];
}

/** Task 0 ($051C): add score entry `a` of the table at $3529 to the current player's score. */
export function addScore(g, a) {
  const m = g.m;
  if (!rst8(g)) return;
  let de = scoreAddr(g);
  let hl = 0x3529 + a * 3;
  let carry = 0;
  for (let i = 0; i < 3; i++) {
    [m[de], carry] = bcdAdd(m[de], m[hl], carry);
    de++; hl++;
  }
  showScoreAt(g, m[0x600d] ? 0x7521 : 0x7781, de - 1);
  // compare with the high score, top byte first
  de -= 1; hl = 0x60ba;
  for (let i = 0; i < 3; i++, de--, hl--) {
    if (m[de] < m[hl]) return;
    if (m[de] > m[hl]) {
      m.copyWithin(0x60b8, scoreAddr(g), scoreAddr(g) + 3);
      showScoreAt(g, 0x7641, 0x60ba);
      return;
    }
  }
}

/** $055F: address of the current player's score. */
const scoreAddr = (g) => (g.m[0x600d] ? 0x60b5 : 0x60b2);

/** $057C: draw the 6 BCD digits ending at hl (most significant byte) to the screen from ix. */
function showScoreAt(g, ix, hl) {
  const m = g.m;
  for (let b = 0; b < 3; b++, hl--) {
    m[ix] = m[hl] >> 4; ix -= 0x20;
    m[ix] = m[hl] & 0x0f; ix -= 0x20;
  }
}

/** Task 1 ($059B): clear a player's score (0 or 1) and show it. */
export function clearScore(g, a) {
  const m = g.m;
  let hl = a ? 0x60b5 : 0x60b2;
  if (a === 2) hl = 0x60b8;
  m[hl] = m[hl + 1] = m[hl + 2] = 0;
  showScore(g, a);
}

/** Task 2 ($05C6): show player 1's (0) or 2's (1) score, the high score (2), or all three (3). */
export function showScore(g, a) {
  if (a === 3) { for (let p = 2; p >= 0; p--) showScore(g, p); return; }
  if (a === 2) showScoreAt(g, 0x7641, 0x60ba);
  else if (a === 0) showScoreAt(g, 0x7781, 0x60b4);
  else showScoreAt(g, 0x7521, 0x60b7);
}

/** Task 3 ($05E9): draw text string `a` from the table at $364B; bit 7 set erases it instead. */
export function drawText(g, a) {
  const m = g.m;
  const erase = (a & 0x80) !== 0;
  let de = g.w(0x364b + ((a * 2) & 0x7f));
  let hl = g.w(de);
  de += 2;
  for (;;) {
    const c = m[de];
    if (c === 0x3f) return;
    m[hl] = erase ? 0x10 : c;
    de++;
    hl = (hl - 0x20) & 0xffff;
  }
}

/** Task 4 ($0611): draw the credit count (only when no game is running, so never here). */
export function showCredits(g) {
  if ((g.m[0x6007] & 1) === 0) return;
}

/** Task 5 ($062A): 0 = add the bonus to the score; 1 = tick the bonus timer and redraw it. */
export function bonusTask(g, a) {
  const m = g.m;
  if (a === 0) {
    // $0691: the timer holds hundreds; add them, then the thousands (score table entries $0A+)
    const b = m[0x638c];
    addScore(g, b & 0x0f);
    addScore(g, ((b >> 4) & 0x0f) + 0x0a);
    return;
  }
  let t = m[0x638c];
  if (t !== 0) {
    // $06A8: count down one (BCD)
    const r = (t - 1) & 0xff;
    if (r === 0) m[0x63b8] = 1;
    m[0x638c] = (t & 0x0f) === 0 ? (r - 6) & 0xff : r;
  } else {
    if (m[0x63b8] !== 0) return;
    // $063A: first call of the stage: tens of $62B0 (a whole number of tens) into the high digit
    let a2 = m[0x62b0], b = 0;
    do { b++; a2 = (a2 - 10) & 0xff; } while (a2 !== 0);
    m[0x638c] = (b << 4) & 0xff;
    // draw the box: 6 columns of 3 tiles from $384A, starting at $7465
    let hl = 0x384a, de = 0x7465;
    for (let i = 0; i < 6; i++) {
      m.copyWithin(de, hl, hl + 3);
      hl += 3;
      de = (de + 3 + 0x1d) & 0xffff;
    }
  }
  drawBonus(g);
}

/** $066A: draw the bonus timer's two digits (plus the fixed "00"), in red with a warning below 1000. */
function drawBonus(g) {
  const m = g.m;
  const c = m[0x638c];
  let b = c & 0x0f;
  let a = (c >> 4) & 0x0f;
  if (a === 0) {
    m[0x6089] = 3;                // "running out of time" music
    m[0x7486] = 0x70;
    m[0x74a6] = 0x70;
    b = (0x70 + b) & 0xff;
    a = 0x10;
  }
  m[0x74e6] = a;
  m[0x74c6] = b;
}

/** Task 6 ($06B8): draw the lives remaining (less `c`) and the level number. */
export function showLives(g, c) {
  const m = g.m;
  if (!rst8(g)) return;
  for (let i = 0, hl = 0x7783; i < 6; i++, hl -= 0x20) m[hl] = 0x10;
  const n = (m[0x6228] - c) & 0xff;
  for (let i = 0, hl = 0x7783; i < n; i++, hl = (hl - 0x20) & 0xffff) m[hl] = 0xff;
  m[0x7503] = 0x1c; // L
  m[0x74e3] = 0x34; // =
  if (m[0x6229] >= 100) m[0x6229] = 99;
  const lv = m[0x6229];
  m[0x74a3] = lv % 10;
  m[0x74c3] = (lv / 10) | 0;
}

/** $0A53: draw "1UP". */
export function draw1Up(g) {
  const m = g.m;
  m[0x7740] = 0x01; m[0x7720] = 0x25; m[0x7700] = 0x20;
}

/** $0315: flash "1UP" (or "2UP") every 16 frames. */
export function flashPlayerUp(g) {
  const m = g.m;
  const b = m[0x601a];
  if (b & 0x0f) return;
  if (!rst8(g)) return;
  let a = m[0x600d];
  let hl = a ? 0x74e0 : 0x7740;
  if (b & 0x10) {
    m[hl] = 0x10; m[hl - 0x20] = 0x10; m[hl - 0x40] = 0x10;
    if (m[0x600f] === 0) return;
    a = m[0x600d] ^ 1;
    hl = a ? 0x74e0 : 0x7740;
  }
  m[hl] = a + 1; m[hl - 0x20] = 0x25; m[hl - 0x40] = 0x20;
}

/** $0350: award the extra life once the score passes the threshold. */
export function checkExtraLife(g) {
  const m = g.m;
  if (m[0x622d]) return;
  const hl = m[0x600d] ? 0x60b6 : 0x60b3;
  // thousands and ten-thousands digits as one BCD byte
  const a = (((m[hl] & 0xf0) | (m[hl + 1] & 0x0f)) >> 4 | ((m[hl] & 0xf0) | (m[hl + 1] & 0x0f)) << 4) & 0xff;
  if (a < m[0x6021]) return;
  m[0x622d] = 1;
  m[0x6228]++;
  showLives(g, 1); // A is still 1 from setting the flag: don't count the life in play
}

/**
 * $3009: a little sequencer for walking and rolling animations. Selector a
 * picks a pattern of 2-bit states (packed into one byte); returns the state
 * that follows state b in it (4 at the wrap for some patterns).
 */
export function stepper(a, b) {
  let c;
  if (a & 1) {
    c = a & 4 ? 0x1e : 0xb4;
    if (b & 4) b = (b - 1) & 0xff;
  } else c = a & 4 ? 0x6c : 0x90;
  const ror2 = (v) => ((v >> 2) | (v << 6)) & 0xff;
  for (let i = 0; i < 4; i++) { c = ror2(c); if ((c & 3) === b) break; }
  const r = ror2(c) & 3;
  if (r !== 3) return r;
  return (((a & ~4) - 1) & 0xff) !== 0 ? 3 : 4;
}

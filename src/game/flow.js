// Game flow: the GameMode2 state machine run while a game is being played
// ($06FE), from the start of a game through the intro, the "how high can you
// get" screen, stage setup, death, game over and the end-of-stage scenes.
import {
  rst18, rst30, addEvery, setKong, random, addTask, clearSounds, draw1Up, stepper,
} from './core.js';
import { drawStage, clearScreen, clearAll, initStage, buildLadderTable } from './stage.js';
import { conveyorTop } from './hazards.js';
import { mainRoutine, bonusCheck, clearSprites, clearMario } from './play.js';

/** $06FE: dispatch on GameMode2. */
export function playing(g) {
  const m = g.m;
  switch (m[0x600a]) {
    case 0x00: return gameStart(g);
    case 0x01: return copyPlayer(g);
    case 0x02: return twoPlayerIntro(g);
    case 0x03: return copyPlayer2(g);
    case 0x04: return player2Intro(g);
    case 0x05: return showStatus(g);
    case 0x06: return beforeIntro(g);
    case 0x07: return intro(g);
    case 0x08: return howHigh(g);
    case 0x0a: return setupStage(g);
    case 0x0b: return placeMario(g);
    case 0x0c: return mainRoutine(g);
    case 0x0d: return dying(g);
    case 0x0e: return p1Died(g);
    case 0x0f: return p2Died(g);
    case 0x10: return afterGameOverP1(g);
    case 0x11: return afterGameOverP2(g);
    case 0x12: m[0x600a] = 0; m[0x600d] = m[0x600e] = 1; return;
    case 0x13: m[0x600d] = m[0x600e] = 0; m[0x600a] = 0; g.flip = 1; return;
    case 0x14: g.gameOver = true; return; // $141E onwards is high-score entry and the attract mode
    case 0x16: return endOfStage(g);
    case 0x17: clearAll(g); m[0x600a] = m[0x600e] + 0x12; return;
  }
}

/** Start a one-player game as pressing 1P START does ($0906), without the coin handling. */
export function startGame(g, { lives = 3 } = {}) {
  const m = g.m;
  // power-on state ($0266-$02B8 and $01C3/$0207) that the rest of the program relies on
  m.fill(0, 0x6000, 0x6c00);
  m.fill(0x10, 0x7400, 0x7800);
  m.fill(0xff, 0x60c0, 0x6100);
  m[0x60b0] = m[0x60b1] = 0xc0;
  m.set([0x00, 0x37, 0x00, 0xaa, 0xaa, 0xaa, 0x50, 0x76, 0x00], 0x60b2);
  m[0x6020] = lives;
  m[0x6021] = 0x07; // extra life at 7000
  m[0x6026] = 1;    // upright
  m.copyWithin(0x6100, 0x3565, 0x3565 + 0xaa);
  clearSounds(g);
  // $0906: one player
  m.fill(0, 0x6048, 0x6050);
  m[0x600e] = 0; m[0x600f] = 0;
  clearScreen(g);
  m[0x6040] = m[0x6020];
  m.copyWithin(0x6041, 0x095e, 0x095e + 7);
  addTask(g, 1, 0);
  m[0x600a] = 0;
  m[0x6005] = 3;
  m[0x6007] = 0;
  g.gameOver = false;
}

// ---------------------------------------------------------------------------
// Start of game and between lives
// ---------------------------------------------------------------------------

/** Mode 0 ($0986): clear everything and pick the player. */
function gameStart(g) {
  const m = g.m;
  clearAll(g);
  clearSounds(g);
  g.flip = 1;
  if (m[0x600e] === 0) { m[0x600a] = 1; return; }
  if (m[0x6026] !== 1) g.flip = 0;
  m[0x600a] = 3;
}

/** Mode 1 ($09AB): load player 1's state and the first stage of their level. */
function copyPlayer(g) {
  const m = g.m;
  m.copyWithin(0x6228, 0x6040, 0x6048);
  m[0x6227] = m[g.w(0x622a)];
  if (m[0x600f]) { m[0x6009] = 0x78; m[0x600a] = 2; }
  else { m[0x6009] = 1; m[0x600a] = 5; }
}

/** Mode 2 ($09D6). */
function twoPlayerIntro(g) {
  g.paletteA = g.paletteB = 0;
  addTask(g, 3, 2);
  addTask(g, 2, 1);
  g.m[0x600a] = 5;
  draw2Up(g);
}

/** $09EE */
function draw2Up(g) {
  const m = g.m;
  m[0x74e0] = 0x02; m[0x74c0] = 0x25; m[0x74a0] = 0x20;
}

/** Mode 3 ($09FE). */
function copyPlayer2(g) {
  const m = g.m;
  m.copyWithin(0x6228, 0x6048, 0x6050);
  m[0x6227] = m[g.w(0x622a)];
  m[0x6009] = 0x78;
  m[0x600a] = 4;
}

/** Mode 4 ($0A1B). */
function player2Intro(g) {
  g.paletteA = g.paletteB = 0;
  addTask(g, 3, 3);
  addTask(g, 2, 1);
  draw2Up(g);
  g.m[0x600a] = 5;
}

/** Mode 5 ($0A37): draw the scores, lives and level. */
function showStatus(g) {
  addTask(g, 3, 4);
  addTask(g, 2, 2);
  addTask(g, 2, 0);
  addTask(g, 6, 0);
  g.m[0x600a]++;
  draw1Up(g);
}

/** Mode 6 ($0A63): wait, clear, and run the intro only at the very start of a game. */
function beforeIntro(g) {
  const m = g.m;
  if (!rst18(g)) return;
  clearScreen(g);
  m[0x6009] = 1;
  m[0x600a]++;
  if (m[0x622c]) return;
  m[0x600a]++;
}

// ---------------------------------------------------------------------------
// Intro: Kong climbs with the girl and stomps the girders crooked ($0A76)
// ---------------------------------------------------------------------------

function intro(g) {
  const m = g.m;
  switch (m[0x6385]) {
    case 0: {
      g.paletteA = 0; g.paletteB = 1;
      drawStage(g, 0x380d);
      m[0x76a3] = 0x10; m[0x7663] = 0x10;
      m[0x75aa] = 0xd4;
      m[0x62af] = 0;
      g.sw(0x63c2, 0x38b4);
      g.sw(0x63c4, 0x38cb);
      m[0x6009] = 0x40;
      m[0x6385]++;
      return;
    }
    case 1: {
      if (!rst18(g)) return;
      setKong(g, 0x388c);
      addEvery(g, 0x6908, 0x30);
      addEvery(g, 0x690b, 0x99);
      m[0x638e] = 0x1f;
      m[0x690c] = 0;
      m[0x608a] = 1; m[0x608b] = 3;
      m[0x6385]++;
      return;
    }
    case 2: {
      kongClimb(g);
      if ((m[0x62af] & 0x0f) === 0) rollLadder(g);
      if (m[0x690b] >= 0x5d) return;
      m[0x6009] = 0x20;
      m[0x6385]++;
      g.sw(0x63c0, 0x6385);
      return;
    }
    case 3: case 5: return waitAndStep(g);
    case 4: {
      if (m[0x601a] & 1) return;
      const hl = g.w(0x63c2);
      const a = m[hl];
      if (a !== 0x7f) { g.sw(0x63c2, hl + 1); addEvery(g, 0x690b, a); return; }
      // $0B1E: at the top: put the girl down, then roll up the ladder and stomp
      const girl = setKong(g, 0x385c);
      m.copyWithin(0x6900, girl, girl + 8);
      addEvery(g, 0x6908, 0x50);
      addEvery(g, 0x690b, 0xfc);
      do rollLadder(g); while (m[0x638e] !== 0x0a);
      m[0x6082] = 3;
      drawStage(g, 0x392c);
      m[0x74aa] = 0x10; m[0x748a] = 0x10;
      m[0x638d] = 5;
      m[0x6009] = 0x20;
      m[0x6385]++;
      g.sw(0x63c0, 0x6385);
      return;
    }
    case 6: {
      if (m[0x601a] & 1) return;
      const hl = g.w(0x63c4);
      const a = m[hl];
      if (a !== 0x7f) {
        g.sw(0x63c4, hl + 1);
        addEvery(g, 0x690b, a);
        addEvery(g, 0x6908, 0xff);
        return;
      }
      // $0B86: landed: bend the next girder
      g.sw(0x63c4, 0x38cb);
      m[0x6082] = 3;
      drawStage(g, 0x38dc + (((m[0x638d] - 1) << 4) & 0xff));
      if (--m[0x638d]) return;
      m[0x6009] = 0xb0;
      m[0x6385]++;
      return;
    }
    case 7: {
      const t = m[0x6009];
      if (t === 0x90) { m[0x608a] = 0x0f; m[0x608b] = 3; m[0x6919]++; }
      else if (t === 0x18) m[0x6919]--;
      if (!rst18(g)) return;
      m[0x6385] = 0;
      m[0x6009]++;
      m[0x600a]++;
    }
  }
}

/** $3069: wait on WaitTimerMSB, then step the counter whose address is in $63C0. */
function waitAndStep(g) {
  if (!rst18(g)) return;
  g.m[g.w(0x63c0)]++;
}

/** $306F: Kong climbs a step every 8 calls, legs and arm alternating, the girl wriggling. */
export function kongClimb(g) {
  const m = g.m;
  m[0x62af]++;
  if (m[0x62af] & 7) return;
  addEvery(g, 0x690b, 0xfc);
  for (const hl of [0x6909, 0x691d]) { m[hl] ^= 0x81; m[hl + 4] ^= 0x81; }
  m[0x692d] ^= random(g) & 0x80;
}

/** $304A: roll the intro ladders up behind Kong one row. */
function rollLadder(g) {
  const m = g.m;
  const c = m[0x638e];
  for (const base of [0x7600, 0x75c0]) m[base + c - 0x20] = m[base + c];
  m[0x638e]--;
}

// ---------------------------------------------------------------------------
// How high can you get ($0BDA)
// ---------------------------------------------------------------------------

function howHigh(g) {
  const m = g.m;
  clearSounds(g);
  if (!rst18(g)) return;
  clearScreen(g);
  addTask(g, 6, m[0x6200]);
  g.paletteA = 1; g.paletteB = 0;
  m[0x608a] = 2; m[0x608b] = 3;
  m[0x63a7] = 0;
  g.sw(0x63a8, 0x76dc);
  if (m[0x622e] >= 6) m[0x622e] = 5;
  if (m[0x622f] !== m[0x622a]) m[0x622e]++;
  m[0x622f] = m[0x622a];
  let b = m[0x622e];
  let hl = 0x75bc;
  do {
    // a Kong: 6 columns of 4 tiles, $50-$67
    let c = 0x50;
    for (;;) {
      m[hl] = c++; hl--;
      m[hl] = c++; hl--;
      m[hl] = c++; hl--;
      m[hl] = c;
      if (c === 0x67) break;
      c++;
      hl += 0x23;
    }
    // its height: "25m" etc from $3CF0
    const a = m[0x63a7]++;
    const t = 0x3cf0 + ((a << 2) & 0xff);
    const ix = g.w(0x63a8);
    m[ix + 0x60] = m[t];
    m[ix + 0x40] = m[t + 1];
    m[ix + 0x20] = m[t + 2];
    m[ix - 0x20] = 0x8b;
    g.sw(0x63a8, ix - 4);
    hl = (hl - 0xa1) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b !== 0);
  addTask(g, 3, 7);
  m[0x6009] = 0xa0;
  m[0x600a] += 2;
}

// ---------------------------------------------------------------------------
// Stage setup ($0C91)
// ---------------------------------------------------------------------------

function setupStage(g) {
  const m = g.m;
  if (!rst18(g)) return;
  clearScreen(g);
  m[0x638c] = 0;
  addTask(g, 5, 1);
  g.paletteA = 0; g.paletteB = 1;
  let de;
  switch (m[0x6227]) {
    case 1: de = 0x3ae4; m[0x6089] = 0x08; break;
    case 2: de = 0x3b5d; g.paletteA = 1; g.paletteB = 0; m[0x6089] = 0x09; break;
    case 3: drawCables(g); m[0x6089] = 0x0a; de = 0x3be5; break;
    default: drawBars(g); g.paletteA = 1; m[0x6089] = 0x0b; de = 0x3c8b; break;
  }
  drawStage(g, de);
  if (m[0x6227] === 4) drawRivets(g);
  // $3FA6: the retractable ladders' tops on the conveyor stage
  if (rst30(g, 2)) {
    m[0x776c] = 0x10; m[0x776e] = 0xc0;
    m[0x748c] = 0x10; m[0x748e] = 0xc0;
  }
  // $0D5F
  initStage(g);
  buildLadderTable(g);
  m[0x6009] = 0x40;
  m[0x600a]++;
  const girl = setKong(g, 0x385c);
  m.copyWithin(0x6900, girl, girl + 8);
  const s = m[0x6227];
  if (s === 4) {
    addEvery(g, 0x6908, 0x44);
    addEvery(g, 0x6900, 0x10, 2, 4);
    addEvery(g, 0x6903, 0xf8, 2, 4);
    return;
  }
  if (s & 2) return;
  addEvery(g, 0x690b, 0xfc);
}

/** $0D00: the rivets' 8 pairs of tiles. */
function drawRivets(g) {
  const m = g.m;
  for (let i = 0; i < 8; i++) {
    const de = g.w(0x0d17 + i * 2);
    m[de] = 0xb8;
    m[de + 1] = 0xb7;
  }
}

/** $0D27: the elevator cables. */
function drawCables(g) {
  for (const hl of [0x770d, 0x760d]) edgePair(g, hl, 0x11, 0x0f);
}

/** $0D43: the bars beside Kong on the rivets. */
function drawBars(g) {
  for (const hl of [0x7687, 0x7547]) edgePair(g, hl, 4, 0x1c);
}

function edgePair(g, hl, n, gap) {
  const m = g.m;
  for (let i = 0; i < n; i++) m[hl++] = 0xfd;
  hl += gap;
  for (let i = 0; i < n; i++) m[hl++] = 0xfc;
}

/** Mode B ($123C): put Mario at the start and show lives - 1. */
function placeMario(g) {
  const m = g.m;
  if (!rst18(g)) return;
  const [x, y] = m[0x6227] === 3 ? [0x16, 0xe0] : [0x3f, 0xf0];
  m[0x6200] = 1;
  m[0x6203] = m[0x694c] = x;
  m[0x6207] = m[0x694d] = 0x80;
  m[0x6208] = m[0x694e] = 0x02;
  m[0x6205] = m[0x694f] = y;
  m[0x620f] = 1;
  m[0x600a]++;
  addTask(g, 6, 1);
}

// ---------------------------------------------------------------------------
// Death ($127C) and what follows
// ---------------------------------------------------------------------------

function dying(g) {
  const m = g.m;
  bonusCheck(g);
  switch (m[0x639d]) {
    case 0: {
      if (!rst18(g)) return;
      m[0x694d] = m[0x694d] & 0x80 ? 0xf8 : 0x78;
      m[0x639d]++;
      m[0x639e] = 0x0d;
      m[0x6009] = 8;
      clearSprites(g);
      m[0x6088] = 3;
      return;
    }
    case 1: {
      if (!rst18(g)) return;
      m[0x6009] = 8;
      if (--m[0x639e]) {
        const x = 1 | ((m[0x694d] & 1) << 7);
        m[0x694d] ^= x;
        m[0x694e] ^= x & 0x80;
        return;
      }
      m[0x694d] = m[0x694d] & 0x80 ? 0xfa : 0x7a;
      m[0x639d]++;
      m[0x6009] = 0x80;
      return;
    }
    case 2: {
      if (!rst18(g)) return;
      clearMario(g);
      m[0x600a] += m[0x600e] ? 2 : 1;
      m[0x6009] = 1;
    }
  }
}

/** Mode E ($12F2): player 1 loses a life. */
function p1Died(g) {
  const m = g.m;
  clearSounds(g);
  m[0x622c] = 0;
  m[0x6228]--;
  const lives = m[0x6228];
  m.copyWithin(0x6040, 0x6228, 0x6230);
  if (lives) { m[0x600a] = m[0x600f] ? 0x17 : 0x08; return; }
  enterHighScore(g, 1, 0x60b2);
  let hl = 0x76d4;
  if (m[0x600f]) { addTask(g, 3, 2); hl--; }
  clearArea(g, hl);
  addTask(g, 3, 0);
  m[0x6009] = 0xc0;
  m[0x600a] = 0x10;
}

/** Mode F ($1344): player 2 loses a life. */
function p2Died(g) {
  const m = g.m;
  clearSounds(g);
  m[0x622c] = 0;
  m[0x6228]--;
  const lives = m[0x6228];
  m.copyWithin(0x6048, 0x6228, 0x6230);
  if (lives) { m[0x600a] = m[0x6040] ? 0x17 : 0x08; return; }
  enterHighScore(g, 3, 0x60b5);
  addTask(g, 3, 3);
  addTask(g, 3, 0);
  clearArea(g, 0x76d3);
  m[0x6009] = 0xc0;
  m[0x600a] = 0x11;
}

/** Mode $10 ($138F) and $11 ($13A1): after GAME OVER, go to the other player or end. */
function afterGameOverP1(g) {
  if (!rst18(g)) return;
  afterGameOver(g, g.m[0x6048]);
}
function afterGameOverP2(g) {
  if (!rst18(g)) return;
  afterGameOver(g, g.m[0x6040]);
}
function afterGameOver(g, otherLives) {
  const m = g.m;
  m[0x6009]++;
  m[0x600a] = otherLives ? 0x17 : 0x14;
}

/** $13CA: slot the finished player's score into the high score table. */
function enterHighScore(g, code, hl) {
  const m = g.m;
  m[0x61c6] = code;
  if (m[0x6007] & 1) return;
  m.copyWithin(0x61c7, hl, hl + 3);
  let de = 0x61ca, out = 0x61b1;
  for (let b = 0; b < 3; b++) {
    de--;
    m[out++] = m[de] >> 4;
    m[out++] = m[de] & 0x0f;
  }
  for (let b = 0; b < 0x0e; b++) m[out++] = 0x10;
  m[out] = 0x3f;
  // bubble up through the five entries, lowest first
  let h = 0x61a5, d = 0x61c7;
  for (let b = 0; b < 5; b++) {
    // 3-byte compare, low byte first; carry out means the player's score is lower
    let borrow = 0;
    for (let i = 0; i < 3; i++) {
      const r = m[d + i] - m[h + i] - borrow;
      borrow = r < 0 ? 1 : 0;
    }
    if (borrow) return;
    h += 2; d += 2;
    for (let i = 0; i < 0x19; i++, h--, d--) { const t = m[h]; m[h] = m[d]; m[d] = t; }
    h -= 0x0b; d -= 0x0b;
  }
}

/** $1826: blank a 5 x 14 area of the tile map. */
export function clearArea(g, hl) {
  const m = g.m;
  for (let c = 0; c < 0x0e; c++) {
    for (let b = 0; b < 5; b++) m[hl++] = 0x10;
    hl = (hl + 0xffdb) & 0xffff;
  }
}

/** $0514: write a, a-1, a-2 down a column (the "HELP" cries) and return the next a. */
export function writeDown3(g, hl, a, de = 0x20) {
  const m = g.m;
  for (let b = 0; b < 3; b++) { m[hl] = a; hl = (hl + de) & 0xffff; a = (a - 1) & 0xff; }
  return a;
}

// ---------------------------------------------------------------------------
// End of stage ($1615)
// ---------------------------------------------------------------------------

function endOfStage(g) {
  const m = g.m;
  clearSprites(g);
  const s = m[0x6227];
  const step = m[0x6388];
  if (s & 1) return [end1, end2, end3, climbAway, kongGone, nextStage][step](g);
  if (s === 2) return [convEnd1, convEnd2, climbAway, kongGone, nextStage][step](g);
  bonusCheck(g);
  return [rivetsEnd, waitAndStep, rivetsChest, rivetsFlip, rivetsFall, rivetsKiss][step](g);
}

/** $1708: heart, girl's happy pose, fanfare. */
function heartAndFanfare(g) {
  const m = g.m;
  clearSounds(g);
  m.set([0x80, 0x76, 0x09, 0x20], 0x6a20);
  m[0x6905] = 0x13;
  writeDown3(g, 0x75c4, 0x10);
  m[0x608a] = 7; m[0x608b] = 3;
}

function end1(g) {
  const m = g.m;
  heartAndFanfare(g);
  setKong(g, 0x385c);
  m[0x6009] = 0x20;
  end1Tail(g);
}
function end1Tail(g) {
  g.m[0x6388]++;
  if (rst30(g, 1)) addEvery(g, 0x690b, 0xfc);
}
function end2(g) {
  const m = g.m;
  if (!rst18(g)) return;
  setKong(g, 0x3932);
  m[0x6009] = 0x20;
  m[0x6388]++;
  if (rst30(g, 4)) addEvery(g, 0x690b, 0x04);
}
function end3(g) {
  const m = g.m;
  if (!rst18(g)) return;
  setKong(g, 0x388c);
  m[0x690c] = 0x66;
  m[0x6924] = 0; m[0x692c] = 0;
  m[0x62af] = 0;
  end1Tail(g);
}

function convEnd1(g) {
  const m = g.m;
  heartAndFanfare(g);
  const a = (m[0x6910] - 0x3b) & 0xff;
  setKong(g, 0x385c);
  addEvery(g, 0x6908, a);
  m[0x6388]++;
}
function convEnd2(g) {
  const m = g.m;
  m[0x62a0] = 0;
  const c = m[0x63a3];
  const x = m[0x6910];
  let slow;
  if (x < 0x5a) slow = (c & 0x80) !== 0;
  else if (x >= 0x5d) slow = (c & 0x80) === 0;
  else {
    setKong(g, 0x388c);
    m[0x690c] = 0x66;
    m[0x6924] = 0; m[0x692c] = 0;
    m[0x62af] = 0;
    m[0x6388]++;
    return;
  }
  // ride the top conveyor back to the middle
  if (slow) m[0x62a0] = 1;
  conveyorTop(g);
  addEvery(g, 0x6908, m[0x63a3]);
}

/** $1732: Kong climbs off with the girl. */
function climbAway(g) {
  const m = g.m;
  kongClimb(g);
  if (m[0x6913] >= 0x2c) return;
  m[0x6900] = 0; m[0x6904] = 0; m[0x690c] = 0;
  m[0x6924] = 0x6b;
  m[0x692c] = 0x6a;
  m[0x6a21]++;
  m[0x6388]++;
}

/** $1757: keep climbing, hiding sprites above the top, until all of Kong is gone. */
function kongGone(g) {
  const m = g.m;
  kongClimb(g);
  for (let i = 0, hl = 0x692f; i < 10; i++, hl -= 4) if (m[hl] < 0x19) m[hl - 3] = 0;
  for (let i = 0; i < 10; i++) if (m[0x6908 + i * 4]) return;
  m[0x6009] = 0x40;
  m[0x6388]++;
}

/** $178E: on to the next stage of this level. */
function nextStage(g) {
  const m = g.m;
  if (!rst18(g)) return;
  advanceStage(g);
  addTask(g, 5, 0);
  m[0x6388] = 0;
  m[0x6009] = 0x30;
  m[0x600a] = 8;
}

function advanceStage(g) {
  const m = g.m;
  let hl = g.w(0x622a) + 1;
  let a = m[hl];
  if (a === 0x7f) { hl = 0x3a73; a = m[hl]; }
  g.sw(0x622a, hl);
  m[0x6227] = a;
}

// rivets cleared

function rivetsEnd(g) {
  const m = g.m;
  clearSounds(g);
  m[0x608a] = 0x0e; m[0x608b] = 3;
  const a = writeDown3(g, 0x7623, 0x10);
  writeDown3(g, 0x7583, a);
  clearArea(g, 0x76da); drawStage(g, 0x3a47);
  clearArea(g, 0x76d5); drawStage(g, 0x3a4d);
  clearArea(g, 0x76d0); drawStage(g, 0x3a53);
  clearArea(g, 0x76cb); drawStage(g, 0x3a59);
  setKong(g, 0x385c);
  addEvery(g, 0x6908, 0x44);
  m[0x6905] = 0x13;
  m[0x6009] = 0x20;
  m[0x6390] = 0x80;
  m[0x6388]++;
  g.sw(0x63c0, 0x6388);
}

function rivetsChest(g) {
  const m = g.m;
  m[0x6390]++;
  if (m[0x6390] === 0) {
    setKong(g, 0x385c);
    addEvery(g, 0x6908, 0x44);
    m[0x6009] = 0x20;
    m[0x6388]++;
    return;
  }
  if (m[0x6390] & 7) return;
  setKong(g, m[0x6390] & 8 ? 0x39cf : 0x39f7);
  addEvery(g, 0x6908, 0x44);
}

function rivetsFlip(g) {
  const m = g.m;
  if (!rst18(g)) return;
  setKong(g, 0x3a1f);
  m[0x6084] = 3;
  m[0x6388]++;
}

function rivetsFall(g) {
  const m = g.m;
  addEvery(g, 0x690b, 1);
  if (m[0x691b] !== 0xd0) return;
  m[0x6919] = 0x20;
  m.set([0x7f, 0x39, 0x01, 0xd8], 0x6a24);
  clearArea(g, 0x76c6);
  drawStage(g, 0x3a5f);
  addEvery(g, 0x6903, 0x28, 2, 4);
  m[0x62af] = 0;
  m[0x6082] = 3;
  m[0x6388]++;
}

function rivetsKiss(g) {
  const m = g.m;
  if (--m[0x62af] === 0) {
    // $193D: next level
    advanceStage(g);
    m[0x6229]++;
    addTask(g, 5, 0);
    m[0x622e] = 0;
    m[0x6388] = 0;
    m[0x6009] = 0xe0;
    m[0x600a] = 8;
    return;
  }
  if (m[0x62af] & 7) return;
  m[0x6a25] ^= 0x80;
  m[0x6919] = stepper(0, m[0x6919] & ~0x20) | 0x20;
  const a = m[0x62af];
  if (a === 0xe0) {
    m[0x694f] = 0x50;
    m[0x694d] = 0;
    m[0x694c] = 0x9f;
    if (m[0x6203] < 0x80) { m[0x694d] = 0x80; m[0x694c] = 0x5f; }
  }
  if (a !== 0xc0) return;
  m[0x608a] = m[0x6229] & 1 ? 0x0c : 0x05;
  m[0x608b] = 3;
  m.set([0x8f, 0x76, 0x09, 0x40], 0x6a20);
  if (m[0x6203] < 0x80) m[0x6a20] = 0x6f;
}

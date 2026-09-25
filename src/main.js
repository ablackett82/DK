// Entry point: loads the tables, runs the engine at the arcade's 60.6 Hz, and
// draws it; a title screen, high score and pause live here, outside the engine.
import { Machine, FRAME_HZ, IN_RIGHT, IN_LEFT, IN_UP, IN_DOWN, IN_JUMP } from './game/machine.js';
import { startGame } from './game/flow.js';
import { setKong, addEvery } from './game/core.js';
import { clearAll } from './game/stage.js';
import { Screen, SCREEN_W, SCREEN_H } from './render/screen.js';
import { Sound } from './render/audio.js';
import { Keyboard } from './input/keyboard.js';
import { Gamepad } from './input/gamepad.js';
import { Touch } from './input/touch.js';

const STEP = 1 / FRAME_HZ;
const MAX_CATCHUP = 0.1;
const STORE = 'dk.';

const store = {
  get(k, d) { try { return localStorage.getItem(STORE + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(STORE + k, String(v)); } catch { /* storage blocked */ } },
};

async function main() {
  const r = await fetch('data/tables.json');
  if (!r.ok) throw new Error(`data/tables.json: ${r.status}`);
  const tables = await r.json();

  const canvas = document.getElementById('screen');
  canvas.width = SCREEN_W; canvas.height = SCREEN_H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = ctx.createImageData(SCREEN_W, SCREEN_H);
  const screen = new Screen();
  const sound = new Sound();
  const keyboard = new Keyboard();
  const gamepad = new Gamepad();
  const touch = new Touch(document.getElementById('touch'));

  let cheat = store.get('cheat', '0') === '1';
  let highScore = Number(store.get('highscore', 7650));
  let mode = 'title';           // title | game
  let paused = false;
  let game = null, cheated = false;
  let title = makeTitle();
  let titleT = 0;
  let acc = 0, last = performance.now();

  touch.setCheat(cheat);
  touch.onPanelToggle = (open) => { if (mode === 'game') paused = open; };
  touch.onCheatToggle = (on) => setCheat(on);

  function setCheat(on) {
    cheat = on;
    store.set('cheat', on ? 1 : 0);
    touch.setCheat(on);
    if (on && game) cheated = true;
    drawTitleText();
  }

  // ---- input ----
  const input = { left: false, right: false, up: false, down: false, jump: false };
  function readInput() {
    for (const k in input) input[k] = false;
    keyboard.read(input);
    gamepad.read(input);
    if (input.left || input.right || input.up || input.down || input.jump) touch.notifyOtherInput();
    touch.read(input);
    return (input.right ? IN_RIGHT : 0) | (input.left ? IN_LEFT : 0) | (input.up ? IN_UP : 0)
      | (input.down ? IN_DOWN : 0) | (input.jump ? IN_JUMP : 0);
  }

  // ---- title screen: the attract mode's girder logo with Kong beating his chest ----
  function makeTitle() {
    const t = new Machine(tables);
    clearAll(t);
    const m = t.m;
    // $07F7: the logo is runs of the rivet-girder tile from the table at $3D08
    for (let hl = 0x3d08; m[hl] !== 0; hl += 3) {
      let de = m[hl + 1] | (m[hl + 2] << 8);
      for (let b = m[hl]; b > 0; b--) m[de++] = 0xb0;
    }
    setKong(t, 0x39cf);
    addEvery(t, 0x6908, 0x44);
    addEvery(t, 0x690b, 0x78);
    t.paletteA = 1; t.paletteB = 1;
    return t;
  }

  function text(t, x, y, s) {
    const m = t.m;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      let code = 0x10;
      if (ch >= '0' && ch <= '9') code = ch.charCodeAt(0) - 48;
      else if (ch >= 'A' && ch <= 'Z') code = 0x11 + ch.charCodeAt(0) - 65;
      else if (ch === '.') code = 0x2b;
      else if (ch === '-') code = 0x2c;
      else if (ch === '?') code = 0xfb;
      else if (ch === '=') code = 0x34;
      m[0x7400 + (29 - (x + i)) * 0x20 + y] = code;
    }
  }

  function drawTitleText() {
    const t = title;
    text(t, 9, 0, 'HIGH SCORE');
    text(t, 11, 1, String(highScore).padStart(6, '0'));
    const tapping = touch.active;
    text(t, 1, 4, tapping ? '                          ' : 'ARROWS MOVE  SPACE JUMPS');
    text(t, 4, 28, tapping ? '   TAP TO START    ' : 'PRESS JUMP TO START');
    text(t, 3, 30, `CHEAT MODE ${cheat ? 'ON ' : 'OFF'}  ${tapping ? 'COG  ' : 'C KEY'}`);
  }
  drawTitleText();

  function startNewGame() {
    game = new Machine(tables);
    startGame(game, { lives: 3 });
    // the saved high score, in the BCD the game keeps it in
    const hs = String(Math.min(highScore, 999999)).padStart(6, '0');
    game.m[0x60b8] = parseInt(hs.slice(4, 6), 16);
    game.m[0x60b9] = parseInt(hs.slice(2, 4), 16);
    game.m[0x60ba] = parseInt(hs.slice(0, 2), 16);
    cheated = cheat;
    mode = 'game';
    paused = false;
    acc = 0;
    sound.unlock();
    sound.stopAll();
  }

  function score(g) {
    const m = g.m, hex = (v) => v.toString(16).padStart(2, '0');
    return Number(hex(m[0x60b4]) + hex(m[0x60b3]) + hex(m[0x60b2]));
  }

  function endGame() {
    if (game && !cheated) {
      highScore = Math.max(highScore, score(game));
      store.set('highscore', highScore);
    }
    game = null;
    mode = 'title';
    paused = false;
    sound.stopAll();
    title = makeTitle();
    drawTitleText();
    keyboard.clearPressed();
  }

  function step(in0) {
    // cheat mode: lives never run out
    if (cheat && game.m[0x600a] === 0x0e && game.m[0x6228] <= 1) game.m[0x6228] = 2;
    game.frame(in0);
    if (game.gameOver) endGame();
  }

  // ---- layout ----
  function fit() {
    const stage = document.getElementById('stage');
    const vw = stage.clientWidth, vh = stage.clientHeight;
    const portrait = vh > vw;
    // in portrait on a touch screen, keep the bottom free for the controls
    const availH = portrait && touch.active ? vh * 0.74 : vh;
    const scale = Math.min(vw / SCREEN_W, availH / SCREEN_H);
    const s = scale >= 1 ? Math.floor(scale * 4) / 4 : scale;
    canvas.style.width = `${Math.round(SCREEN_W * s)}px`;
    canvas.style.height = `${Math.round(SCREEN_H * s)}px`;
    stage.classList.toggle('top', portrait && touch.active);
  }
  window.addEventListener('resize', fit);
  touch.onLayout = fit;
  fit();

  function frame(now) {
    const dt = Math.min(MAX_CATCHUP, (now - last) / 1000);
    last = now;
    const in0 = readInput();
    const fire = keyboard.consume('Space', 'Enter', 'KeyZ') || gamepad.anyPressed || touch.consumeStart();

    if (keyboard.consume('KeyF')) toggleFullscreen();
    if (keyboard.consume('KeyM')) sound.setMuted(!sound.muted);

    if (mode === 'title') {
      if (keyboard.consume('KeyC')) setCheat(!cheat);
      if (fire) startNewGame();
      titleT++;
      if (titleT % 32 === 0) {
        setKong(title, titleT % 64 ? 0x39f7 : 0x39cf);
        addEvery(title, 0x6908, 0x44);
        addEvery(title, 0x690b, 0x78);
      }
      drawTitleText();
      image.data.set(screen.draw(title));
    } else {
      if (keyboard.consume('KeyP')) { paused = !paused; touch.notifyOtherInput(); }
      if (keyboard.consume('Escape')) { endGame(); }
      else {
        if (!paused) {
          acc += dt;
          while (acc >= STEP && game) { step(in0); acc -= STEP; }
          if (game) sound.update(game);
        }
        if (game) image.data.set(screen.draw(game));
        else image.data.set(screen.draw(title));
      }
    }
    ctx.putImageData(image, 0, 0);
    if (paused && mode === 'game') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 112, SCREEN_W, 32);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', SCREEN_W / 2, 133);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // audio can only start from a user gesture on iOS
  for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, () => sound.unlock(), { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'game') paused = true; });
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;padding:1em">${err.stack || err}</pre>`);
});

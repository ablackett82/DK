// The game engine: a routine-by-routine reimplementation of the arcade
// program, traced from the dkdasm disassembly (reference/dkdasm/dkong.asm).
//
// State lives in `m`, a 64K byte array laid out exactly like the original's
// address space: RAM at $6000-$6BFF (sprite list at $6900), the tile map at
// $7400-$77FF, and the program's data tables at their ROM addresses (loaded
// from data/tables.json). Keeping the original layout means the engine can be
// checked byte-for-byte against the real program running in an emulator
// (test/differential.test.js), and the renderer draws straight from the tile
// map and sprite list just as the video hardware did.
//
// One call to frame() is one vblank: the NMI handler ($0066) followed by the
// main loop's work for that frame ($02BD).
//
// Routines live in the other modules in this folder as plain functions of the
// machine `g`, named for what they do and tagged with their original address.

import { nmi, mainLoop } from './core.js';

export const T_FRAME = 50688;       // CPU cycles per frame (384 x 264 pixels at 6.144 MHz / 2)
export const FRAME_HZ = 3072000 / T_FRAME;

// Input bits, as read from IN0
export const IN_RIGHT = 0x01, IN_LEFT = 0x02, IN_UP = 0x04, IN_DOWN = 0x08, IN_JUMP = 0x10;

export class Machine {
  /**
   * @param {{runs: [number, string][]}} tables  data/tables.json
   * @param {object} [opts]
   * @param {() => number} [opts.rng2]  supplies the main loop's free-running
   *   counter ($6019) at each vblank. On the real board it counts idle loop
   *   passes, so it depends on CPU timing; tests feed the emulator's value and
   *   the game uses a random number.
   */
  constructor(tables, opts = {}) {
    this.m = new Uint8Array(0x10000);
    for (const [addr, hex] of tables.runs) {
      for (let i = 0; i < hex.length; i += 2) this.m[addr + i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    this.in0 = 0;        // IN0: joystick and jump, active high
    this.rng2 = opts.rng2 || (() => (Math.random() * 256) | 0);
    // sound and palette registers, written as the original wrote them
    this.music = 0;              // $7C00
    this.sfx = new Uint8Array(8); // $7D00-$7D07
    this.death = 0;              // $7D80
    this.paletteA = 0;           // $7D86
    this.paletteB = 0;           // $7D87
    this.flip = 1;               // $7D82
    // helpers for the easier modes (off = the arcade exactly)
    this.assist = { hammerJump: false, invincible: false };
  }

  /**
   * Advance one frame with the given IN0 input byte. `timing.rngStep` (tests
   * only) is whether the main loop's idle pass bumps $6019 once more before
   * the frame's timers run; on the board that depends on where the NMI
   * happened to interrupt it.
   */
  frame(in0 = 0, timing = {}) {
    this.in0 = in0;
    this.m[0x6019] = this.rng2();
    nmi(this);
    mainLoop(this, timing.rngStep ?? 1);
  }

  // ---- memory helpers ----
  w(a) { return this.m[a] | (this.m[a + 1] << 8); }
  sw(a, v) { this.m[a] = v & 0xff; this.m[a + 1] = (v >> 8) & 0xff; }
}

// Runs the original arcade program (reference/program.bin, rebuilt and
// checksum-verified by tools/buildrom.mjs) in a Z80 core with just enough of the
// board around it: RAM, video/sprite RAM, the input ports, the DIP switches and
// the vblank NMI. Used for the differential tests that check src/game against
// the real thing. Graphics and sound hardware are not emulated; register writes
// are recorded so tests can see which sounds were triggered.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Z80 } from 'z80-emulator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROGRAM = path.join(ROOT, 'reference', 'program.bin');
export const available = () => fs.existsSync(PROGRAM);

// 3.072 MHz Z80; the video timing is 384 x 264 pixels at 6.144 MHz, so one
// frame (and one NMI) every 384*264/2 = 50688 CPU cycles, 60.61 Hz.
export const CPU_HZ = 3072000;
export const T_FRAME = 50688;

// Input bits (IN0/IN1 are active high on this board)
export const IN = { right: 0x01, left: 0x02, up: 0x04, down: 0x08, jump: 0x10 };
const IN2_START1 = 0x04, IN2_COIN = 0x80;
// DSW1: upright cabinet, 3 lives, bonus at 7000, 1 coin 1 play
export const DSW_DEFAULT = 0x80;

export class Host {
  constructor({ dsw = DSW_DEFAULT } = {}) {
    const mem = this.mem = new Uint8Array(0x10000);
    mem.set(fs.readFileSync(PROGRAM), 0);
    this.dsw = dsw;
    this.in0 = 0;
    this.in2 = 0;
    this.nmiEnable = 0;
    this.writes = []; // [frame, addr, value] for the sound/music registers
    this.frame = 0;
    const self = this;
    this.hal = {
      tStateCount: 0,
      readMemory(a) {
        if (a < 0x7c00) return mem[a];
        switch (a & 0xff80) {
          case 0x7c00: return self.in0;
          case 0x7c80: return 0;
          case 0x7d00: return self.in2;
          case 0x7d80: return self.dsw;
        }
        return 0;
      },
      writeMemory(a, v) {
        if (a >= 0x6000 && a < 0x7800) { mem[a] = v; return; }
        if (a === 0x7d84) { self.nmiEnable = v & 1; return; }
        if (a === 0x7c00 || (a >= 0x7d00 && a <= 0x7d07) || a === 0x7d80) self.writes.push([self.frame, a, v]);
      },
      contendMemory() {},
      readPort() { return 0xff; },
      writePort() {}, contendPort() {},
    };
    this.cpu = new Z80(this.hal);
    this.cpu.reset();
    this.nextNmi = T_FRAME;
  }

  get t() { return this.hal.tStateCount; }
  get pc() { return this.cpu.regs.pc; }

  /**
   * Run one video frame: execute up to vblank, then raise the NMI if enabled.
   * Returns false when the NMI was missed because the previous frame's
   * handler (which disables it while it runs) was still busy.
   */
  runFrame() {
    while (this.hal.tStateCount < this.nextNmi) this.cpu.step();
    this.nextNmi += T_FRAME;
    this.frame++;
    if (!this.nmiEnable) return false;
    this.cpu.nonMaskableInterrupt();
    return true;
  }

  /** Run frames until an NMI is taken: one pass of the game logic. */
  runTick() {
    let n = 0;
    do n++; while (!this.runFrame());
    return n;
  }

  runFrames(n) { for (let i = 0; i < n; i++) this.runFrame(); }

  /** Run frames until pred() holds; returns frames run, or throws after max. */
  runUntil(pred, max = 10000) {
    for (let i = 0; i < max; i++) { if (pred(this)) return i; this.runFrame(); }
    throw new Error(`runUntil: condition not met after ${max} frames`);
  }

  /** Set player-1 controls from an {up,down,left,right,jump} object. */
  setInput(input) {
    let v = 0;
    for (const k in IN) if (input[k]) v |= IN[k];
    this.in0 = v;
  }

  /** Coin up and press 1P start; runs until the game proper is in play (GameMode2 = $0C). */
  startOnePlayerGame() {
    this.runUntil((h) => h.mem[0x6005] === 1, 2000); // attract mode reached
    this.in2 = IN2_COIN; this.runFrames(4); this.in2 = 0; this.runFrames(8);
    this.in2 = IN2_START1; this.runFrames(4); this.in2 = 0;
    return this.runUntil((h) => h.mem[0x600a] === 0x0c, 3000);
  }

  // ---- screen helpers (for debugging and tests) ----


  /** The tile map as text: digits and letters decoded, everything else as '.' or '#'. */
  screenText() {
    const rows = [];
    for (let r = 0; r < 32; r++) {
      let s = '';
      for (let c = 0; c < 28; c++) s += tileChar(this.mem[0x77a0 - c * 0x20 + r]);
      rows.push(s);
    }
    return rows.join('\n');
  }
}

export function tileChar(t) {
  if (t < 10) return String(t);
  if (t === 0x10) return ' ';
  if (t >= 0x11 && t <= 0x2a) return String.fromCharCode(0x41 + t - 0x11);
  return '#';
}

// Sound. The game writes a tune number to REG_MUSIC and pulses one register
// per sound effect each frame (see updateSounds in src/game/core.js); this
// turns those into Web Audio.
//
// Music: the arcade's sound CPU played two triangle-wave channels from note
// patterns; the patterns and its note table are transcribed below from the
// sound disassembly (reference/dkdasm/dkong-snd.asm, pages 3-6). The walking,
// jumping, stomping and roaring sounds were analogue circuits and samples on
// the board, so those are synthesised here.

// pattern data ($300-$4CB): 0 ends; bit 7 clear = duration; else note (low
// nybble = note, bits 4-5 = octaves down, bit 6 = a channel B note follows)
const PATTERNS = {
  0x01: [0x2a, 0x80, 0x1c, 0x84, 0x0e, 0x88, 0x8a, 0x88],
  0x02: [0x16, 0x84, 0x0b, 0x84, 0x84],
  0x04: [0x18, 0x84, 0x0c, 0x80, 0x80],
  0x05: [0x10, 0xb8, 0xb4, 0xb0],
  0x06: [0x12, 0x90, 0x09, 0x90, 0x90, 0x12, 0x90, 0x90, 0x94, 0x90, 0x94, 0x90, 0x94, 0x09, 0x94, 0x94, 0x12, 0x94, 0x94, 0x98, 0x94, 0x98, 0x94],
  0x08: [0x09, 0xb0, 0xb2, 0xb4, 0x12, 0xba, 0xb6],
  0x09: [0x0e, 0xa4, 0x1c, 0xe8, 0x90, 0xd8, 0x88, 0x38, 0xe0, 0x80],
  0x0a: [0x60, 0xca, 0x82, 0x20, 0xcc, 0x84, 0x40, 0xd0, 0x86, 0xca, 0x82, 0x08,
    0xda, 0x89, 0xd9, 0x89, 0xda, 0x89, 0xd9, 0x89, 0xda, 0x89, 0xd9, 0x89, 0xda, 0x89, 0xd9, 0x89, 0x08,
    0xda, 0x89, 0xd9, 0x89, 0xda, 0x89, 0xd9, 0x89, 0xda, 0x89, 0xd9, 0x89, 0x7f, 0xda, 0x8a],
  0x10: [0x1b, 0xe2, 0x88, 0x09, 0xa4, 0x12, 0x82, 0xa8, 0x12, 0x88, 0xa4, 0xe2, 0x82, 0xa4, 0x12, 0xe0,
    0x80, 0x09, 0x82, 0x83, 0x86, 0x88, 0x8a, 0x8c, 0x24, 0xd0, 0x88],
  0x11: [0x20, 0x80, 0xdc, 0x98, 0xe0, 0x9a, 0xe2, 0x9c, 0x20, 0x90, 0xe4, 0x88, 0x10, 0xe3, 0x90, 0xa4,
    0x20, 0x88, 0xda, 0x8a, 0xea, 0x84, 0x10, 0xe8, 0x8a, 0xa4, 0x20, 0x84, 0xe2, 0x82, 0xe2, 0x87,
    0x16, 0xe8, 0x88, 0x0a, 0xa3, 0x10, 0xe4, 0x82, 0xa0, 0x15, 0xc8, 0x80, 0x2b, 0xca, 0x83, 0x40, 0xcb, 0x80],
  0x13: [0x10, 0xe8, 0xa4, 0xe8, 0xa4, 0xe6, 0xa2, 0xe6, 0xa2, 0xe4, 0xa0, 0xe4, 0xa0, 0xe2, 0x9c, 0xe2,
    0x9c, 0x20, 0xe0, 0x90, 0x10, 0x88, 0x08, 0xa0, 0xa2, 0x20, 0xe4, 0x90, 0xe0, 0x88, 0x20, 0xe2,
    0x92, 0x10, 0x8a, 0x08, 0xa2, 0xa4, 0x20, 0xe6, 0x92, 0xe2, 0x8a, 0x20, 0xe8, 0x88, 0x10, 0x82,
    0xa8, 0xea, 0x88, 0xa8, 0xe6, 0x82, 0xa4, 0xe8, 0x80, 0x2b, 0x83, 0x40, 0x80],
  0x14: [0x0a, 0xe8, 0xa4, 0xea, 0xa6, 0x14, 0xec, 0xa8, 0x28, 0xe8, 0xa4, 0x0a, 0xe8, 0xa4, 0xea, 0xa6, 0x14, 0xec, 0xa8, 0x28, 0xe8, 0xa4],
  0x15: [0x0a, 0xe0, 0x98, 0xe0, 0x98, 0x3c, 0xe0, 0x98, 0x12, 0x88, 0x84, 0x88, 0x84, 0x88, 0x84, 0x88, 0x84, 0x88, 0x84, 0x88, 0x84],
};
// note table ($600, 12 semitones from A; entry 5 unused), in the sound CPU's frequency units
const NOTE = [0x2800, 0x2a61, 0x2ce6, 0x2f91, 0x3266, 0, 0x3565, 0x3892, 0x3bef, 0x3f75, 0x4346, 0x4746, 0x4b83];
const UNITS_PER_HZ = 65536 / 11765;
const TICK = 0.0105; // one duration unit: the sound CPU's timer period

/** The song for each REG_MUSIC value ($500 and the playlists at $510/$520): [patterns, loop, decay]. */
const SONGS = {
  0x1: { patterns: [0x0a] },
  0x2: { patterns: [0x10], decay: true },
  0x3: { patterns: [0x05], loop: true },
  0x4: { patterns: [0x06], loop: true },
  0x5: { patterns: [0x13], decay: true },
  0x7: { patterns: [0x14], decay: true, roars: 3 },
  0x8: { patterns: [0x01], loop: true },
  0x9: { patterns: [0x02], loop: true },
  0xb: { patterns: [0x04], loop: true },
  0xc: { patterns: [0x11], decay: true },
  0xe: { patterns: [0x15], decay: true },
  0xf: { patterns: [], roars: 3 },
};

/** Decode a pattern to [{t (units), dur, a (Hz), b (Hz or 0)}]. */
function decode(id) {
  const data = PATTERNS[id] || [];
  const notes = [];
  let dur = 1, t = 0;
  const hz = (n) => {
    const f = NOTE[n & 0x0f];
    if (!f) return 0;
    return f / (1 << (4 - ((n >> 4) & 3))) / UNITS_PER_HZ;
  };
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!(v & 0x80)) { dur = v; continue; }
    const note = { t, dur, a: hz(v), b: 0 };
    if (v & 0x40) note.b = hz(data[++i]);
    notes.push(note);
    t += dur;
  }
  return { notes, length: t };
}
const DECODED = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, decode(Number(k))]));

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.music = 0;
    this.song = null;     // {id, patterns, loop, decay, next (audio time), index}
    this.voices = [];     // scheduled music nodes, to stop on a change
    this.lastSfx = new Uint8Array(8);
    this.lastDeath = 0;
  }

  /** Create/resume the audio context; must happen in a user gesture on iOS. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.25;
      this.out.connect(this.ctx.destination);
      this.noise = this.makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.value = m ? 0 : 0.25;
  }

  /** Call once per game frame with the machine. */
  update(g) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // music changes restart the song, as the sound CPU did
    if (g.music !== this.music) {
      this.music = g.music;
      this.stopMusic();
      this.startSong(g.music, now);
    }
    this.scheduleMusic(now);
    // effects fire on the frame their register goes on
    for (let i = 0; i < 8; i++) {
      if (g.sfx[i] && !this.lastSfx[i]) this.effect(i, now);
      this.lastSfx[i] = g.sfx[i];
    }
    if (g.death && !this.lastDeath) this.deathMusic(now);
    this.lastDeath = g.death;
  }

  stopAll() {
    this.stopMusic();
    this.music = 0;
  }

  // ---- music ----

  startSong(id, now) {
    if (id === 0x6) { this.hammerHit(now); return; }
    if (id === 0xd) { this.rivetDitty(now); return; }
    const s = SONGS[id];
    if (!s) { this.song = null; return; }
    this.song = { ...s, index: 0, next: now + 0.02 };
    if (s.patterns.length === 0 && s.roars) { this.roars(now, s.roars); this.song = null; }
  }

  stopMusic() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    for (const v of this.voices) { try { v.stop(now); } catch { /* already stopped */ } }
    this.voices = [];
    this.song = null;
  }

  /** Keep about half a second of music scheduled ahead. */
  scheduleMusic(now) {
    const s = this.song;
    if (!s) return;
    this.voices = this.voices.filter((v) => v.endsAt > now);
    while (s.next < now + 0.5) {
      if (s.index >= s.patterns.length) {
        if (s.loop) s.index = 0;
        else {
          if (s.roars) this.roars(s.next, s.roars);
          this.song = null;
          return;
        }
      }
      const p = DECODED[s.patterns[s.index++]];
      for (const n of p.notes) {
        const at = s.next + n.t * TICK, len = n.dur * TICK;
        if (n.a) this.tone(n.a, at, len, s.decay);
        if (n.b) this.tone(n.b, at, len, s.decay);
      }
      s.next += Math.max(p.length, 1) * TICK;
    }
  }

  tone(hz, at, len, decay, vol = 0.5, type = 'triangle') {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type;
    o.frequency.value = hz;
    gn.gain.setValueAtTime(vol, at);
    if (decay) gn.gain.exponentialRampToValueAtTime(0.01, at + Math.max(len, 0.05));
    else gn.gain.setValueAtTime(vol, at + len * 0.9);
    gn.gain.linearRampToValueAtTime(0, at + len);
    o.connect(gn).connect(this.out);
    o.start(at);
    o.stop(at + len + 0.01);
    o.endsAt = at + len + 0.01;
    this.voices.push(o);
    return o;
  }

  // ---- effects ----

  effect(i, now) {
    switch (i) {
      case 0: return this.walk(now);
      case 1: return this.jump(now);
      case 2: return this.boom(now);
      case 3: return this.spring(now);
      case 4: return this.fall(now);
      case 5: return this.points(now);
    }
  }

  sweep(from, to, at, len, type = 'square', vol = 0.15) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + len);
    gn.gain.setValueAtTime(vol, at);
    gn.gain.linearRampToValueAtTime(0, at + len);
    o.connect(gn).connect(this.out);
    o.start(at);
    o.stop(at + len + 0.01);
  }

  walk(at) { this.sweep(180, 90, at, 0.04, 'square', 0.12); }
  jump(at) { this.sweep(300, 900, at, 0.18, 'square', 0.1); }
  spring(at) { this.sweep(600, 1400, at, 0.12, 'triangle', 0.2); this.sweep(1400, 700, at + 0.12, 0.12, 'triangle', 0.2); }
  fall(at) { this.sweep(1400, 200, at, 0.9, 'triangle', 0.18); }
  points(at) {
    // pattern $08 on the sound CPU ("scored points")
    const p = DECODED[0x08];
    for (const n of p.notes) this.tone(n.a, at + n.t * TICK, n.dur * TICK, false, 0.35).endsAt = 0;
    this.voices = this.voices.filter((v) => v.endsAt);
  }

  boom(at) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
    src.buffer = this.noise;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, at);
    f.frequency.exponentialRampToValueAtTime(60, at + 0.35);
    gn.gain.setValueAtTime(0.9, at);
    gn.gain.exponentialRampToValueAtTime(0.01, at + 0.4);
    src.connect(f).connect(gn).connect(this.out);
    src.start(at);
    src.stop(at + 0.45);
    this.sweep(90, 40, at, 0.3, 'sine', 0.5);
  }

  roars(at, n) {
    for (let k = 0; k < n; k++) {
      const t = at + k * 0.45;
      const ctx = this.ctx;
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
      src.buffer = this.noise;
      f.type = 'bandpass';
      f.frequency.setValueAtTime(700, t);
      f.frequency.linearRampToValueAtTime(300, t + 0.35);
      f.Q.value = 3;
      gn.gain.setValueAtTime(0.0, t);
      gn.gain.linearRampToValueAtTime(0.8, t + 0.05);
      gn.gain.linearRampToValueAtTime(0, t + 0.35);
      src.connect(f).connect(gn).connect(this.out);
      src.start(t);
      src.stop(t + 0.4);
      this.sweep(160, 90, t, 0.35, 'sawtooth', 0.12);
    }
  }

  hammerHit(at) {
    for (let k = 0; k < 4; k++) this.sweep(1200 - k * 150, 500, at + k * 0.06, 0.05, 'square', 0.12);
  }

  rivetDitty(at) {
    [880, 1109, 1319, 1760].forEach((hz, k) => this.tone(hz, at + k * 0.05, 0.05, false, 0.3).endsAt = 0);
    this.voices = this.voices.filter((v) => v.endsAt);
  }

  deathMusic(at) {
    this.stopMusic();
    // a rapid descending trill, then the melodic part (pattern $09)
    let t = at;
    for (let k = 0; k < 16; k++) {
      const hz = 1600 - k * 70;
      this.tone(hz, t, 0.04, false, 0.35);
      this.tone(hz * 1.5, t + 0.04, 0.04, false, 0.35);
      t += 0.08;
    }
    const p = DECODED[0x09];
    for (const n of p.notes) {
      if (n.a) this.tone(n.a, t + n.t * TICK * 1.6, n.dur * TICK * 1.6, true, 0.5);
      if (n.b) this.tone(n.b, t + n.t * TICK * 1.6, n.dur * TICK * 1.6, true, 0.5);
    }
  }

  makeNoise() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}

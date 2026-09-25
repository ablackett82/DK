// Touch controls for iPad. Every finger is tracked on its own (Pointer Events),
// so "run and jump" is a left thumb held on the pad while the right thumb taps
// jump, and "run then climb" is rolling the left thumb from right to up-right.
// Nothing latches: an input is live exactly while a finger is on it, like a key.
//
// Two layouts share one code path:
//   pad   - a fixed d-pad centre in the bottom corner; the whole move half of
//           the screen belongs to it, direction is measured from that centre.
//   stick - floating: the centre is wherever the thumb first lands, and it is
//           dragged along if the thumb travels beyond the ring.
// The other half of the screen is the jump button (any finger anywhere).
//
// Visibility: 'auto' shows the overlay on the first touch and hides it as soon
// as a keyboard or gamepad is used; 'on' / 'off' force it.

const STORE_KEY = 'dk.touch';
const DEFAULTS = { enabled: 'auto', layout: 'pad', size: 1, opacity: 0.35, swap: false };
const DEAD = 0.28;     // stick deadzone, fraction of ring radius
const DIAG = 0.383;    // cos 67.5°: each axis triggers within a 135° fan, so diagonals set both

export class Touch {
  constructor(el) {
    this.el = el;
    this.settings = { ...DEFAULTS, ...load() };
    this.pointers = new Map(); // pointerId -> { kind: 'move'|'jump', cx, cy, x, y }
    this.startTapped = false;
    this.seenTouch = false;
    this.otherInputSeen = false;
    this.stickOrigin = null;
    this.knob = null;
    this.state = { left: false, right: false, up: false, down: false, jump: false };
    this.buildOverlay();
    this.bindEvents();
    this.applySettings();
    window.addEventListener('resize', () => this.layout());
  }

  // ---- input side -----------------------------------------------------------

  get active() {
    const e = this.settings.enabled;
    return e === 'on' || (e === 'auto' && this.seenTouch && !this.otherInputSeen);
  }

  /** Called by the main loop when a keyboard/gamepad input is live. */
  notifyOtherInput() {
    if (!this.otherInputSeen) { this.otherInputSeen = true; this.applySettings(); }
  }

  read(into) {
    if (this.settings.enabled === 'off') return;
    for (const k in this.state) if (this.state[k]) into[k] = true;
  }

  /** True once per tap anywhere (used for "press fire to start"). */
  consumeStart() {
    if (this.settings.enabled === 'off') return false;
    const t = this.startTapped; this.startTapped = false; return t;
  }

  bindEvents() {
    const el = this.el;
    const opts = { passive: false };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (!this.seenTouch || this.otherInputSeen) { this.seenTouch = true; this.otherInputSeen = false; this.applySettings(); }
      if (this.settings.enabled === 'off') return;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      this.startTapped = true;
      this.down(e.pointerId, e.clientX, e.clientY);
    }, opts);
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      e.preventDefault();
      this.move(e.pointerId, e.clientX, e.clientY);
    }, opts);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(ev, (e) => { this.up(e.pointerId); }, opts);
    }
    window.__touch = this; // debug handle
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { this.pointers.clear(); this.recompute(); });
  }

  down(id, x, y) {
    const g = this.geom;
    const moveSide = this.settings.swap ? x > g.mid : x < g.mid;
    if (moveSide) {
      const fixed = this.settings.layout === 'pad';
      const p = { kind: 'move', cx: fixed ? g.padX : x, cy: fixed ? g.padY : y, x, y };
      this.pointers.set(id, p);
      if (!fixed) this.stickOrigin = [p.cx, p.cy];
    } else {
      this.pointers.set(id, { kind: 'jump', x, y });
    }
    this.recompute();
  }

  move(id, x, y) {
    const p = this.pointers.get(id);
    p.x = x; p.y = y;
    if (p.kind === 'move' && this.settings.layout === 'stick') {
      // drag the centre along so the thumb never runs off the ring
      const R = this.geom.padR, dx = x - p.cx, dy = y - p.cy, d = Math.hypot(dx, dy);
      if (d > R) { p.cx = x - dx * R / d; p.cy = y - dy * R / d; this.stickOrigin = [p.cx, p.cy]; }
    }
    this.recompute();
  }

  up(id) {
    if (!this.pointers.delete(id)) return;
    if (![...this.pointers.values()].some((p) => p.kind === 'move')) this.stickOrigin = null;
    this.recompute();
  }

  /** Derive the five inputs from every live finger. */
  recompute() {
    const s = this.state;
    s.left = s.right = s.up = s.down = s.jump = false;
    const R = this.geom.padR;
    let knob = null;
    for (const p of this.pointers.values()) {
      if (p.kind === 'jump') { s.jump = true; continue; }
      const dx = p.x - p.cx, dy = p.y - p.cy, d = Math.hypot(dx, dy);
      const k = Math.min(1, R * 0.7 / Math.max(d, 1e-6)); // knob stays inside the ring
      knob = [p.cx + dx * k, p.cy + dy * k];
      if (d < R * DEAD) continue;
      const cx = dx / d, cy = dy / d;
      if (cx > DIAG) s.right = true;
      if (cx < -DIAG) s.left = true;
      if (cy < -DIAG) s.up = true;   // screen y grows downward
      if (cy > DIAG) s.down = true;
    }
    this.knob = knob;
    this.paint();
  }

  // ---- visual side ----------------------------------------------------------

  buildOverlay() {
    const el = this.el;
    el.innerHTML = `
      <div class="tc-pad"><div class="tc-arrow tc-l">&#9664;</div><div class="tc-arrow tc-r">&#9654;</div>
        <div class="tc-arrow tc-u">&#9650;</div><div class="tc-arrow tc-d">&#9660;</div><div class="tc-knob"></div></div>
      <div class="tc-jump">JUMP</div>
      <button class="tc-gear" type="button" aria-label="Settings">&#9881;</button>
      <div class="tc-panel" hidden>
        <h2>Touch controls</h2>
        <label>Show <select name="enabled"><option value="auto">Auto (hide when keyboard used)</option><option value="on">Always</option><option value="off">Off</option></select></label>
        <label>Layout <select name="layout"><option value="pad">D-pad (fixed)</option><option value="stick">Stick (floats under thumb)</option></select></label>
        <label>Size <input name="size" type="range" min="0.6" max="1.6" step="0.1"></label>
        <label>Opacity <input name="opacity" type="range" min="0.1" max="0.9" step="0.05"></label>
        <label><input name="swap" type="checkbox"> Jump on the left (left-handed)</label>
        <label>Difficulty <select class="tc-level"><option value="0">Normal (like the arcade)</option><option value="1">Easy</option><option value="2">Super easy</option></select></label>
        <button class="tc-close" type="button">Done</button>
      </div>`;
    this.pad = el.querySelector('.tc-pad');
    this.jumpEl = el.querySelector('.tc-jump');
    this.knobEl = el.querySelector('.tc-knob');
    this.arrows = { left: el.querySelector('.tc-l'), right: el.querySelector('.tc-r'), up: el.querySelector('.tc-u'), down: el.querySelector('.tc-d') };
    this.panel = el.querySelector('.tc-panel');
    this.gear = el.querySelector('.tc-gear');
    this.onPanelToggle = null; // main.js hooks this to pause the game
    this.levelBox = el.querySelector('.tc-level');
    this.onLevel = null; // main.js owns the difficulty setting
    this.levelBox.addEventListener('change', () => this.onLevel?.(Number(this.levelBox.value)));
    const stop = (e) => e.stopPropagation();
    for (const n of [this.gear, this.panel]) for (const ev of ['pointerdown', 'pointerup', 'pointermove']) n.addEventListener(ev, stop);
    this.gear.addEventListener('click', () => this.openPanel(true));
    el.querySelector('.tc-close').addEventListener('click', () => this.openPanel(false));
    this.panel.addEventListener('input', (e) => {
      const f = e.target;
      if (!f.name) return; // the difficulty box is not a touch setting
      this.settings[f.name] = f.type === 'checkbox' ? f.checked : f.type === 'range' ? Number(f.value) : f.value;
      save(this.settings);
      this.applySettings();
    });
  }

  setLevel(n) { this.levelBox.value = String(n); }

  openPanel(open) {
    this.panel.hidden = !open;
    this.pointers.clear(); this.recompute();
    this.onPanelToggle?.(open);
  }

  applySettings() {
    const s = this.settings, el = this.el;
    for (const f of this.panel.querySelectorAll('[name]')) {
      if (f.type === 'checkbox') f.checked = !!s[f.name]; else f.value = String(s[f.name]);
    }
    el.style.setProperty('--tc-opacity', s.opacity);
    el.classList.toggle('tc-visible', this.active);
    el.classList.toggle('tc-stick', s.layout === 'stick');
    this.layout();
    this.onLayout?.();
  }

  /** Geometry in window pixels, used for both hit-testing and drawing. */
  layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const inset = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
    const sb = inset('--sat-b'), sl = inset('--sat-l'), sr = inset('--sat-r');
    const u = this.settings.size * Math.min(W, H) * 0.11;
    const padR = 2 * u, jumpR = 1.4 * u;
    const swap = this.settings.swap;
    const padX = swap ? W - sr - padR - u * 0.6 : sl + padR + u * 0.6;
    const padY = H - sb - padR - u * 0.6;
    const jumpX = swap ? sl + jumpR + u : W - sr - jumpR - u;
    const jumpY = H - sb - jumpR - u * 0.8;
    this.geom = { mid: W / 2, padX, padY, padR, jumpX, jumpY, jumpR };
    const j = this.jumpEl.style;
    j.left = `${jumpX - jumpR}px`; j.top = `${jumpY - jumpR}px`; j.width = j.height = `${2 * jumpR}px`;
    this.pad.style.fontSize = `${u * 0.5}px`;
    this.jumpEl.style.fontSize = `${u * 0.45}px`;
    this.paint();
  }

  paint() {
    const g = this.geom, s = this.state;
    const stick = this.settings.layout === 'stick';
    const c = stick && this.stickOrigin ? this.stickOrigin : [g.padX, g.padY];
    this.pad.classList.toggle('tc-hidden', stick && !this.stickOrigin);
    const p = this.pad.style;
    p.left = `${c[0] - g.padR}px`; p.top = `${c[1] - g.padR}px`; p.width = p.height = `${2 * g.padR}px`;
    for (const k in this.arrows) this.arrows[k].classList.toggle('on', s[k]);
    this.jumpEl.classList.toggle('on', s.jump);
    const k = this.knob || c, kr = g.padR * 0.3, ks = this.knobEl.style;
    ks.left = `${k[0] - c[0] + g.padR - kr}px`; ks.top = `${k[1] - c[1] + g.padR - kr}px`; ks.width = ks.height = `${2 * kr}px`;
  }
}

function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function save(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode / quota */ } }

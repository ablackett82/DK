// Gamepad API: d-pad or left stick to move, any face button to jump.
export class Gamepad {
  constructor() { this.anyPressed = false; this.lastButtons = 0; }
  read(into) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let buttons = 0;
    for (const p of pads) {
      if (!p) continue;
      const b = p.buttons;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (b[14]?.pressed || ax < -0.5) into.left = true;
      if (b[15]?.pressed || ax > 0.5) into.right = true;
      if (b[12]?.pressed || ay < -0.5) into.up = true;
      if (b[13]?.pressed || ay > 0.5) into.down = true;
      if (b[0]?.pressed || b[1]?.pressed || b[2]?.pressed || b[3]?.pressed) into.jump = true;
      for (let i = 0; i < b.length; i++) if (b[i]?.pressed) buttons |= 1 << i;
    }
    this.anyPressed = buttons & ~this.lastButtons;
    this.lastButtons = buttons;
  }
}

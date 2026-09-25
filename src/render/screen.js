// Draws the machine's tile map ($7400-$77FF) and sprite list ($6900-$6A7F)
// into a 224 x 256 RGBA image, as the video hardware did but with this
// project's own pictures and colours.
//
// Geometry (monitor on its side): tile map offset o = column C * 32 + row R
// appears at screen tile (29 - C, R); a sprite (X, code, colour, Y) covers
// screen pixels x = X-23 .. X-8, y = Y-8 .. Y+7. Code bit 7 mirrors it,
// colour bit 7 flips it upside down.
import { TILES } from './tiles.js';
import { SPRITES, KONG_FRONT } from './sprites.js';

export const SCREEN_W = 224, SCREEN_H = 256;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// sprite palettes by colour code: colours 1-3
const SPRITE_PAL = [
  ['#ff2a2a', '#ffd21e', '#ffffff'], // 0 springs, pulleys
  ['#ffd21e', '#ff3300', '#ffffff'], // 1 fire
  ['#ff2a2a', '#2e5bff', '#ffbf8c'], // 2 Mario
  ['#ff3a3a', '#a01010', '#ffd21e'], // 3 elevator platforms, retractable ladders
  ['#00e0ff', '#0080c0', '#ffffff'], // 4
  ['#00e0ff', '#0080c0', '#ffffff'], // 5
  ['#00e0ff', '#0080c0', '#ffffff'], // 6
  ['#a4521e', '#f2b16e', '#ffffff'], // 7 Kong's face, hammer, points
  ['#a4521e', '#f2b16e', '#ffffff'], // 8 Kong
  ['#ff3c6e', '#ff9ad5', '#ffbf8c'], // 9 Pauline's head, hearts
  ['#ff5ab4', '#ffffff', '#ffbf8c'], // A Pauline's dress, her things
  ['#c8661e', '#6e2d0c', '#ffb45a'], // B barrels
  ['#2e5bff', '#3cc8ff', '#ffffff'], // C blue barrel, oil drum, smashes
  ['#ff8c00', '#a04000', '#ffffff'], // D
  ['#ffb400', '#a04000', '#fff0c0'], // E pies
  ['#000000', '#ffd21e', '#ff8000'], // F black block, shaft ends
].map((p) => p.map(hex));

// tile colours by stage (the palette bank registers $7D86/$7D87)
const STAGE = {
  '01': { girder: ['#ff1e50', '#c00030'], ladder: '#00e0ff', cable: '#ffd21e' },   // barrels, elevators
  '10': { girder: ['#ff6a00', '#c83c00'], ladder: '#ffd21e', cable: '#ffd21e' },   // pies
  '11': { girder: ['#3a5cff', '#1c32b0'], ladder: '#00e0ff', cable: '#00e0ff' },   // rivets
  '00': { girder: ['#ff1e50', '#c00030'], ladder: '#00e0ff', cable: '#ffd21e' },
};
const WHITE = hex('#ffffff'), RED = hex('#ff2a2a'), BLUE = hex('#3a5cff'), CYAN = hex('#00e0ff'), YELLOW = hex('#ffd21e');

// The How High Kong: tiles $50-$67, 6 columns x 4 rows, $50 + 4 * (5 - column) + (3 - row).
for (let cx = 0; cx < 6; cx++) {
  for (let ry = 0; ry < 4; ry++) {
    const rows = [];
    for (let y = 0; y < 8; y++) {
      let r = '';
      for (let x = 0; x < 8; x++) r += KONG_FRONT[ry * 8 + y]?.[cx * 8 + x - 4] ?? '.';
      rows.push(r);
    }
    TILES[0x50 + 4 * (5 - cx) + (3 - ry)] = rows;
  }
}

/** Compile pictures to pixel arrays. */
function compile(rows, n) {
  const px = new Uint8Array(n * n);
  rows.forEach((r, y) => { for (let x = 0; x < n; x++) px[y * n + x] = r.charCodeAt(x) >= 49 ? r.charCodeAt(x) - 48 : 0; });
  return px;
}

export class Screen {
  constructor() {
    this.rgba = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
    this.tiles = [];
    for (let c = 0; c < 256; c++) this.tiles[c] = TILES[c] ? compile(TILES[c], 8) : null;
    this.sprites = [];
    for (let c = 0; c < 128; c++) this.sprites[c] = compile(SPRITES[c], 16);
  }

  /** Colours 1-3 for tile `code` at screen tile (x, y). */
  tileColors(code, bank, y) {
    const s = STAGE[bank] || STAGE['01'];
    if (code >= 0xc0 && code <= 0xf7) return [hex(s.girder[0]), hex(s.girder[1]), hex(s.ladder)];
    if (code === 0xb0) return [hex(s.girder[0]), hex(s.girder[1]), YELLOW];
    if (code === 0xb7 || code === 0xb8) return [YELLOW, YELLOW, YELLOW];
    if (code >= 0xb1 && code <= 0xb3) return [RED, YELLOW, YELLOW];
    if (code === 0xfc || code === 0xfd) return [hex(s.cable), 0, 0];
    if (code === 0xfe) return [RED, YELLOW, hex('#ff8000')];
    if (code === 0xff) return [RED, BLUE, hex('#ffbf8c')];
    if (code >= 0x50 && code <= 0x67) return SPRITE_PAL[8];
    if ((code >= 0x6c && code <= 0x6f) || code === 0x7c || code === 0x7d || code === 0x7f || (code >= 0x8c && code <= 0x8f)) return [BLUE, BLUE, BLUE];
    if (code >= 0x70 && code <= 0x79) return [RED, RED, RED];
    if (code >= 0xdd && code <= 0xef) return [WHITE, 0, 0];
    if (y === 0) return [RED, RED, RED];
    if (y === 3 && bank !== '10') return [BLUE, BLUE, BLUE];
    if (y === 6) return [CYAN, CYAN, CYAN];
    return [WHITE, WHITE, WHITE];
  }

  /** Render the machine's screen. */
  draw(g) {
    const m = g.m, out = this.rgba;
    out.fill(0);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    const bank = `${g.paletteA & 1}${g.paletteB & 1}`;
    // tiles
    for (let tx = 0; tx < 28; tx++) {
      const base = 0x7400 + (29 - tx) * 0x20;
      for (let ty = 0; ty < 32; ty++) {
        const code = m[base + ty];
        const px = this.tiles[code];
        if (!px) continue;
        const cols = this.tileColors(code, bank, ty);
        for (let y = 0; y < 8; y++) {
          let o = ((ty * 8 + y) * SCREEN_W + tx * 8) * 4;
          for (let x = 0; x < 8; x++, o += 4) {
            const v = px[y * 8 + x];
            if (!v) continue;
            const c = cols[v - 1];
            if (!c) continue;
            out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
          }
        }
      }
    }
    // sprites, later ones on top
    for (let a = 0x6900; a < 0x6a80; a += 4) {
      const X = m[a];
      if (!X) continue;
      const code = m[a + 1], col = m[a + 2], Y = m[a + 3];
      const px = this.sprites[code & 0x7f];
      const pal = SPRITE_PAL[col & 0x0f];
      const hflip = code & 0x80, vflip = col & 0x80;
      const left = X - 23, top = Y - 8;
      for (let y = 0; y < 16; y++) {
        const sy = top + y;
        if (sy < 0 || sy >= SCREEN_H) continue;
        const srow = (vflip ? 15 - y : y) * 16;
        for (let x = 0; x < 16; x++) {
          const sx = left + x;
          if (sx < 0 || sx >= SCREEN_W) continue;
          const v = px[srow + (hflip ? 15 - x : x)];
          if (!v) continue;
          const c = pal[v - 1];
          const o = (sy * SCREEN_W + sx) * 4;
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
        }
      }
    }
    return out;
  }
}

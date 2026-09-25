# Kong

A browser reimplementation of the 1981 arcade game, built to run fullscreen on
an iPad as a home-screen app. Plain HTML/JS, no build step.

The game logic is traced routine by routine from the community disassembly
([furrykef/dkdasm](https://github.com/furrykef/dkdasm)) and checked frame by
frame against the original program running in a Z80 emulator. All graphics
are drawn for this project; the music is played from the note data in the
sound disassembly. No ROM images are included.

## Play

Open the site, then on iPad: Share → **Add to Home Screen**.

- Keyboard: arrows / WASD to move, Space / Z / Enter to jump; P pause, M mute, F fullscreen, Esc quit
- Touch: left half = d-pad, right half = jump (⚙ for settings)
- Gamepad / controller: d-pad or left stick, any face button jumps
- Cheat mode (C on the title screen, or under ⚙): lives never run out; cheat games don't set the high score

## Develop

```
npm install     # the Z80 core, for the differential tests
npm run rom     # rebuild the program from reference/dkdasm and check MAME's checksums
npm run dev     # http://localhost:8080/
npm test
```

`reference/` (gitignored) holds the disassembly clone and the rebuilt program;
`git clone https://github.com/furrykef/dkdasm reference/dkdasm` then `npm run rom`.
`node tools/extract.mjs` regenerates `data/tables.json`; `node tools/shot.mjs`
renders frames to PNG; `node tools/emu/diff.mjs [seed] [frames] [stage]` runs a
long comparison against the original.
